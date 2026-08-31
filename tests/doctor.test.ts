import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const cliPath = path.resolve(import.meta.dirname, "../dist/bin/openwolf.js");

test("doctor reports missing hook scripts and exits 1", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-doctor-"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "t" }));
  fs.mkdirSync(path.join(root, ".wolf", "hooks"), { recursive: true });
  fs.writeFileSync(path.join(root, ".wolf", "hooks", "shared.js"), "// x"); // only one hook

  const r = spawnSync(process.execPath, [cliPath, "doctor"], { cwd: root, encoding: "utf-8" });
  assert.strictEqual(r.status, 1);
  assert.ok(r.stdout.includes("missing hook scripts"), r.stdout);
});

test("doctor is clean on an initialized empty project", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-doctor-"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "t" }));
  const init = spawnSync(process.execPath, [cliPath, "init", "--agent", "claude"], {
    cwd: root,
    encoding: "utf-8",
  });
  assert.strictEqual(init.status, 0, init.stderr || init.stdout);

  const r = spawnSync(process.execPath, [cliPath, "doctor"], { cwd: root, encoding: "utf-8" });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});
