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

  const session = JSON.parse(fs.readFileSync(path.join(wolfHooks, "sessions", "omp-test-session.json"), "utf-8"));
  assert.equal(session.agent, "omp");
  assert.equal(JSON.parse(fs.readFileSync(path.join(wolfHooks, "_heartbeat.json"), "utf-8"))["pre-bash"].consecutive_failures, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(wolfHooks, "_heartbeat.json"), "utf-8"))["post-bash"].consecutive_failures, 0);
  assert.ok(messages.length > 0);
});
