import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";

const DIST_HOOKS = path.resolve("dist/hooks");

interface HookResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  error: Error | null;
}

interface PreparedInvocation {
  payloadPath: string;
  payload: { source: string; session_id: string };
}

function projectRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "issue9-session-start-"));
  const hooksDir = path.join(root, ".wolf", "hooks");
  fs.mkdirSync(hooksDir, { recursive: true });
  for (const file of fs.readdirSync(DIST_HOOKS)) {
    if (file.endsWith(".js")) fs.copyFileSync(path.join(DIST_HOOKS, file), path.join(hooksDir, file));
  }
  fs.writeFileSync(path.join(hooksDir, "package.json"), JSON.stringify({ type: "module" }));
  return root;
}

function sessionPath(root: string, sessionId: string): string {
  return path.join(root, ".wolf", "hooks", "sessions", `${sessionId}.json`);
}

function ledgerPath(root: string): string {
  return path.join(root, ".wolf", "token-ledger.json");
}

function prepareInvocation(payload: { source: string; session_id: string }): PreparedInvocation {
  const bytes = Buffer.from(JSON.stringify(payload), "utf8");
  const payloadPath = path.join(os.tmpdir(), `issue9-payload-${randomUUID()}.json`);
  fs.writeFileSync(payloadPath, bytes, { flag: "wx" });
  assert.deepEqual(fs.readFileSync(payloadPath), bytes, "fixture payload bytes must be exact");
  return { payloadPath, payload };
}

async function invoke(root: string, prepared: PreparedInvocation): Promise<HookResult> {
  let payloadFd: number | undefined;
  try {
    payloadFd = fs.openSync(prepared.payloadPath, "r");
    const child = spawn(process.execPath, [path.join(root, ".wolf", "hooks", "session-start.js")], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: root, HOME: path.join(root, "fakehome") },
      stdio: [payloadFd, "pipe", "pipe"],
    });
    fs.closeSync(payloadFd);
    payloadFd = undefined;

    return await new Promise<HookResult>((resolve) => {
      let stdout = "";
      let stderr = "";
      let error: Error | null = null;
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => { stdout += chunk; });
      child.stderr.on("data", (chunk: string) => { stderr += chunk; });
      child.on("error", (err) => { error = err; });
      child.on("close", (code, signal) => {
        fs.unlinkSync(prepared.payloadPath);
        resolve({ code, signal, stdout, stderr, error });
      });
    });
  } catch (error) {
    if (payloadFd !== undefined) fs.closeSync(payloadFd);
    fs.unlinkSync(prepared.payloadPath);
    throw error;
  }
}

function assertSuccessfulStart(root: string, sessionId: string, result: HookResult): void {
  assert.equal(result.error, null, `hook spawn failed: ${result.error?.message ?? "unknown error"}`);
  assert.equal(result.code, 0, `hook exited nonzero: ${result.stderr}`);
  assert.equal(result.signal, null, "hook must not terminate by signal");
  assert.ok(fs.existsSync(sessionPath(root, sessionId)), `expected keyed session ${sessionId}`);
  assert.ok(!fs.existsSync(path.join(root, ".wolf", "hooks", "_session.json")), "fallback session file must not exist");
}

test("missing and malformed ledgers use the existing default", async (t) => {
  const missingRoot = projectRoot();
  const malformedRoot = projectRoot();
  t.after(() => {
    fs.rmSync(missingRoot, { recursive: true, force: true });
    fs.rmSync(malformedRoot, { recursive: true, force: true });
  });

  const missing = await invoke(missingRoot, prepareInvocation({ source: "startup", session_id: "issue9-default-missing" }));
  assertSuccessfulStart(missingRoot, "issue9-default-missing", missing);
  assert.equal(JSON.parse(fs.readFileSync(ledgerPath(missingRoot), "utf8")).lifetime.total_sessions, 1);

  fs.writeFileSync(ledgerPath(malformedRoot), "{ malformed");
  const malformed = await invoke(malformedRoot, prepareInvocation({ source: "startup", session_id: "issue9-default-malformed" }));
  assertSuccessfulStart(malformedRoot, "issue9-default-malformed", malformed);
  assert.equal(JSON.parse(fs.readFileSync(ledgerPath(malformedRoot), "utf8")).lifetime.total_sessions, 1);
});

test("resume and compact do not count an existing session", async (t) => {
  const root = projectRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sessionId = "issue9-continuing";

  const startup = await invoke(root, prepareInvocation({ source: "startup", session_id: sessionId }));
  assertSuccessfulStart(root, sessionId, startup);
  assert.equal(JSON.parse(fs.readFileSync(ledgerPath(root), "utf8")).lifetime.total_sessions, 1);

  const resumed = await invoke(root, prepareInvocation({ source: "resume", session_id: sessionId }));
  assertSuccessfulStart(root, sessionId, resumed);
  const compacted = await invoke(root, prepareInvocation({ source: "compact", session_id: sessionId }));
  assertSuccessfulStart(root, sessionId, compacted);
  assert.equal(JSON.parse(fs.readFileSync(ledgerPath(root), "utf8")).lifetime.total_sessions, 1);
});

test("60 concurrent startup processes preserve all ledger increments", async (t) => {
  const root = projectRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ids = Array.from({ length: 60 }, (_, index) => `issue9-concurrent-${String(index).padStart(2, "0")}`);
  const invocations = ids.map((sessionId) => prepareInvocation({ source: "startup", session_id: sessionId }));
  const results = await Promise.all(invocations.map((prepared) => invoke(root, prepared)));

  results.forEach((result, index) => assertSuccessfulStart(root, ids[index], result));
  assert.equal(fs.existsSync(path.join(root, ".wolf", "hooks", "_session.json")), false);
  assert.equal(
    JSON.parse(fs.readFileSync(ledgerPath(root), "utf8")).lifetime.total_sessions,
    60,
    "issue #9 RED concurrency: all 60 session files exist but token-ledger total_sessions is not 60",
  );
});

test("held ledger lock fails closed and records session-start heartbeat failure", async (t) => {
  const root = projectRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ledger = ledgerPath(root);
  const original = JSON.stringify({ version: 1, lifetime: { total_sessions: 41 } });
  fs.writeFileSync(ledger, original);
  const lock = `${ledger}.lock`;
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, hostname: os.hostname(), acquiredAt: Date.now() }), { flag: "wx" });
  assert.deepEqual(JSON.parse(fs.readFileSync(lock, "utf8")), { pid: process.pid, hostname: os.hostname(), acquiredAt: JSON.parse(fs.readFileSync(lock, "utf8")).acquiredAt });

  const result = await invoke(root, prepareInvocation({ source: "startup", session_id: "issue9-lock-held" }));
  assertSuccessfulStart(root, "issue9-lock-held", result);
  assert.equal(fs.readFileSync(ledger, "utf8"), original, "issue #9 RED contention: live lock held but token-ledger bytes changed");
  const heartbeat = JSON.parse(fs.readFileSync(path.join(root, ".wolf", "hooks", "_heartbeat.json"), "utf8"));
  assert.match(heartbeat["session-start"].last_error_message, /SessionStart token-ledger lock acquisition timed out/);
});
