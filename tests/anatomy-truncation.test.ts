import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAnatomy } from "../dist/src/scanner/anatomy-scanner.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

test("buildAnatomy reports truncation when file count exceeds max_files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-anatomy-"));
  const wolfDir = path.join(root, ".wolf");
  fs.mkdirSync(wolfDir, { recursive: true });
  fs.writeFileSync(
    path.join(wolfDir, "config.json"),
    JSON.stringify({
      version: 1,
      openwolf: {
        anatomy: {
          max_description_length: 100,
          max_files: 3,
          exclude_patterns: ["node_modules", ".git", ".wolf"],
        },
      },
    })
  );
  for (let i = 0; i < 5; i++) {
    fs.writeFileSync(path.join(root, `f${i}.ts`), `// file ${i}\nexport function fn${i}() {}`);
  }
  const { fileCount, truncated } = buildAnatomy(wolfDir, root);
  assert.strictEqual(fileCount, 3, "only max_files entries indexed");
  assert.strictEqual(truncated, true, "truncation must be flagged");
});

test("buildAnatomy does not flag truncation when under max_files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-anatomy-"));
  const wolfDir = path.join(root, ".wolf");
  fs.mkdirSync(wolfDir, { recursive: true });
  fs.writeFileSync(
    path.join(wolfDir, "config.json"),
    JSON.stringify({
      version: 1,
      openwolf: { anatomy: { max_description_length: 100, max_files: 10, exclude_patterns: ["node_modules", ".git", ".wolf"] } },
    })
  );
  for (let i = 0; i < 4; i++) {
    fs.writeFileSync(path.join(root, `g${i}.ts`), `// file ${i}\nexport function gn${i}() {}`);
  }
  const { fileCount, truncated } = buildAnatomy(wolfDir, root);
  assert.strictEqual(fileCount, 4);
  assert.strictEqual(truncated, false);
});
