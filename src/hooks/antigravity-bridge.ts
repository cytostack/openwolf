/**
 * OpenWolf <-> Antigravity CLI Bridge
 * Translates Antigravity CLI hook events to OpenWolf hook scripts and back.
 */

import * as cp from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import * as crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const WOLF_HOOKS = SCRIPT_DIR;

// shared.ts's getProjectDir()/detectAgent() check these other agents' env
// vars before OPENWOLF_PROJECT_ROOT/ANTIGRAVITY. If the bridge itself runs
// nested inside one of those harnesses' own process tree, the inherited
// vars would outrank ours and the spawned wolf hook would resolve the
// wrong project root and/or attribute checkpoints to the wrong agent.
const FOREIGN_AGENT_ENV_VARS = [
  "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_PROJECT_DIR",
  "CODEX_PROJECT_ROOT", "CODEX_SANDBOX", "CODEX_THREAD_ID",
  "OPENCODE", "OPENCODE_PROJECT_ROOT",
  "GROK_HOOK_EVENT", "GROK_SESSION_ID", "GROK_WORKSPACE_ROOT",
];

// Mirrors the `timeout` (seconds) registered for each event/subtype in
// src/agents/antigravity.ts's buildAntigravityHooks(). The wolf hook it
// spawns must be killed comfortably before Antigravity's own harness-level
// timeout, or the bridge gets killed mid-run before it can even report a
// partial result. A flat, shorter budget for every event starved
// post-write/post-bash (registered at 10s) and anatomy updates for large
// files were killed mid-run on every call.
function hookTimeoutMs(event: string, subtype: string): number {
  if (event === "PostToolUse" && (subtype === "write" || subtype === "bash")) return 9000;
  if (event === "Stop") return 9000;
  return 4500;
}

// Tool name mapping: Antigravity -> OpenWolf
const TOOL_NAME_MAP: Record<string, string> = {
  view_file: "Read",
  write_to_file: "Write",
  replace_file_content: "Edit",
  run_command: "Bash",
};

// Cached under the project's own .wolf/ dir (not a shared, world-writable
// temp dir) and written via a uniquely-named tmp file + rename so a
// pre-planted symlink at the cache path can't be used to read or overwrite
// an arbitrary file.
function getCachePath(workspaceRoot: string, conversationId: string, stepIdx: unknown): string {
  const safeId = (conversationId || "default").replace(/[^a-zA-Z0-9_-]/g, "_");
  // Keyed by stepIdx too: two tool calls in the same conversation can be
  // in flight at once, and without this a PostToolUse for one call could
  // pick up the cache entry another call just clobbered.
  const stepKey = typeof stepIdx === "number" || typeof stepIdx === "string" ? String(stepIdx) : "unknown";
  return path.join(workspaceRoot, ".wolf", "cache", `antigravity-last-tool-${safeId}-${stepKey}.json`);
}

function writeCacheFile(cacheFile: string, data: unknown): void {
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    const tmp = `${cacheFile}.${crypto.randomUUID()}.tmp`;
    const fd = fs.openSync(tmp, "wx", 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(data));
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, cacheFile);
  } catch {}
}

function translateArgs(toolName: string, args: Record<string, any> = {}): Record<string, any> {
  switch (toolName) {
    case "view_file": {
      // OpenWolf's `limit` is a line COUNT (offset + limit lines), while
      // Antigravity's EndLine is an absolute line number; passing EndLine
      // straight through as `limit` requested far more lines than intended
      // for any view starting past line 1.
      const startLine = args.StartLine !== undefined ? args.StartLine : undefined;
      const endLine = args.EndLine !== undefined ? args.EndLine : undefined;
      return {
        file_path: args.AbsolutePath || args.file_path || "",
        offset: startLine,
        limit: startLine !== undefined && endLine !== undefined ? endLine - startLine + 1 : endLine,
      };
    }
    case "write_to_file":
      return {
        file_path: args.TargetFile || args.file_path || "",
        content: args.CodeContent || args.content || "",
      };
    case "replace_file_content":
      return {
        file_path: args.TargetFile || args.file_path || "",
        old_string: args.TargetContent || args.old_string || "",
        new_string: args.ReplacementContent || args.new_string || "",
      };
    case "run_command":
      return {
        command: args.CommandLine || args.command || "",
      };
    default:
      return args;
  }
}

// The PostToolUse payload's result shape isn't documented; try the field
// names Antigravity's PreToolUse args use the camelCase/PascalCase sibling
// of, falling back gracefully. post-bash.js requires {stdout, stderr}.
function extractToolResponse(agiPayload: Record<string, any>, tc: Record<string, any>): Record<string, any> {
  return tc.response || tc.result || agiPayload.toolResponse || agiPayload.response || agiPayload.result || {};
}

function translateResponse(toolName: string, resp: Record<string, any> = {}): Record<string, any> {
  if (toolName === "run_command") {
    return {
      stdout: resp.Output ?? resp.output ?? resp.Stdout ?? resp.stdout ?? "",
      stderr: resp.Error ?? resp.error ?? resp.Stderr ?? resp.stderr ?? "",
      exit_code: resp.ExitCode ?? resp.exitCode ?? resp.exit_code,
    };
  }
  return resp;
}

// process.stdout.write() can return before a large payload is actually
// flushed (a pipe write can be async under backpressure), so exiting right
// after calling it truncates output over ~64KB — including a `deny`
// decision. Exit from the write's own callback instead. Callers must
// `return` immediately after calling this (it doesn't halt execution the
// way process.exit() alone would).
function writeAndExit(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj), () => process.exit(0));
  // Backstop in case the callback never fires (e.g. stdout already closed).
  setTimeout(() => process.exit(0), 3000).unref();
}

