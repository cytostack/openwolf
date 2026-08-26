import { test, describe } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// anatomy-scanner.ts imports with .js specifiers, and node's type stripping
// does not map those onto .ts sources, so this exercises the build output the
// way buglog-shape.test.ts does.
const DIST = path.resolve(import.meta.dirname ?? ".", "..", "dist", "src", "scanner", "anatomy-scanner.js");
const scanner: {
  buildAnatomy: (wolfDir: string, projectRoot: string) => Promise<{ fileCount: number; store: { files: Record<string, unknown> } }>;
} | null = fs.existsSync(DIST) ? await import(DIST) : null;

function setup(extraRoots: string[] | undefined): { wolfDir: string; projectRoot: string } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-xr-"));
  const projectRoot = path.join(base, "project");
  const wolfDir = path.join(projectRoot, ".wolf");
  fs.mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  fs.mkdirSync(wolfDir, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "src", "own.ts"), "export const own = 1;\n");

  const sibling = path.join(base, "sibling");
  fs.mkdirSync(path.join(sibling, "ui"), { recursive: true });
  fs.mkdirSync(path.join(sibling, ".venv", "lib"), { recursive: true });
  fs.writeFileSync(path.join(sibling, "ui", "View.swift"), "struct View {}\n");
  fs.writeFileSync(path.join(sibling, ".venv", "lib", "pkg.py"), "x = 1\n");

  if (extraRoots !== undefined) {
    fs.writeFileSync(
      path.join(wolfDir, "config.json"),
      JSON.stringify({ version: 1, openwolf: { anatomy: { max_description_length: 100, max_files: 500, exclude_patterns: ["node_modules", ".git", ".wolf"], extra_roots: extraRoots }, token_audit: { chars_per_token_code: 3.5, chars_per_token_prose: 4.0 } } }),
      "utf-8"
    );
  }
  return { wolfDir, projectRoot };
}

describe("extra_roots", { skip: scanner === null && "dist build missing" }, () => {
  test("out-of-root paths stay excluded by default", async () => {
    const { wolfDir, projectRoot } = setup(undefined);
    const { store } = await scanner!.buildAnatomy(wolfDir, projectRoot);
    const keys = Object.keys(store.files);
    assert.ok(keys.includes("src/own.ts"));
    assert.ok(!keys.some((k) => k.startsWith("..")), `unexpected out-of-root keys: ${keys}`);
  });

  test("a configured sibling root is indexed under ../ keys", async () => {
    const { wolfDir, projectRoot } = setup(["../sibling"]);
    const { store } = await scanner!.buildAnatomy(wolfDir, projectRoot);
    const keys = Object.keys(store.files);
    assert.ok(keys.includes("src/own.ts"));
    assert.ok(keys.includes("../sibling/ui/View.swift"), `missing sibling file, got: ${keys}`);
  });

  test("noise dirs are still hard-excluded inside an extra root", async () => {
    const { wolfDir, projectRoot } = setup(["../sibling"]);
    const { store } = await scanner!.buildAnatomy(wolfDir, projectRoot);
    assert.ok(!Object.keys(store.files).some((k) => k.includes(".venv")));
  });

  test("an extra root inside the project, a missing dir, and junk entries are ignored", async () => {
    const { wolfDir, projectRoot } = setup(["src", "../does-not-exist", "", 42 as unknown as string]);
    const { store } = await scanner!.buildAnatomy(wolfDir, projectRoot);
    const keys = Object.keys(store.files);
    assert.deepEqual(keys, ["src/own.ts"]);
  });
});
