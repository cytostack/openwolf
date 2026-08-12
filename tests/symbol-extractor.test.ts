import { test, describe } from "node:test";
import * as assert from "node:assert";

import { extractSymbols, symbolsSupported, SYMBOL_MAX_BYTES, SYMBOL_MAX_COUNT } from "../src/hooks/symbol-extractor.ts";
import { parseAnatomy, renderStore, newStore } from "../src/hooks/anatomy-store.ts";

describe("symbol extraction per language", () => {
  test("typescript: functions, classes, arrows, interfaces; ranges chain correctly", () => {
    const src = [
      "import * as x from 'y';",              // 1
      "",                                       // 2
      "export function alpha(a: number) {",     // 3
      "  return a + 1;",                        // 4
      "}",                                      // 5
      "",                                       // 6
      "export const beta = (b: string) => {",   // 7
      "  return b.trim();",                     // 8
      "};",                                     // 9
      "",                                       // 10
      "export class Gamma {",                   // 11
      "  method() { return 1; }",               // 12
      "}",                                      // 13
      "",                                       // 14
      "export interface Delta {",               // 15
      "  x: number;",                           // 16
      "}",                                      // 17
    ].join("\n");
    const syms = extractSymbols(src, ".ts");
    assert.deepStrictEqual(syms.map((s) => [s.name, s.kind, s.startLine, s.endLine]), [
      ["alpha", "fn", 3, 6],
      ["beta", "fn", 7, 10],
      ["Gamma", "class", 11, 14],
      ["Delta", "section", 15, 17],
    ]);
    assert.ok(syms.every((s) => s.tokens > 0));
  });

  test("python: top-level defs and classes only (indented defs excluded)", () => {
    const src = "import os\n\ndef top(a):\n    return a\n\nclass Thing:\n    def method(self):\n        pass\n\nasync def later():\n    pass\n";
    const syms = extractSymbols(src, ".py");
    assert.deepStrictEqual(syms.map((s) => [s.name, s.kind]), [
      ["top", "fn"], ["Thing", "class"], ["later", "fn"],
    ]);
  });

  test("go: funcs with receivers, structs, interfaces", () => {
    const src = "package main\n\nfunc Plain() {}\n\nfunc (s *Server) Handle(w W, r R) {}\n\ntype Server struct {\n  port int\n}\n\ntype Handler interface {\n  Do()\n}\n";
    const syms = extractSymbols(src, ".go");
    assert.deepStrictEqual(syms.map((s) => [s.name, s.kind]), [
      ["Plain", "fn"], ["Handle", "fn"], ["Server", "class"], ["Handler", "section"],
    ]);
  });

  test("rust: fns incl. pub/async, structs, enums, impl blocks", () => {
    const src = "use std::io;\n\npub fn public_fn() {}\n\npub(crate) async fn crate_fn() {}\n\nstruct Point {\n  x: i32,\n}\n\npub enum Mode {\n  A,\n}\n\nimpl Display for Point {\n  fn fmt(&self) {}\n}\n";
    const syms = extractSymbols(src, ".rs");
    const names = syms.map((s) => s.name);
    assert.deepStrictEqual(names, ["public_fn", "crate_fn", "Point", "Mode", "Point"]);
  });

  test("CRLF content extracts identically to LF", () => {
    const lf = "export function one() {\n  return 1;\n}\n\nexport function two() {\n  return 2;\n}\n";
    const crlf = lf.replace(/\n/g, "\r\n");
    assert.deepStrictEqual(
      extractSymbols(crlf, ".ts").map((s) => [s.name, s.startLine, s.endLine]),
      extractSymbols(lf, ".ts").map((s) => [s.name, s.startLine, s.endLine])
    );
  });

  test("caps: unsupported ext, oversized content, symbol count", () => {
    assert.deepStrictEqual(extractSymbols("function x() {}", ".java"), []);
    assert.strictEqual(symbolsSupported(".java"), false);
    const big = "x".repeat(SYMBOL_MAX_BYTES + 1);
    assert.deepStrictEqual(extractSymbols(big, ".ts"), []);
    const many = Array.from({ length: 50 }, (_, i) => `function f${i}() {}`).join("\n");
    assert.strictEqual(extractSymbols(many, ".ts").length, SYMBOL_MAX_COUNT);
  });
});

describe("symbol rendering compatibility", () => {
  test("sub-bullets are invisible to the legacy entry parser", () => {
    const store = newStore();
    store.meta.lastScanned = "t";
    store.files["src/big.ts"] = {
      description: "Big module", tokens: 900, updatedAt: "x", source: "hook",
      symbols: [
        { name: "alpha", kind: "fn", startLine: 3, endLine: 6, tokens: 120 },
        { name: "Gamma", kind: "class", startLine: 11, endLine: 14, tokens: 300 },
      ],
    };
    const md = renderStore(store);
    assert.ok(md.includes("  - fn `alpha` L3-6 (~120 tok)"));
    const parsed = [...parseAnatomy(md).values()].flat();
    assert.strictEqual(parsed.length, 1, "legacy parser sees exactly the file entry");
    assert.strictEqual(parsed[0].file, "big.ts");
    assert.strictEqual(parsed[0].tokens, 900);
  });
});
