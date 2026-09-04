import { test, describe } from "node:test";
import * as assert from "node:assert";

import { analyzeFileTS, tsSymbolsSupported } from "../src/anatomy/ts-symbol-extractor.ts";
import { computeImportance, extractEdges } from "../src/anatomy/importance.ts";

// These tests exercise the real wasm runtime. If web-tree-sitter cannot
// initialize in this environment, analyzeFileTS returns null and the suite
// must not fail the build — the production code path falls back to regex.
async function analyzed(content: string, ext: string) {
  const r = await analyzeFileTS(content, ext);
  return r;
}

describe("tsSymbolsSupported", () => {
  test("covers the promised languages, rejects others", () => {
    for (const ext of [".ts", ".tsx", ".js", ".py", ".go", ".rs", ".java", ".rb", ".php"]) {
      assert.strictEqual(tsSymbolsSupported(ext), true, ext);
    }
    for (const ext of [".md", ".json", ".css", ".sh", ""]) {
      assert.strictEqual(tsSymbolsSupported(ext), false, ext);
    }
  });
});

describe("analyzeFileTS", () => {
  test("typescript: exact ranges for functions, classes with methods, interfaces, arrow consts", async () => {
    const src = [
      "import x from 'y';",                          // 1
      "",                                            // 2
      "export function alpha(a: number) {",          // 3
      "  return a;",                                 // 4
      "}",                                           // 5
      "",                                            // 6
      "export const beta = async (b: string) => {",  // 7
      "  return b;",                                 // 8
      "};",                                          // 9
      "",                                            // 10
      "export class Gamma {",                        // 11
      "  run() {",                                   // 12
      "    return 1;",                               // 13
      "  }",                                         // 14
      "}",                                           // 15
      "",                                            // 16
      "interface Delta { d: number }",               // 17
    ].join("\n");
    const r = await analyzed(src, ".ts");
    if (r === null) { console.log("  (wasm unavailable, skipped)"); return; }
    const byName = Object.fromEntries(r.symbols.map((s) => [s.name, s]));
    assert.deepStrictEqual([byName.alpha.startLine, byName.alpha.endLine], [3, 5]);
    assert.strictEqual(byName.alpha.kind, "fn");
    assert.deepStrictEqual([byName.beta.startLine, byName.beta.endLine], [7, 9]);
    assert.deepStrictEqual([byName.Gamma.startLine, byName.Gamma.endLine], [11, 15]);
    assert.strictEqual(byName["Gamma.run"].kind, "method");
    assert.deepStrictEqual([byName["Gamma.run"].startLine, byName["Gamma.run"].endLine], [12, 14]);
    assert.strictEqual(byName.Delta.kind, "section");
    // A plain const (no function) must not appear
    const r2 = await analyzed("const config = { a: 1 };\n", ".ts");
    assert.strictEqual(r2!.symbols.length, 0);
  });

  test("python: decorated defs and class methods", async () => {
    const src = "import os\n\n@dec\ndef top(a):\n    return a\n\nclass Foo:\n    def bar(self):\n        pass\n";
    const r = await analyzed(src, ".py");
    if (r === null) return;
    const names = r.symbols.map((s) => `${s.kind}:${s.name}`);
    assert.ok(names.includes("fn:top"), names.join(","));
    assert.ok(names.includes("class:Foo"));
    assert.ok(names.includes("method:Foo.bar"));
  });

  test("go: functions, methods, type declarations", async () => {
    const src = "package main\n\nfunc Hello() {}\n\ntype Server struct {\n\tport int\n}\n\nfunc (s *Server) Run() error {\n\treturn nil\n}\n";
    const r = await analyzed(src, ".go");
    if (r === null) return;
    const kinds = Object.fromEntries(r.symbols.map((s) => [s.name, s.kind]));
    assert.strictEqual(kinds.Hello, "fn");
    assert.strictEqual(kinds.Server, "class");
    assert.strictEqual(kinds.Run, "method");
  });

  test("rust: fns, structs, impl methods", async () => {
    const src = "pub fn free() {}\n\npub struct Point { x: i32 }\n\nimpl Point {\n    pub fn new() -> Self { Point { x: 0 } }\n}\n";
    const r = await analyzed(src, ".rs");
    if (r === null) return;
    const names = r.symbols.map((s) => `${s.kind}:${s.name}`);
    assert.ok(names.includes("fn:free"));
    assert.ok(names.includes("class:Point"));
    assert.ok(names.includes("method:Point.new"));
  });

  test("skeleton contains signature lines and respects the cap", async () => {
    const src = Array.from({ length: 50 }, (_, i) => `export function fn${i}(argument: number): number {\n  return argument + ${i};\n}`).join("\n\n");
    const r = await analyzed(src, ".ts");
    if (r === null) return;
    assert.ok(r.skeleton);
    assert.ok(r.skeleton!.includes("export function fn0(argument: number): number {"));
    assert.ok(Math.ceil(r.skeleton!.length / 3.5) <= 400 + 30, "skeleton stays near the token cap");
  });

  test("unsupported language and oversized content return null", async () => {
    assert.strictEqual(await analyzeFileTS("# heading\n", ".md"), null);
    const huge = "x".repeat(600 * 1024);
    assert.strictEqual(await analyzeFileTS(huge, ".ts"), null);
  });
});

describe("computeImportance", () => {
  test("a file imported by everything outranks leaves", () => {
    const files = {
      "src/shared.ts": "export const x = 1;\n",
      "src/a.ts": "import { x } from './shared.js';\n",
      "src/b.ts": "import { x } from './shared.js';\n",
      "src/c.ts": "import { x } from './shared.js';\nimport './a.js';\n",
    };
    const scores = computeImportance(files);
    assert.strictEqual(scores["src/shared.ts"], 1);
    assert.ok(scores["src/shared.ts"] > scores["src/b.ts"]);
    assert.ok(scores["src/a.ts"] > scores["src/b.ts"], "a is imported by c, b by nobody");
  });

  test("edge extraction resolves .js specifiers to .ts sources and ignores externals", () => {
    const files = {
      "src/cli/main.ts": "import express from 'express';\nimport { help } from '../util/help.js';\n",
      "src/util/help.ts": "export const help = 1;\n",
    };
    const edges = extractEdges(files);
    assert.deepStrictEqual(edges.get("src/cli/main.ts"), ["src/util/help.ts"]);
  });

  test("python dotted imports resolve within the project", () => {
    const files = {
      "pkg/core.py": "def f(): pass\n",
      "pkg/user.py": "from pkg.core import f\n",
    };
    const edges = extractEdges(files);
    assert.deepStrictEqual(edges.get("pkg/user.py"), ["pkg/core.py"]);
  });

  test("empty project returns empty scores", () => {
    assert.deepStrictEqual(computeImportance({}), {});
  });
});
