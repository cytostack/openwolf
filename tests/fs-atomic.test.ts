import { test } from "node:test";
import assert from "node:assert/strict";
import { readJSON, writeJSON } from "../dist/src/utils/fs-safe.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

test("writeJSON leaves no orphan temp and readJSON reads the canonical file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-fs-"));
  const filePath = path.join(dir, "config.json");
  writeJSON(filePath, { a: 1 });
  const result = readJSON<{ a: number }>(filePath, { a: 0 });
  assert.strictEqual(result.a, 1);
  // no temp residue
  const leftovers = fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"));
  assert.deepStrictEqual(leftovers, []);
});

test("readJSON ignores an orphaned temp file, reads the canonical file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-fs-"));
  const filePath = path.join(dir, "config.json");
  fs.writeFileSync(filePath, '{"a":7}');
  // simulate a crash-left torn temp
  fs.writeFileSync(filePath + ".deadbeef.tmp", '{"a":999');
  const result = readJSON<{ a: number }>(filePath, { a: 0 });
  assert.strictEqual(result.a, 7, "canonical file wins, torn temp ignored");
});