function readAllStdin(): Promise<string> {
  return new Promise((resolve) => {
    let settled = false;
    const chunks: Buffer[] = [];
    const done = (val: string) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(val);
      }
    };
    const timer = setTimeout(() => {
      done(chunks.length > 0 ? Buffer.concat(chunks).toString("utf-8") : "");
    }, 1000);
    timer.unref();

    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on("end", () => {
      done(Buffer.concat(chunks).toString("utf-8"));
    });
    process.stdin.on("error", () => {
      done(Buffer.concat(chunks).toString("utf-8"));
    });
  });
}

function runWolfHook(scriptName: string, stdinPayload: unknown, workspaceRoot: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    const scriptPath = path.join(WOLF_HOOKS, scriptName);
    if (!fs.existsSync(scriptPath)) {
      resolve("");
      return;
    }

    let settled = false;
    const done = (val: string) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(val);
      }
    };

    const childEnv = { ...process.env };
    for (const key of FOREIGN_AGENT_ENV_VARS) delete childEnv[key];

    const child = cp.spawn("node", [scriptPath], {
      env: {
        ...childEnv,
        OPENWOLF_PROJECT_ROOT: workspaceRoot,
        ANTIGRAVITY: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.on("close", () => done(stdout));
    child.on("error", () => done(""));

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      done(stdout);
    }, timeoutMs);
    timer.unref();

    try {
      child.stdin.end(JSON.stringify(stdinPayload));
    } catch {
      done("");
    }
  });
}

async function main(): Promise<void> {
  const event = process.argv[2] || "unknown";
  const subtype = process.argv[3] || "read";

  const rawStdin = await readAllStdin();
  let agiPayload: Record<string, any> = {};
  if (rawStdin) {
    try {
      agiPayload = JSON.parse(rawStdin);
    } catch {}
  }

  const conversationId = agiPayload.conversationId || "default";
  const workspaceRoot = (agiPayload.workspacePaths && agiPayload.workspacePaths[0]) || PROJECT_ROOT;
  const tc = agiPayload.toolCall || {};
  const toolName = tc.name || "";
  const cacheFile = getCachePath(workspaceRoot, conversationId, agiPayload.stepIdx);

  if (event === "PreToolUse") {
    const wolfToolName = TOOL_NAME_MAP[toolName] || toolName;
    const toolInput = translateArgs(toolName, tc.args || {});

    writeCacheFile(cacheFile, {
      toolName,
      wolfToolName,
      toolInput,
      stepIdx: agiPayload.stepIdx,
    });

    const wolfScript = subtype === "write" ? "pre-write.js" : subtype === "bash" ? "pre-bash.js" : "pre-read.js";
    const wolfInput = {
      session_id: conversationId,
      tool_name: wolfToolName,
      tool_input: toolInput,
    };

    const rawOutput = await runWolfHook(wolfScript, wolfInput, workspaceRoot, hookTimeoutMs(event, subtype));
    let outputObj: Record<string, any> = {};
    try {
      outputObj = JSON.parse(rawOutput);
    } catch {}

    const specific = outputObj.hookSpecificOutput || {};
    if (specific.permissionDecision === "block" || specific.permissionDecision === "deny") {
      writeAndExit({
        decision: "deny",
        reason: specific.permissionDecisionReason || "Blocked by OpenWolf rule",
      });
      return;
    }

    if (specific.additionalContext) {
      writeAndExit({ reason: specific.additionalContext });
      return;
    }

    writeAndExit({});
    return;
  }

  if (event === "PostToolUse") {
    let cached: any = null;
    try {
      if (fs.existsSync(cacheFile)) {
        cached = JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
      }
    } catch {}
    // Cache is keyed by stepIdx already, but a killed/timed-out PreToolUse
    // can leave a stale entry that a later invocation reuses; belt-and-
    // suspenders check the stepIdx recorded in the cache matches this event.
    if (cached && cached.stepIdx !== agiPayload.stepIdx) cached = null;
    try {
      fs.unlinkSync(cacheFile);
    } catch {}

    if (cached && !agiPayload.error) {
      const wolfScript = subtype === "write" ? "post-write.js" : subtype === "bash" ? "post-bash.js" : "post-read.js";
      const wolfInput = {
        session_id: conversationId,
        tool_name: cached.wolfToolName,
        tool_input: cached.toolInput,
        tool_response: translateResponse(cached.toolName, extractToolResponse(agiPayload, tc)),
      };
      await runWolfHook(wolfScript, wolfInput, workspaceRoot, hookTimeoutMs(event, subtype));
    }

    writeAndExit({});
    return;
  }

  if (event === "PreInvocation") {
    if (agiPayload.invocationNum === 1) {
      const wolfInput = {
        session_id: conversationId,
      };
      const rawOutput = await runWolfHook("session-start.js", wolfInput, workspaceRoot, hookTimeoutMs(event, subtype));
      let outputObj: Record<string, any> = {};
      try {
        outputObj = JSON.parse(rawOutput);
      } catch {}

      const specific = outputObj.hookSpecificOutput || {};
      if (specific.additionalContext) {
        writeAndExit({
          injectSteps: [{ ephemeralMessage: specific.additionalContext }],
        });
        return;
      }
    }

    writeAndExit({ injectSteps: [] });
    return;
  }

  if (event === "Stop") {
    const wolfInput = {
      session_id: conversationId,
      transcript_path: agiPayload.transcriptPath,
    };
    await runWolfHook("stop.js", wolfInput, workspaceRoot, hookTimeoutMs(event, subtype));
    writeAndExit({});
    return;
  }

  writeAndExit({});
  return;
}

main().catch(() => {
  writeAndExit({});
});
