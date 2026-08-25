import { execFileSync } from "node:child_process";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { scanProject } from "../dist/src/scanner/anatomy-scanner.js";

interface Fixture {
  root: string;
  wolfDir: string;
  head: string;
}

function createFixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-scan-"));
  const wolfDir = path.join(root, ".wolf");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(wolfDir);
  fs.writeFileSync(path.join(root, "src", "candidate.ts"), "export const candidate = 1;\n", "utf-8");
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  execFileSync("git", ["config", "user.name", "OpenWolf Test"], { cwd: root });
  execFileSync("git", ["config", "user.email", "openwolf-test@example.invalid"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "--quiet", "-m", "fixture"], { cwd: root });
  return {
    root,
    wolfDir,
    head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf-8" }).trim(),
  };
}

function holdLock(wolfDir: string): void {
  fs.writeFileSync(
    path.join(wolfDir, "anatomy-index.lock"),
    JSON.stringify({ pid: process.pid, hostname: os.hostname(), acquiredAt: Date.now() }),
    "utf-8"
  );
}

function statePath(fixture: Fixture): string {
  return path.join(fixture.wolfDir, "_scan-state.json");
}

test("scanProject publishes freshness only with a completed anatomy commit", async (t) => {
  const absent = createFixture();
  t.after(() => fs.rmSync(absent.root, { recursive: true, force: true }));
  holdLock(absent.wolfDir);
  const warn = t.mock.method(console, "warn", () => {});
  const pending = scanProject(absent.wolfDir, absent.root);
  assert.ok(pending instanceof Promise, "public scan remains Promise<number>");
  const absentCount = await pending;
  assert.strictEqual(typeof absentCount, "number");
  assert.strictEqual(warn.mock.calls.length, 1);
  assert.match(String(warn.mock.calls[0].arguments[0]), /anatomy is being updated/);
  assert.ok(!fs.existsSync(path.join(absent.wolfDir, "anatomy.md")));
  assert.ok(!fs.existsSync(path.join(absent.wolfDir, "anatomy-index.json")));
  assert.ok(!fs.existsSync(statePath(absent)), "contention must not publish absent freshness");

  const existing = createFixture();
  t.after(() => fs.rmSync(existing.root, { recursive: true, force: true }));
  const original = "{\"last_scanned\":\"before\"}\n";
  fs.writeFileSync(statePath(existing), original, "utf-8");
  const before = fs.statSync(statePath(existing), { bigint: true }).mtimeNs;
  holdLock(existing.wolfDir);
  await scanProject(existing.wolfDir, existing.root);
  assert.strictEqual(fs.readFileSync(statePath(existing), "utf-8"), original);
  assert.strictEqual(fs.statSync(statePath(existing), { bigint: true }).mtimeNs, before);

  fs.unlinkSync(path.join(existing.wolfDir, "anatomy-index.lock"));
  const count = await scanProject(existing.wolfDir, existing.root);
  const store = JSON.parse(fs.readFileSync(path.join(existing.wolfDir, "anatomy-index.json"), "utf-8"));
  const freshness = JSON.parse(fs.readFileSync(statePath(existing), "utf-8"));
  assert.ok(fs.existsSync(path.join(existing.wolfDir, "anatomy.md")));
  assert.strictEqual(freshness.last_scanned, store.meta.lastScanned);
  assert.strictEqual(freshness.git_head, existing.head);
  assert.strictEqual(freshness.file_count, count);
  assert.strictEqual(store.meta.fileCount, count);
});

test("scanProject does not advance freshness when render fallback fails", async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const original = "{\"last_scanned\":\"before\"}\n";
  fs.writeFileSync(statePath(fixture), original, "utf-8");
  const before = fs.statSync(statePath(fixture), { bigint: true }).mtimeNs;
  fs.mkdirSync(path.join(fixture.wolfDir, "anatomy.md"));

  await assert.rejects(scanProject(fixture.wolfDir, fixture.root));
  assert.strictEqual(fs.readFileSync(statePath(fixture), "utf-8"), original);
  assert.strictEqual(fs.statSync(statePath(fixture), { bigint: true }).mtimeNs, before);
});

test("scanProject does not advance freshness when store fallback fails", async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const original = "{\"last_scanned\":\"before\"}\n";
  fs.writeFileSync(statePath(fixture), original, "utf-8");
  const before = fs.statSync(statePath(fixture), { bigint: true }).mtimeNs;
  fs.mkdirSync(path.join(fixture.wolfDir, "anatomy-index.json"));

  await assert.rejects(scanProject(fixture.wolfDir, fixture.root));
  assert.strictEqual(fs.readFileSync(statePath(fixture), "utf-8"), original);
  assert.strictEqual(fs.statSync(statePath(fixture), { bigint: true }).mtimeNs, before);
});

test("scanProject rejects when freshness fallback fails", async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  fs.mkdirSync(statePath(fixture));

  await assert.rejects(scanProject(fixture.wolfDir, fixture.root));
});
