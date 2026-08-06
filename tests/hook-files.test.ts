import { test, describe } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { HOOK_FILES, shippedHookFiles, verifyHookImports } from "../src/cli/hook-files.ts";

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "wolf-hookfiles-"));

describe("the install list is derived from what ships", () => {
  test("every hook in dist/hooks is in the fallback list", () => {
    // The regression that started this: dist shipped 11 hooks, the copy lists named 10, and
    // the omitted one was a dependency of post-write.js. Pin the literal to the build.
    const shipped = path.resolve(import.meta.dirname, "../dist/hooks");
    if (!fs.existsSync(shipped)) return; // not built in this checkout; the next test covers the logic
    const onDisk = fs.readdirSync(shipped).filter((f) => f.endsWith(".js") && !f.endsWith(".map")).sort();
    const missing = onDisk.filter((f) => !(HOOK_FILES as readonly string[]).includes(f));
    assert.deepEqual(missing, [], `shipped but not in HOOK_FILES: ${missing.join(", ")}`);
  });

  test("shippedHookFiles reads the directory rather than a hardcoded list", () => {
    const dir = tmpDir();
    for (const f of ["a.js", "b.js", "brand-new-dependency.js", "notes.md", "x.js.map"])
      fs.writeFileSync(path.join(dir, f), "", "utf-8");
    const found = shippedHookFiles(dir);
    assert.deepEqual(found, ["a.js", "b.js", "brand-new-dependency.js"].sort());
    assert.ok(found.includes("brand-new-dependency.js"), "a newly added hook must be picked up");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("falls back to the literal when the directory is unreadable or empty", () => {
    assert.deepEqual(shippedHookFiles(path.join(os.tmpdir(), "does-not-exist-xyz")), [...HOOK_FILES]);
    assert.deepEqual(shippedHookFiles(undefined), [...HOOK_FILES]);
    const empty = tmpDir();
    assert.deepEqual(shippedHookFiles(empty), [...HOOK_FILES]);
    fs.rmSync(empty, { recursive: true, force: true });
  });

  test("symbol-extractor.js is in the list", () => {
    // The specific omission. Named explicitly so a future edit cannot quietly drop it again.
    assert.ok((HOOK_FILES as readonly string[]).includes("symbol-extractor.js"));
  });
});

describe("an uninstalled dependency is detected instead of failing silently", () => {
  test("reports a hook whose import is not installed", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "post-write.js"),
      'import { extractSymbols } from "./symbol-extractor.js";\nmain();\n', "utf-8");
    const problems = verifyHookImports(dir);
    assert.equal(problems.length, 1, JSON.stringify(problems));
    assert.match(problems[0], /post-write\.js imports \.\/symbol-extractor\.js/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("silent once the dependency is installed", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "post-write.js"),
      'import { extractSymbols } from "./symbol-extractor.js";\n', "utf-8");
    fs.writeFileSync(path.join(dir, "symbol-extractor.js"), "export function extractSymbols() {}\n", "utf-8");
    assert.deepEqual(verifyHookImports(dir), []);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("bare specifiers are left alone — only relative imports are ours to install", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "h.js"),
      'import * as fs from "node:fs";\nimport cron from "node-cron";\n', "utf-8");
    assert.deepEqual(verifyHookImports(dir), []);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("catches re-exports too, and both quote styles", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "h.js"), "export { x } from './gone.js';\n", "utf-8");
    const problems = verifyHookImports(dir);
    assert.equal(problems.length, 1, JSON.stringify(problems));
    assert.match(problems[0], /gone\.js/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("does not execute the hooks it checks", () => {
    // Importing each hook would be the obvious way to prove it loads — but every hook calls
    // main() at module scope, so an import would run it. This must stay a static check.
    const dir = tmpDir();
    const sentinel = path.join(dir, "SIDE_EFFECT");
    fs.writeFileSync(path.join(dir, "h.js"),
      `import * as fs from "node:fs";\nfs.writeFileSync(${JSON.stringify(sentinel)}, "ran");\n`, "utf-8");
    verifyHookImports(dir);
    assert.ok(!fs.existsSync(sentinel), "verifyHookImports executed a hook");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
