import { test } from "node:test";
import assert from "node:assert/strict";
import { extractDescription } from "../src/scanner/description-extractor.ts";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

function tmpFile(name: string, content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-desc-"));
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
}

test("C++ class with inheritance beats copyright header", () => {
  const p = tmpFile(
    "foo.cpp",
    `/**************************************************************************/\n/* Copyright (c) 2020 Example. All rights reserved.                    */\n/**************************************************************************/\n#include <iostream>\n\nclass Foo : public Bar {\npublic:\n  void doThing(int x);\n  int getValue() const;\n};\n`
  );
  const d = extractDescription(p);
  assert.ok(d.includes("Foo"), `expected Foo in "${d}"`);
  assert.ok(!d.toLowerCase().includes("copyright"), `should not return copyright: "${d}"`);
});

test("C++ struct and free functions are extracted", () => {
  const p = tmpFile(
    "main.cpp",
    `#include <cstdio>\nint main(int argc, char** argv) { return 0; }\nvoid init(int x);\n`
  );
  const d = extractDescription(p);
  assert.ok(d.includes("main") || d.includes("init"), `expected function name in "${d}"`);
});
