// openwolf:managed-omp-hook
// Bridge OMP's native extension events to the provider-agnostic OpenWolf hooks.
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";

type AnyRecord = Record<string, any>;
const TIMEOUT_MS = 12_000;

function sessionId(event: AnyRecord, ctx: AnyRecord) {
  const fromContext = ctx?.sessionManager?.getSessionId;
  return event?.session_id ?? event?.sessionId ??
    (typeof fromContext === "function" ? fromContext.call(ctx.sessionManager) : "");
}

function rootFor(ctx: AnyRecord) {
  return path.resolve(ctx?.cwd ?? process.cwd());
}

function basePayload(event: AnyRecord, ctx: AnyRecord) {
  return {
    session_id: sessionId(event, ctx),
    cwd: rootFor(ctx),
  };
}

function textFromContent(content: unknown) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block: AnyRecord) => block && typeof block.text === "string" ? block.text : "")
    .join("");
}

function toolPayload(event: AnyRecord, ctx: AnyRecord, result: boolean) {
  const input = event?.input ?? {};
  const text = textFromContent(event?.content);
  return {
    ...basePayload(event, ctx),
    tool_name: event?.toolName,
    tool_use_id: event?.toolCallId,
    tool_input: input,
    tool_response: result === true
      ? { content: text, stdout: event?.toolName === "bash" ? text : "", stderr: "" }
      : undefined,
    tool_output: result === true ? { content: text } : undefined,
  };
}

function parseOutput(stdout: string): AnyRecord {
  const text = stdout.trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function runHook(root: string, script: string, payload: AnyRecord): Promise<AnyRecord> {
  const scriptPath = path.join(root, ".wolf", "hooks", script);
  if (!fs.existsSync(scriptPath)) return Promise.resolve({});

  return new Promise((resolve) => {
    const child = spawn(process.env.OPENWOLF_NODE ?? "node", [scriptPath], {
      cwd: root,
      env: {
        ...process.env,
        OPENWOLF_PROJECT_ROOT: root,
        OMP_HOOK_EVENT: script,
        OMP_SESSION_ID: payload.session_id ?? "",
      },
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });
    let stdout = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({});
    }, TIMEOUT_MS);
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.on("error", () => { clearTimeout(timer); resolve({}); });
    child.on("close", () => {
      clearTimeout(timer);
      resolve(parseOutput(stdout));
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

function hookFields(output: AnyRecord): AnyRecord {
  return output?.hookSpecificOutput ?? {};
}

function contextText(output: AnyRecord): string {
  const fields = hookFields(output);
  return [fields.additionalContext, output?.systemMessage]
    .filter((value) => typeof value === "string" && value.length > 0)
    .join("\n\n");
}

async function sendContext(pi: AnyRecord, text: string, deliverAs = "aside") {
  if (!text) return;
  try {
    await pi.sendMessage(
      {
        customType: "openwolf",
        content: text,
        display: false,
        details: { source: "openwolf-hook" },
      },
      { deliverAs, attribution: "agent" },
    );
  } catch {}
}

function eventScript(toolName: string, phase: string): string | undefined {
  if (phase === "pre") {
    if (toolName === "bash") return "pre-bash.js";
    if (toolName === "read") return "pre-read.js";
    if (["edit", "write", "apply_patch", "multiedit"].includes(toolName)) return "pre-write.js";
  }
  if (phase === "post") {
    if (toolName === "bash") return "post-bash.js";
    if (toolName === "read") return "post-read.js";
    if (["edit", "write", "apply_patch", "multiedit"].includes(toolName)) return "post-write.js";
  }
  return undefined;
}

function updatedResult(event: AnyRecord, output: AnyRecord): AnyRecord | undefined {
  const updated = hookFields(output).updatedToolOutput;
  if (!updated || event?.toolName !== "bash" || typeof updated.stdout !== "string") return undefined;
  const content = Array.isArray(event.content)
    ? event.content.map((block: AnyRecord) => block && block.type === "text" ? { ...block, text: updated.stdout } : block)
    : [{ type: "text", text: updated.stdout }];
  return { content, details: event.details, isError: event.isError };
}

export default function openwolf(pi: AnyRecord) {
  pi.on("session_start", async (event: AnyRecord, ctx: AnyRecord) => {
    const output = await runHook(rootFor(ctx), "session-start.js", {
      ...basePayload(event, ctx),
      source: event?.source ?? "startup",
    });
    await sendContext(pi, contextText(output), "nextTurn");
  });

  pi.on("before_agent_start", async (event: AnyRecord, ctx: AnyRecord) => {
    const output = await runHook(rootFor(ctx), "user-prompt-submit.js", {
      ...basePayload(event, ctx),
      prompt: event?.prompt ?? "",
    });
    const text = contextText(output);
    return text ? {
      message: {
        customType: "openwolf",
        content: text,
        display: false,
        details: { source: "openwolf-hook" },
      },
    } : undefined;
  });

  pi.on("tool_call", async (event: AnyRecord, ctx: AnyRecord) => {
    const script = eventScript(event?.toolName, "pre");
    if (!script) return;
    const output = await runHook(rootFor(ctx), script, toolPayload(event, ctx, false));
    const fields = hookFields(output);
    if (fields.permissionDecision === "deny") {
      return { block: true, reason: fields.permissionDecisionReason ?? "OpenWolf denied this tool call" };
    }
    await sendContext(pi, contextText(output));
  });

  pi.on("tool_result", async (event: AnyRecord, ctx: AnyRecord) => {
    const script = eventScript(event?.toolName, "post");
    if (!script) return;
    const output = await runHook(rootFor(ctx), script, toolPayload(event, ctx, true));
    await sendContext(pi, contextText(output));
    return updatedResult(event, output);
  });

  pi.on("session_before_compact", async (event: AnyRecord, ctx: AnyRecord) => {
    await runHook(rootFor(ctx), "precompact.js", {
      ...basePayload(event, ctx),
      trigger: event?.trigger ?? "compact",
    });
  });

  pi.on("session_stop", async (event: AnyRecord, ctx: AnyRecord) => {
    const output = await runHook(rootFor(ctx), "stop.js", {
      ...basePayload(event, ctx),
      transcript_path: event?.transcript_path,
    });
    await sendContext(pi, contextText(output), "nextTurn");
  });

  pi.on("session_shutdown", async (event: AnyRecord, ctx: AnyRecord) => {
    const output = await runHook(rootFor(ctx), "session-end.js", {
      ...basePayload(event, ctx),
      reason: event?.reason ?? "shutdown",
      transcript_path: event?.transcript_path,
    });
    await sendContext(pi, contextText(output), "nextTurn");
  });
}
