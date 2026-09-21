import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname ?? ".", "..");
const TEMPLATE = path.join(ROOT, "src", "templates", "omp-hooks", "openwolf.ts");
const DIST_HOOKS = path.join(ROOT, "dist", "src", "hooks");

test("OMP bridge registers native lifecycle and tool handlers", async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ow-omp-hooks-"));
  const wolfHooks = path.join(projectRoot, ".wolf", "hooks");
  fs.mkdirSync(wolfHooks, { recursive: true });
  fs.cpSync(DIST_HOOKS, wolfHooks, { recursive: true });
  // The bridge launches the copied hooks as standalone ESM files. Real
  // `openwolf init` writes this file; keep the direct bridge fixture faithful
  // to that install contract as well.
  fs.writeFileSync(path.join(wolfHooks, "package.json"), JSON.stringify({ type: "module" }));

  const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<unknown>>();
  const messages: unknown[] = [];
  const module = await import(`${pathToFileURL(TEMPLATE).href}?test=${Date.now()}`);
  module.default({
    on(event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) {
      handlers.set(event, handler);
    },
    async sendMessage(message: unknown, options: unknown) {
      messages.push({ message, options });
    },
  });

  const ctx = {
    cwd: projectRoot,
    sessionManager: { getSessionId: () => "omp-test-session" },
  };
  assert.ok(handlers.has("session_start"));
  assert.ok(handlers.has("before_agent_start"));
  assert.ok(handlers.has("tool_call"));
  assert.ok(handlers.has("tool_result"));
  assert.ok(handlers.has("session_before_compact"));
  assert.ok(handlers.has("session_stop"));
  assert.ok(handlers.has("session_shutdown"));

  await handlers.get("session_start")!({ source: "startup" }, ctx);
  assert.equal((messages[0] as { options: { deliverAs: string } }).options.deliverAs, "nextTurn");
  await handlers.get("before_agent_start")!({ prompt: "continue the task" }, ctx);
  await handlers.get("tool_call")!({
    toolName: "bash",
    toolCallId: "bash-1",
    input: { command: "pnpm test" },
  }, ctx);
  await handlers.get("tool_result")!({
    toolName: "bash",
    toolCallId: "bash-1",
    input: { command: "printf ok" },
    content: [{ type: "text", text: "ok" }],
    isError: false,
  }, ctx);
  await handlers.get("session_before_compact")!({ trigger: "manual" }, ctx);
  await handlers.get("session_stop")!({ transcript_path: "transcript.jsonl" }, ctx);
  await handlers.get("session_shutdown")!({ reason: "test" }, ctx);

  const session = JSON.parse(fs.readFileSync(path.join(wolfHooks, "sessions", "omp-test-session.json"), "utf-8"));
  assert.equal(session.agent, "omp");
  const heartbeat = JSON.parse(fs.readFileSync(path.join(wolfHooks, "_heartbeat.json"), "utf-8"));
  for (const hook of ["pre-bash", "post-bash", "user-prompt-submit", "precompact", "stop", "session-end"]) {
    assert.equal(heartbeat[hook].consecutive_failures, 0, `${hook} should complete successfully`);
  }
  assert.ok(messages.length > 0);
});

