import { test, describe } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync, execFile } from "node:child_process";

import { recordHeartbeat, getSessionFilePath, gcSessionFiles } from "../src/hooks/shared.ts";

const DIST_HOOKS = path.resolve(import.meta.dirname ?? ".", "..", "dist", "hooks");

function tmpProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-hh-"));
  fs.mkdirSync(path.join(root, ".wolf", "hooks"), { recursive: true });
  return root;
}

function withProjectEnv<T>(root: string, fn: () => T): T {
  const prev = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = root;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = prev;
  }
}

function installHooks(root: string): string {
  const hooksDir = path.join(root, ".wolf", "hooks");
  fs.cpSync(DIST_HOOKS, hooksDir, { recursive: true });
  fs.writeFileSync(path.join(hooksDir, "package.json"), JSON.stringify({ type: "module" }));
  return hooksDir;
}

function sessionPath(root: string, id: string): string {
  return path.join(root, ".wolf", "hooks", "sessions", `${id}.json`);
}

function readSession(root: string, id: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(sessionPath(root, id), "utf-8"));
}

function assertCompleteSession(root: string, id: string, message: string): Record<string, any> {
  const session = readSession(root, id);
  assert.strictEqual(session.session_id, id, `${message}: session_id`);
  assert.strictEqual(typeof session.started, "string", `${message}: started`);
  assert.ok(session.started.length > 0, `${message}: started value`);
  assert.ok(session.files_read && typeof session.files_read === "object" && !Array.isArray(session.files_read), `${message}: files_read`);
  assert.ok(Array.isArray(session.files_written), `${message}: files_written`);
  assert.ok(session.edit_counts && typeof session.edit_counts === "object" && !Array.isArray(session.edit_counts), `${message}: edit_counts`);
  assert.strictEqual(typeof session.anatomy_hits, "number", `${message}: anatomy_hits`);
  assert.strictEqual(typeof session.anatomy_misses, "number", `${message}: anatomy_misses`);
  assert.strictEqual(typeof session.repeated_reads_warned, "number", `${message}: repeated_reads_warned`);
  assert.strictEqual(typeof session.stop_count, "number", `${message}: stop_count`);
  assert.ok(session.reminders_sent && typeof session.reminders_sent === "object" && !Array.isArray(session.reminders_sent), `${message}: reminders_sent`);
  return session;
}

function runInstalledHook(
  hooksDir: string,
  file: string,
  payload: unknown,
  cwd: string,
  envExtra: NodeJS.ProcessEnv = {}
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, ...envExtra };
    delete env.CLAUDE_PROJECT_DIR;
    delete env.OPENWOLF_PROJECT_ROOT;
    const child = execFile(
      process.execPath,
      [path.join(hooksDir, file)],
      { cwd, env, timeout: 10000 },
      (err, stdout) => (err ? reject(err) : resolve({ stdout }))
    );
    child.stdin!.end(JSON.stringify(payload));
  });
}

function largeOutput(prefix = "line"): string {
  return Array.from({ length: 260 }, (_, i) => `${prefix} ${i} ${"x".repeat(60)}`).join("\n");
}

describe("heartbeat", () => {
  test("records success and failure with consecutive counts", () => {
    const root = tmpProject();
    withProjectEnv(root, () => {
      recordHeartbeat("pre-read");
      recordHeartbeat("post-write", new Error("boom"));
      recordHeartbeat("post-write", new Error("boom again"));
      const beats = JSON.parse(fs.readFileSync(path.join(root, ".wolf", "hooks", "_heartbeat.json"), "utf-8"));
      assert.ok(beats["pre-read"].last_ok);
      assert.strictEqual(beats["pre-read"].consecutive_failures, 0);
      assert.strictEqual(beats["post-write"].consecutive_failures, 2);
      assert.ok(beats["post-write"].last_error_message.includes("boom"));
      // Recovery resets the streak.
      recordHeartbeat("post-write");
      const after = JSON.parse(fs.readFileSync(path.join(root, ".wolf", "hooks", "_heartbeat.json"), "utf-8"));
      assert.strictEqual(after["post-write"].consecutive_failures, 0);
    });
  });
});

