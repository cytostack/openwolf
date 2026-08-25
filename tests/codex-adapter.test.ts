import assert from "node:assert/strict";
import * as fs from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";

const templatesDir = path.resolve(import.meta.dirname, "../src/templates");

async function adapter() {
  const { resolveAgents } = await import("../dist/src/agents/index.js");
  return resolveAgents(["codex"])[0];
}

function context(root: string) {
  return { projectRoot: root, wolfDir: path.join(root, ".wolf"), templatesDir };
}

function withProject(run: (root: string) => Promise<void> | void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-codex-"));
  return Promise.resolve(run(root)).finally(() => fs.rmSync(root, { recursive: true, force: true }));
}

function warningHasRequiredMeaning(warning: string) {
  assert.match(warning, /\.codex\/hooks\.json/i);
  assert.match(warning, /invalid|unreadable/i);
  assert.match(warning, /prevented|skipped/i);
  assert.match(warning, /unchanged|not modified/i);
  assert.match(warning, /repair|fix/i);
  assert.match(warning, /rerun|retry/i);
}

test("issue #5: malformed Codex hooks remain byte-identical", async () => withProject(async (root) => {
  const hooksPath = path.join(root, ".codex", "hooks.json");
  const malformed = '{\n  "hooks": [\n';
  fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
  fs.writeFileSync(hooksPath, malformed, "utf-8");
  fs.utimesSync(hooksPath, new Date("2000-01-01T00:00:00.000Z"), new Date("2000-01-01T00:00:00.000Z"));
  const beforeBytes = fs.readFileSync(hooksPath);
  const beforeMtime = fs.statSync(hooksPath, { bigint: true }).mtimeNs;

  (await adapter()).install(context(root));

  assert.deepEqual(fs.readFileSync(hooksPath), beforeBytes, "issue #5: malformed hooks bytes changed");
  assert.equal(fs.statSync(hooksPath, { bigint: true }).mtimeNs, beforeMtime, "issue #5: malformed hooks mtime changed");
}));

test("issue #5: malformed hooks skip only registration and warn", async () => withProject(async (root) => {
  const hooksPath = path.join(root, ".codex", "hooks.json");
  fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
  fs.writeFileSync(hooksPath, '{\n  "hooks": [\n', "utf-8");
  fs.utimesSync(hooksPath, new Date("2000-01-01T00:00:00.000Z"), new Date("2000-01-01T00:00:00.000Z"));
  const beforeBytes = fs.readFileSync(hooksPath);
  const beforeMtime = fs.statSync(hooksPath, { bigint: true }).mtimeNs;
  const commonFs = createRequire(import.meta.url)("node:fs") as typeof fs;
  const originalWrite = commonFs.writeFileSync;
  const writes: string[] = [];
  commonFs.writeFileSync = function (...args: Parameters<typeof fs.writeFileSync>) {
    writes.push(path.resolve(String(args[0])));
    return originalWrite.apply(this, args);
  } as typeof fs.writeFileSync;
  syncBuiltinESMExports();
  try {
    const result = (await adapter()).install(context(root));
    assert.equal(result.warnings.length, 1);
    warningHasRequiredMeaning(result.warnings[0]);
    assert.ok(!result.actions.includes("Codex hooks registered (.codex/hooks.json)"));
    assert.ok(result.actions.includes("Codex hooks feature enabled (.codex/config.toml)"));
    assert.ok(result.actions.includes("AGENTS.md updated (OpenWolf block)"));
    assert.ok(!writes.includes(path.resolve(hooksPath)));
  } finally {
    commonFs.writeFileSync = originalWrite;
    syncBuiltinESMExports();
  }
  assert.deepEqual(fs.readFileSync(hooksPath), beforeBytes);
  assert.equal(fs.statSync(hooksPath, { bigint: true }).mtimeNs, beforeMtime);
  assert.deepEqual(fs.readdirSync(path.dirname(hooksPath)).sort(), ["config.toml", "hooks.json"]);
  assert.match(fs.readFileSync(path.join(root, ".codex", "config.toml"), "utf-8"), /^hooks\s*=\s*true$/m);
  assert.match(fs.readFileSync(path.join(root, "AGENTS.md"), "utf-8"), /<!-- openwolf:begin -->/);
}));

test("issue #5: unreadable hooks path skips registration and continues setup", async () => withProject(async (root) => {
  const hooksPath = path.join(root, ".codex", "hooks.json");
  fs.mkdirSync(hooksPath, { recursive: true });
  const result = (await adapter()).install(context(root));
  assert.equal(result.warnings.length, 1);
  warningHasRequiredMeaning(result.warnings[0]);
  assert.ok(!result.actions.includes("Codex hooks registered (.codex/hooks.json)"));
  assert.ok(result.actions.includes("Codex hooks feature enabled (.codex/config.toml)"));
  assert.ok(result.actions.includes("AGENTS.md updated (OpenWolf block)"));
  assert.ok(fs.statSync(hooksPath).isDirectory());
}));

test("issue #5: missing and valid user hooks register without loss", async () => withProject(async (root) => {
  const missing = (await adapter()).install(context(root));
  assert.ok(missing.actions.includes("Codex hooks registered (.codex/hooks.json)"));
  const hooksPath = path.join(root, ".codex", "hooks.json");
  const userHooks = { hooks: { UserEvent: [{ matcher: "user", hooks: [{ type: "command", command: "user-hook" }] }] } };
  fs.writeFileSync(hooksPath, JSON.stringify(userHooks), "utf-8");
  const valid = (await adapter()).install(context(root));
  assert.ok(valid.actions.includes("Codex hooks registered (.codex/hooks.json)"));
  const merged = JSON.parse(fs.readFileSync(hooksPath, "utf-8"));
  assert.deepEqual(merged.hooks.UserEvent, userHooks.hooks.UserEvent);
}));

test("issue #5: successful installs are idempotent and a repaired file registers", async () => withProject(async (root) => {
  const hooksPath = path.join(root, ".codex", "hooks.json");
  const first = (await adapter()).install(context(root));
  const second = (await adapter()).install(context(root));
  assert.equal(first.warnings.length, 0);
  assert.equal(second.warnings.length, 0);
  const once = JSON.stringify(JSON.parse(fs.readFileSync(hooksPath, "utf-8")));
  assert.equal((once.match(/session-start\.js/g) ?? []).length, 1);
  fs.writeFileSync(hooksPath, '{\n  "hooks": [\n', "utf-8");
  const malformed = (await adapter()).install(context(root));
  assert.equal(malformed.warnings.length, 1);
  fs.writeFileSync(hooksPath, JSON.stringify({ hooks: { UserEvent: [] } }), "utf-8");
  const repaired = (await adapter()).install(context(root));
  assert.equal(repaired.warnings.length, 0);
  assert.ok(repaired.actions.includes("Codex hooks registered (.codex/hooks.json)"));
  assert.deepEqual(JSON.parse(fs.readFileSync(hooksPath, "utf-8")).hooks.UserEvent, []);
}));