test("OMP bridge normalizes Pi inputs and blocks duplicate full reads", async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ow-omp-inputs-"));
  const wolfHooks = path.join(projectRoot, ".wolf", "hooks");
  fs.mkdirSync(wolfHooks, { recursive: true });
  fs.cpSync(DIST_HOOKS, wolfHooks, { recursive: true });
  fs.writeFileSync(path.join(wolfHooks, "package.json"), JSON.stringify({ type: "module" }));
  fs.writeFileSync(path.join(projectRoot, ".wolf", "config.json"), JSON.stringify({
    openwolf: { reads: { duplicate_mode: "deny" } },
  }));
  fs.writeFileSync(path.join(projectRoot, "notes.md"), "one\ntwo\nthree\n");

  const handlers = new Map<string, (event: any, ctx: any) => Promise<any>>();
  const module = await import(`${pathToFileURL(TEMPLATE).href}?inputs=${Date.now()}`);
  module.default({ on(event: string, handler: (event: any, ctx: any) => Promise<any>) { handlers.set(event, handler); } });
  const ctx = { cwd: projectRoot, sessionManager: { getSessionId: () => "omp-input-session" } };
  const read = { toolName: "read", toolCallId: "read-1", input: { path: "notes.md", startLine: 1, endLine: 2 } };

  await handlers.get("tool_call")!(read, ctx);
  const sessionAfterRangedPreflight = JSON.parse(fs.readFileSync(path.join(wolfHooks, "sessions", "omp-input-session.json"), "utf-8"));
  assert.equal(sessionAfterRangedPreflight.files_read[path.resolve(projectRoot, "notes.md")].ranged, true);
  await handlers.get("tool_result")!({ ...read, content: [{ type: "text", text: "one\ntwo\n" }] }, ctx);
  const fullRead = { toolName: "read", toolCallId: "read-2", input: { path: "notes.md" } };
  await handlers.get("tool_call")!(fullRead, ctx);
  await handlers.get("tool_result")!({ ...fullRead, content: [{ type: "text", text: "one\ntwo\nthree\n" }] }, ctx);
  const denied = await handlers.get("tool_call")!({ ...fullRead, toolCallId: "read-3" }, ctx);
  assert.equal(denied.block, true);
  assert.match(denied.reason, /already read this session/);

  const capturedHook = `
    import fs from "node:fs";
    import path from "node:path";
    let raw = "";
    process.stdin.on("data", chunk => raw += String(chunk));
    process.stdin.on("end", () => fs.writeFileSync(path.join(process.env.OPENWOLF_PROJECT_ROOT, "captured-input.json"), raw));
  `;
  fs.writeFileSync(path.join(wolfHooks, "pre-write.js"), capturedHook);
  await handlers.get("tool_call")!({
    toolName: "edit",
    toolCallId: "edit-1",
    input: { path: "notes.md", oldText: "one", newText: "ONE" },
  }, ctx);
  const captured = JSON.parse(fs.readFileSync(path.join(projectRoot, "captured-input.json"), "utf-8"));
  assert.equal(captured.tool_input.old_string, "one");
  assert.equal(captured.tool_input.new_string, "ONE");
  assert.equal(captured.tool_input.file_path, "notes.md");
});

test("OMP bridge preserves result details and only replaces the first text block", async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ow-omp-output-"));
  const wolfHooks = path.join(projectRoot, ".wolf", "hooks");
  fs.mkdirSync(wolfHooks, { recursive: true });
  fs.cpSync(DIST_HOOKS, wolfHooks, { recursive: true });
  fs.writeFileSync(path.join(wolfHooks, "package.json"), JSON.stringify({ type: "module" }));
  fs.writeFileSync(path.join(wolfHooks, "post-bash.js"), `
    import fs from "node:fs";
    let raw = "";
    process.stdin.on("data", chunk => raw += String(chunk));
    process.stdin.on("end", () => {
      const input = JSON.parse(raw);
      fs.writeFileSync(${JSON.stringify(path.join(projectRoot, "captured-result.json"))}, raw);
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { updatedToolOutput: { stdout: "condensed output" } } }));
    });
  `);

  const handlers = new Map<string, (event: any, ctx: any) => Promise<any>>();
  const module = await import(`${pathToFileURL(TEMPLATE).href}?output=${Date.now()}`);
  module.default({ on(event: string, handler: (event: any, ctx: any) => Promise<any>) { handlers.set(event, handler); } });
  const ctx = { cwd: projectRoot, sessionManager: { getSessionId: () => "omp-output-session" } };
  const result = await handlers.get("tool_result")!({
    toolName: "bash",
    toolCallId: "bash-output",
    input: { command: "pnpm test" },
    content: [{ type: "text", text: "original output" }, { type: "text", text: "separate block" }],
    details: { exitCode: 0, durationMs: 12 },
    isError: false,
  }, ctx);

  const captured = JSON.parse(fs.readFileSync(path.join(projectRoot, "captured-result.json"), "utf-8"));
  assert.equal(captured.tool_response.exitCode, 0);
  assert.equal(captured.tool_response.durationMs, 12);
  assert.equal(result.content[0].text, "condensed output");
  assert.equal(result.content[1].text, "separate block");
});