describe("session keying", () => {
  test("session_id maps to its own file; missing id falls back to legacy", () => {
    const root = tmpProject();
    withProjectEnv(root, () => {
      const a = getSessionFilePath({ session_id: "abc-123" });
      const b = getSessionFilePath({ session_id: "def-456" });
      const legacy = getSessionFilePath({});
      assert.ok(a.endsWith(path.join("sessions", "abc-123.json")));
      assert.notStrictEqual(a, b);
      assert.ok(legacy.endsWith("_session.json"));
      // Hostile ids never escape the sessions dir.
      const evil = getSessionFilePath({ session_id: "../../etc/passwd" });
      assert.ok(evil.endsWith("_session.json"));
    });
  });

  test("gc removes only old session files", () => {
    const root = tmpProject();
    withProjectEnv(root, () => {
      const dir = path.join(root, ".wolf", "hooks", "sessions");
      fs.mkdirSync(dir, { recursive: true });
      const oldFile = path.join(dir, "old.json");
      const newFile = path.join(dir, "new.json");
      fs.writeFileSync(oldFile, "{}");
      fs.writeFileSync(newFile, "{}");
      const past = Date.now() / 1000 - 10 * 24 * 3600;
      fs.utimesSync(oldFile, past, past);
      gcSessionFiles(7);
      assert.strictEqual(fs.existsSync(oldFile), false);
      assert.strictEqual(fs.existsSync(newFile), true);
    });
  });
});

