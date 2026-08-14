import { test, describe } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

import { withAnatomyLock } from "../src/hooks/anatomy-lock.ts";
import { loadStore, newStore, renderToFile, saveStore } from "../src/hooks/anatomy-store.ts";

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

  test("abandoned lock directory times out safely", () => {
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, "anatomy-index.lock"));
    fs.writeFileSync(
      path.join(dir, "anatomy-index.lock", "owner.json"),
      JSON.stringify({ pid: 999999, acquiredAt: Date.now() - 60_000 }),
      "utf-8"
    );
    const result = withAnatomyLock(dir, 3000, () => "ran");
    assert.strictEqual(
      result,
      null,
      "abandoned locks require explicit cleanup"
    );
    fs.rmSync(path.join(dir, "anatomy-index.lock"), { recursive: true });
  });

  test("store and rendered anatomy use atomic sibling replacement", () => {
    const dir = tmpDir();
    const store = newStore();
    store.files["src/atomic.ts"] = {
      description: "atomic",
      tokens: 1,
      updatedAt: new Date().toISOString(),
      source: "hook",
    };

    saveStore(dir, store);
    renderToFile(dir, store);

    assert.ok(loadStore(dir)?.files["src/atomic.ts"]);
    assert.match(fs.readFileSync(path.join(dir, "anatomy.md"), "utf-8"), /atomic\.ts/);
    assert.deepStrictEqual(
      fs.readdirSync(dir).filter((file) => file.endsWith(".tmp")),
      []
    );
  });

  test("OpenCode anatomy template uses the directory lock protocol", () => {
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/templates/opencode-plugin/anatomy.ts"),
      "utf-8"
    );

    assert.match(source, /fs\.mkdirSync\(lockPath\)/);
    assert.match(source, /path\.join\(lockPath, OWNER_FILE\)/);
    assert.match(source, /fs\.rmdirSync\(lockPath\)/);
    assert.doesNotMatch(source, /LOCK_STALE_MS|\.stale|process\.kill/);
    assert.doesNotMatch(source, /writeFileSync\(filePath, body/);
  });
});
