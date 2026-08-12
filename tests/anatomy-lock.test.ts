import { test, describe } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

import { withAnatomyLock } from "../src/hooks/anatomy-lock.ts";
import { loadStore } from "../src/hooks/anatomy-store.ts";

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "wolf-lock-"));
const storeUrl = pathToFileURL(path.resolve(import.meta.dirname, "../src/hooks/anatomy-store.ts")).href;
const lockUrl = pathToFileURL(path.resolve(import.meta.dirname, "../src/hooks/anatomy-lock.ts")).href;

/** One competing writer process: locked read-modify-write of a distinct key. */
function writerScript(wolfDir: string, key: string): string {
  return `
    const { withAnatomyLock } = await import(${JSON.stringify(lockUrl)});
    const { loadStore, saveStore, newStore } = await import(${JSON.stringify(storeUrl)});
    const wolfDir = ${JSON.stringify(wolfDir)};
    const ok = withAnatomyLock(wolfDir, 5000, () => {
      const store = loadStore(wolfDir) ?? newStore();
      store.files[${JSON.stringify(key)}] = { description: "w", tokens: 1, updatedAt: "x", source: "hook" };
      saveStore(wolfDir, store);
      return true;
    });
    if (ok !== true) process.exit(3);
  `;
}

function runChild(script: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: "ignore" });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

describe("anatomy lock", () => {
  test("no lost updates: 8 concurrent writer processes, 8 surviving keys", async () => {
    const dir = tmpDir();
    const codes = await Promise.all(
      Array.from({ length: 8 }, (_, i) => runChild(writerScript(dir, `src/file-${i}.ts`)))
    );
    assert.deepStrictEqual(codes, [0, 0, 0, 0, 0, 0, 0, 0]);
    const store = loadStore(dir);
    assert.ok(store);
    assert.strictEqual(Object.keys(store!.files).length, 8, "every concurrent upsert must survive");
  });

  test("stale lock (dead pid, old timestamp) is stolen and work proceeds", () => {
    const dir = tmpDir();
    fs.writeFileSync(
      path.join(dir, "anatomy-index.lock"),
      JSON.stringify({ pid: 999999, hostname: os.hostname(), acquiredAt: Date.now() - 60_000 }),
      "utf-8"
    );
    const result = withAnatomyLock(dir, 3000, () => "ran");
    assert.strictEqual(result, "ran");
    assert.ok(!fs.existsSync(path.join(dir, "anatomy-index.lock")), "lock released after work");
  });

  test("held lock (live pid, fresh) times out to null within budget", () => {
    const dir = tmpDir();
    fs.writeFileSync(
      path.join(dir, "anatomy-index.lock"),
      JSON.stringify({ pid: process.pid, hostname: os.hostname(), acquiredAt: Date.now() }),
      "utf-8"
    );
    const started = Date.now();
    const result = withAnatomyLock(dir, 300, () => "ran");
    assert.strictEqual(result, null, "must degrade, never run");
    assert.ok(Date.now() - started < 2000, "returns promptly after budget");
    fs.unlinkSync(path.join(dir, "anatomy-index.lock"));
  });
});