describe("compiled hook integration", () => {
  test("--selfcheck passes on a healthy install and fails on a broken one", () => {
    const root = tmpProject();
    const hooksDir = path.join(root, ".wolf", "hooks");
    for (const f of fs.readdirSync(DIST_HOOKS)) {
      if (f.endsWith(".js")) fs.copyFileSync(path.join(DIST_HOOKS, f), path.join(hooksDir, f));
    }
    fs.writeFileSync(path.join(hooksDir, "package.json"), JSON.stringify({ type: "module" }));

    const out = execFileSync(process.execPath, [path.join(hooksDir, "pre-read.js"), "--selfcheck"], { encoding: "utf-8" });
    assert.ok(out.includes("ok pre-read"));

    // Induce the exact 440-crash class: delete a dependency, not the hook.
    fs.unlinkSync(path.join(hooksDir, "anatomy-store.js"));
    assert.throws(() => {
      execFileSync(process.execPath, [path.join(hooksDir, "pre-read.js"), "--selfcheck"], { stdio: "pipe" });
    });
  });

  test("two sessions do not cross-contaminate duplicate tracking", async () => {
    const root = tmpProject();
    const hooksDir = path.join(root, ".wolf", "hooks");
    for (const f of fs.readdirSync(DIST_HOOKS)) {
      if (f.endsWith(".js")) fs.copyFileSync(path.join(DIST_HOOKS, f), path.join(hooksDir, f));
    }
    fs.writeFileSync(path.join(hooksDir, "package.json"), JSON.stringify({ type: "module" }));
    const target = path.join(root, "src.ts");
    fs.writeFileSync(target, "export const x = 1;\n");

    const runHook = (file: string, payload: unknown): Promise<{ stdout: string }> =>
      new Promise((resolve, reject) => {
        const child = execFile(
          process.execPath,
          [path.join(hooksDir, file)],
          { env: { ...process.env, CLAUDE_PROJECT_DIR: root }, timeout: 10000 },
          (err, stdout) => (err ? reject(err) : resolve({ stdout }))
        );
        child.stdin!.end(JSON.stringify(payload));
      });

    // Session A reads the file twice (full): pre-read + post-read then pre-read again.
    await runHook("pre-read.js", { session_id: "sessA", tool_input: { file_path: target } });
    await runHook("post-read.js", { session_id: "sessA", tool_input: { file_path: target }, tool_response: { file: { content: "export const x = 1;\n" } } });
    const dupA = await runHook("pre-read.js", { session_id: "sessA", tool_input: { file_path: target } });
    assert.ok(dupA.stdout.includes("already read this session"), "same session sees the duplicate warning");

    // Session B reads the same file for the FIRST time: no warning.
    const freshB = await runHook("pre-read.js", { session_id: "sessB", tool_input: { file_path: target } });
    assert.ok(!freshB.stdout.includes("already read this session"), "other session must not inherit A's reads");

    // Ranged read in a third session then a full read: no duplicate warning.
    await runHook("pre-read.js", { session_id: "sessC", tool_input: { file_path: target, offset: 1, limit: 1 } });
    const fullAfterRanged = await runHook("pre-read.js", { session_id: "sessC", tool_input: { file_path: target } });
    assert.ok(!fullAfterRanged.stdout.includes("already read this session"), "ranged contact must not mark the file as fully read");

    assert.ok(fs.existsSync(path.join(hooksDir, "sessions", "sessA.json")));
    assert.ok(fs.existsSync(path.join(hooksDir, "sessions", "sessB.json")));
  });

  test("accounts for Claude and Codex activity when SessionStart was missed", async () => {
    const installedRoot = tmpProject();
    const { resolveAgents } = await import("../dist/src/agents/index.js");
    const codexAdapter = resolveAgents(["codex"])[0];
    codexAdapter.install({
      projectRoot: installedRoot,
      wolfDir: path.join(installedRoot, ".wolf"),
      templatesDir: path.resolve("src", "templates"),
    });
    const installedHooks = JSON.parse(fs.readFileSync(path.join(installedRoot, ".codex", "hooks.json"), "utf-8"));
    assert.ok(installedHooks.hooks.PreToolUse.some((entry: { matcher: string; hooks: Array<{ command: string }> }) => entry.matcher === "Bash" && entry.hooks[0].command.endsWith("pre-bash.js\"")));
    assert.ok(installedHooks.hooks.PostToolUse.some((entry: { matcher: string; hooks: Array<{ command: string }> }) => entry.matcher === "Bash" && entry.hooks[0].command.endsWith("post-bash.js\"")));

    const exercise = async (runtime: "claude" | "codex") => {
      const root = tmpProject();
      const decoyRoot = tmpProject();
      const hooksDir = path.join(runtime === "codex" ? decoyRoot : root, ".wolf", "hooks");
      fs.cpSync(DIST_HOOKS, hooksDir, { recursive: true });
      fs.writeFileSync(path.join(hooksDir, "package.json"), JSON.stringify({ type: "module" }));
      const nestedCwd = path.join(root, "nested", "work");
      fs.mkdirSync(nestedCwd, { recursive: true });

      const readTarget = path.join(root, "read.ts");
      const writeTarget = path.join(root, "write.ts");
      fs.writeFileSync(readTarget, "export const read = 1;\n");
      fs.writeFileSync(writeTarget, "export const write = 1;\n");

      const sessionId = `${runtime}-missed-start`;
      const runHook = (file: string, payload: unknown, cwd = root): Promise<{ stdout: string }> =>
        new Promise((resolve, reject) => {
          const env = { ...process.env };
          delete env.CLAUDE_PROJECT_DIR;
          delete env.CODEX_PROJECT_ROOT;
          delete env.OPENWOLF_PROJECT_ROOT;
          if (runtime === "claude") env.CLAUDE_PROJECT_DIR = root;

          const child = execFile(
            process.execPath,
            [path.join(hooksDir, file)],
            { cwd, env, timeout: 10000 },
            (err, stdout) => (err ? reject(err) : resolve({ stdout }))
          );
          child.stdin!.end(JSON.stringify(payload));
        });

      if (runtime === "claude") {
        await runHook("post-read.js", {
          session_id: sessionId,
          tool_name: "Read",
          tool_input: { file_path: readTarget },
          tool_response: { file: { content: "export const read = 1;\n" } },
        });
      } else {
        const largeOutput = Array.from({ length: 240 }, (_, i) => `line ${i} ${"x".repeat(40)}`).join("\n");
        const stringRun = await runHook("post-bash.js", {
          session_id: sessionId,
          tool_name: "Bash",
          tool_input: { command: `cat ${readTarget}` },
          tool_response: largeOutput,
        }, nestedCwd);
        assert.notStrictEqual(stringRun.stdout, "", "official string response must produce hook output");
        const stringHookOutput = JSON.parse(stringRun.stdout);
        assert.strictEqual(typeof stringHookOutput.hookSpecificOutput.updatedToolOutput, "string");

        const objectResponse = {
          stdout: Array.from({ length: 240 }, (_, i) => `diff line ${i} ${"y".repeat(40)}`).join("\n"),
          stderr: "sentinel stderr\n",
          exit_code: 17,
          metadata: { sentinel: "preserve-byte-for-byte" },
        };
        const objectRun = await runHook("post-bash.js", {
          session_id: sessionId,
          tool_name: "Bash",
          tool_input: { command: "git show HEAD" },
          tool_response: objectResponse,
        }, nestedCwd);
        assert.notStrictEqual(objectRun.stdout, "", "object response must produce hook output");
        const objectReplacement = JSON.parse(objectRun.stdout).hookSpecificOutput.updatedToolOutput;
        assert.strictEqual(typeof objectReplacement, "object");
        assert.notStrictEqual(objectReplacement.stdout, objectResponse.stdout);
        assert.deepStrictEqual({ ...objectReplacement, stdout: objectResponse.stdout }, objectResponse);
      }
      if (runtime === "codex") {
        const recoveredPath = path.join(root, ".wolf", "hooks", "sessions", `${sessionId}.json`);
        assert.ok(fs.existsSync(recoveredPath), "Codex session must exist under the active cwd root");
        const recovered = JSON.parse(fs.readFileSync(recoveredPath, "utf-8"));
        assert.strictEqual(recovered.session_id, sessionId, "Bash recovery keeps the session ID before the write hook");
      }
      await runHook("post-write.js", {
        session_id: sessionId,
        tool_name: runtime === "claude" ? "Edit" : "apply_patch",
        tool_input: { file_path: writeTarget, old_string: "1", new_string: "2" },
      }, runtime === "codex" ? nestedCwd : root);

      const sessionPath = path.join(root, ".wolf", "hooks", "sessions", `${sessionId}.json`);
      const session = JSON.parse(fs.readFileSync(sessionPath, "utf-8"));
      assert.strictEqual(Object.keys(session.files_read).length, 1, `${runtime} unique read accounting`);
      assert.strictEqual(Object.values(session.files_read)[0].count, 1, `${runtime} read count`);
      assert.strictEqual(session.files_written.length, 1, `${runtime} unique write accounting`);

      await runHook("stop.js", { session_id: sessionId }, runtime === "codex" ? nestedCwd : root);

      const ledgerPath = path.join(root, ".wolf", "token-ledger.json");
      assert.ok(fs.existsSync(ledgerPath), `${runtime} Stop must persist the ledger`);
      const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf-8"));
      assert.strictEqual(ledger.lifetime.total_reads, 1, `${runtime} read accounting`);
      assert.strictEqual(ledger.lifetime.total_writes, 1, `${runtime} write accounting`);
      assert.ok(!fs.existsSync(path.join(decoyRoot, ".wolf", "hooks", "sessions", `${sessionId}.json`)), `${runtime} must not create a decoy session`);
      assert.ok(!fs.existsSync(path.join(decoyRoot, ".wolf", "token-ledger.json")), `${runtime} must not create a decoy ledger`);
    };

    await exercise("claude");
    await exercise("codex");
  });

  test("governed Bash and ranged Read preserve complete session shape before Stop", async () => {
    const root = tmpProject();
    const decoyRoot = tmpProject();
    const hooksDir = installHooks(decoyRoot);
    const nestedCwd = path.join(root, "nested", "work");
    fs.mkdirSync(nestedCwd, { recursive: true });
    const readTarget = path.join(root, "read.ts");
    fs.writeFileSync(readTarget, "export const read = 1;\n");
    const sessionId = "shape-core";

    await runInstalledHook(hooksDir, "post-bash.js", {
      session_id: sessionId,
      tool_name: "Bash",
      tool_input: { command: "git show HEAD" },
      tool_response: { stdout: largeOutput("diff"), stderr: "", exit_code: 0 },
    }, nestedCwd, { CODEX_PROJECT_ROOT: decoyRoot });
    assertCompleteSession(root, sessionId, "post-bash governed writer");

    await runInstalledHook(hooksDir, "pre-read.js", {
      session_id: sessionId,
      tool_input: { file_path: readTarget, offset: 1, limit: 1 },
    }, nestedCwd, { CODEX_PROJECT_ROOT: decoyRoot });
    assertCompleteSession(root, sessionId, "pre-read ranged writer");

    await runInstalledHook(hooksDir, "stop.js", { session_id: sessionId }, nestedCwd, { CODEX_PROJECT_ROOT: decoyRoot });
    const session = assertCompleteSession(root, sessionId, "stop terminal reader");
    assert.strictEqual(session.stop_count, 1);
    const ledger = JSON.parse(fs.readFileSync(path.join(root, ".wolf", "token-ledger.json"), "utf-8"));
    assert.strictEqual(ledger.lifetime.total_reads, 1);
    assert.strictEqual(ledger.lifetime.total_writes, 0);
    assert.ok(!fs.existsSync(sessionPath(decoyRoot, sessionId)), "legacy CODEX_PROJECT_ROOT must not receive session state");
    assert.ok(!fs.existsSync(path.join(decoyRoot, ".wolf", "token-ledger.json")), "legacy CODEX_PROJECT_ROOT must not receive ledger state");
  });

  test("relative Bash reads resolve from the hook command cwd", async () => {
    const root = tmpProject();
    const decoyRoot = tmpProject();
    const hooksDir = installHooks(decoyRoot);
    const nestedCwd = path.join(root, "nested", "work");
    fs.mkdirSync(nestedCwd, { recursive: true });
    const readTarget = path.join(nestedCwd, "local.ts");
    fs.writeFileSync(readTarget, "export const local = 1;\n");
    const sessionId = "relative-bash-cwd";

    await runInstalledHook(hooksDir, "post-bash.js", {
      session_id: sessionId,
      tool_name: "Bash",
      tool_input: { command: "cat local.ts" },
      tool_response: "export const local = 1;\n",
    }, nestedCwd, { CODEX_PROJECT_ROOT: decoyRoot });

    const session = assertCompleteSession(root, sessionId, "relative Bash cwd");
    assert.deepStrictEqual(Object.keys(session.files_read), [readTarget]);
    assert.ok(!fs.existsSync(sessionPath(decoyRoot, sessionId)));
  });

  test("stop normalizes legacy partial session state before ledger accounting", async () => {
    const root = tmpProject();
    const hooksDir = installHooks(root);
    const sessionId = "shape-stop-legacy";
    const readTarget = path.join(root, "read.ts");
    fs.mkdirSync(path.dirname(sessionPath(root, sessionId)), { recursive: true });
    fs.writeFileSync(sessionPath(root, sessionId), JSON.stringify({
      files_read: {
        [readTarget]: { count: 1, tokens: 0, first_read: new Date().toISOString(), ranged: true },
      },
    }, null, 2));

    await runInstalledHook(hooksDir, "stop.js", { session_id: sessionId }, root);
    const session = assertCompleteSession(root, sessionId, "stop legacy partial reader");
    assert.strictEqual(session.stop_count, 1);
    const ledger = JSON.parse(fs.readFileSync(path.join(root, ".wolf", "token-ledger.json"), "utf-8"));
    assert.strictEqual(ledger.lifetime.total_reads, 1);
    assert.strictEqual(ledger.lifetime.total_writes, 0);
  });

  test("current hook session id overrides stale persisted identity", async () => {
    const root = tmpProject();
    const hooksDir = installHooks(root);
    const sessionId = "current-session";
    const readTarget = path.join(root, "read.ts");
    fs.mkdirSync(path.dirname(sessionPath(root, sessionId)), { recursive: true });
    fs.writeFileSync(sessionPath(root, sessionId), JSON.stringify({
      session_id: "stale-session",
      files_read: {
        [readTarget]: { count: 1, tokens: 0, first_read: new Date().toISOString() },
      },
    }, null, 2));

    await runInstalledHook(hooksDir, "stop.js", { session_id: sessionId }, root);
    const session = assertCompleteSession(root, sessionId, "authoritative hook session id");
    assert.strictEqual(session.session_id, sessionId);
    const ledger = JSON.parse(fs.readFileSync(path.join(root, ".wolf", "token-ledger.json"), "utf-8"));
    assert.strictEqual(ledger.sessions.at(-1).id, sessionId);
  });

  test("malformed nested accounting records normalize to finite ledger values", async () => {
    const root = tmpProject();
    const hooksDir = installHooks(root);
    const sessionId = "malformed-records";
    const readTarget = path.join(root, "read.ts");
    const writeTarget = path.join(root, "write.ts");
    fs.mkdirSync(path.dirname(sessionPath(root, sessionId)), { recursive: true });
    fs.writeFileSync(sessionPath(root, sessionId), JSON.stringify({
      session_id: sessionId,
      files_read: { [readTarget]: {} },
      files_written: [{}, { file: writeTarget }],
    }, null, 2));

    await runInstalledHook(hooksDir, "stop.js", { session_id: sessionId }, root);
    const session = assertCompleteSession(root, sessionId, "malformed nested records");
    assert.strictEqual(session.files_read[readTarget].count, 1);
    assert.strictEqual(session.files_read[readTarget].tokens, 0);
    assert.deepStrictEqual(session.files_written.map((entry: { file: string }) => entry.file), [writeTarget]);
    assert.strictEqual(session.files_written[0].tokens, 0);
    const ledger = JSON.parse(fs.readFileSync(path.join(root, ".wolf", "token-ledger.json"), "utf-8"));
    const entry = ledger.sessions.at(-1);
    assert.ok(Number.isFinite(entry.totals.input_tokens_estimated));
    assert.ok(Number.isFinite(entry.totals.output_tokens_estimated));
    assert.strictEqual(entry.writes.length, 1);
    assert.strictEqual(entry.writes[0].file, writeTarget);
  });

  test("pre-read ranged preserves complete session shape immediately", async () => {
    const root = tmpProject();
    const hooksDir = installHooks(root);
    const readTarget = path.join(root, "read.ts");
    fs.writeFileSync(readTarget, "export const read = 1;\n");
    const sessionId = "shape-pre-read";

    await runInstalledHook(hooksDir, "pre-read.js", {
      session_id: sessionId,
      tool_input: { file_path: readTarget, offset: 1, limit: 1 },
    }, root);
    const session = assertCompleteSession(root, sessionId, "pre-read ranged writer");
    assert.strictEqual(session.files_read[readTarget].ranged, true);
  });

  test("pre-write injection preserves complete session shape immediately", async () => {
    const root = tmpProject();
    const hooksDir = installHooks(root);
    fs.writeFileSync(path.join(root, ".wolf", "cerebrum.md"), "## Do-Not-Repeat\n- never use eval\n");
    const sessionId = "shape-pre-write";

    await runInstalledHook(hooksDir, "pre-write.js", {
      session_id: sessionId,
      tool_input: { file_path: path.join(root, "unsafe.ts"), content: "eval('x')\n" },
    }, root);
    const session = assertCompleteSession(root, sessionId, "pre-write injection writer");
    assert.ok(session.injected_tokens_estimated > 0, "pre-write must account for injected warning text");
  });

  test("pre-bash filter preserves complete session shape immediately", async () => {
    const root = tmpProject();
    const hooksDir = installHooks(root);
    const sessionId = "shape-pre-bash";

    await runInstalledHook(hooksDir, "pre-bash.js", {
      session_id: sessionId,
      tool_input: { command: "npm test" },
    }, root);
    const session = assertCompleteSession(root, sessionId, "pre-bash filter writer");
    assert.ok(session.bash_filter_suggested?.["npm test"]);
  });

  test("post-batch preserves complete session shape immediately", async () => {
    const root = tmpProject();
    const hooksDir = installHooks(root);
    const sessionId = "shape-post-batch";

    await runInstalledHook(hooksDir, "post-batch.js", { session_id: sessionId }, root);
    const session = assertCompleteSession(root, sessionId, "post-batch writer");
    assert.strictEqual(session.tool_batches, 1);
  });

  test("user-prompt-submit drains reminders while normalizing partial session shape", async () => {
    const root = tmpProject();
    const hooksDir = installHooks(root);
    const sessionId = "shape-user-prompt";
    fs.mkdirSync(path.dirname(sessionPath(root, sessionId)), { recursive: true });
    fs.writeFileSync(sessionPath(root, sessionId), JSON.stringify({ pending_reminders: ["remember this"] }, null, 2));

    await runInstalledHook(hooksDir, "user-prompt-submit.js", { session_id: sessionId }, root);
    const session = assertCompleteSession(root, sessionId, "user-prompt-submit writer");
    assert.deepStrictEqual(session.pending_reminders, []);
    assert.ok(session.injected_tokens_estimated > 0, "reminder delivery must be injection-accounted");
  });

  test("session-start compact continuation preserves complete session shape", async () => {
    const root = tmpProject();
    const hooksDir = installHooks(root);
    const readTarget = path.join(root, "read.ts");
    fs.writeFileSync(readTarget, "export const read = 1;\n");
    fs.writeFileSync(path.join(root, ".wolf", "buglog.json"), JSON.stringify({ version: 1, bugs: [{}] }));
    fs.writeFileSync(path.join(root, ".wolf", "config.json"), JSON.stringify({
      openwolf: { context: { session_digest_budget_tokens: 0 } },
    }));
    const sessionId = "shape-compact";
    fs.mkdirSync(path.dirname(sessionPath(root, sessionId)), { recursive: true });
    fs.writeFileSync(sessionPath(root, sessionId), JSON.stringify({
      session_id: sessionId,
      files_read: {
        [readTarget]: { count: 1, tokens: 0, first_read: new Date().toISOString(), ranged: true },
      },
    }, null, 2));
    await runInstalledHook(hooksDir, "session-start.js", { session_id: sessionId, source: "compact" }, root);
    const session = assertCompleteSession(root, sessionId, "session-start compact writer");
    assert.strictEqual(session.files_read[readTarget].compacted, true);
  });

  test("session-end consumes recovered partial state and writes the ledger", async () => {
    const root = tmpProject();
    const hooksDir = installHooks(root);
    const readTarget = path.join(root, "read.ts");
    fs.writeFileSync(readTarget, "export const read = 1;\n");
    const sessionId = "shape-session-end";
    fs.mkdirSync(path.dirname(sessionPath(root, sessionId)), { recursive: true });
    fs.writeFileSync(sessionPath(root, sessionId), JSON.stringify({
      session_id: sessionId,
      files_read: {
        [readTarget]: { count: 1, tokens: 0, first_read: new Date().toISOString(), ranged: true },
      },
    }, null, 2));
    await runInstalledHook(hooksDir, "session-end.js", { session_id: sessionId }, root);
    assertCompleteSession(root, sessionId, "session-end terminal reader");
    const ledger = JSON.parse(fs.readFileSync(path.join(root, ".wolf", "token-ledger.json"), "utf-8"));
    assert.strictEqual(ledger.lifetime.total_reads, 1);
    assert.strictEqual(ledger.lifetime.total_writes, 0);
  });
});
