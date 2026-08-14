import { describe, test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

import { resolveProjectPath } from "../src/hooks/shared.ts";

const preReadPath = path.resolve(import.meta.dirname, "../dist/hooks/hooks/pre-read.js");
const postReadPath = path.resolve(import.meta.dirname, "../dist/hooks/hooks/post-read.js");

describe("hook project path containment", () => {
  test("accepts project files and normalizes separators", () => {
    const resolved = resolveProjectPath("D:\\work\\openwolf", "src\\hooks\\shared.ts");
    assert.ok(resolved);
    assert.strictEqual(resolved!.relativePath, "src/hooks/shared.ts");
    assert.strictEqual(resolved!.absolutePath, "D:\\work\\openwolf\\src\\hooks\\shared.ts");
  });

  test("rejects Windows cross-drive and parent escapes", () => {
    assert.strictEqual(
      resolveProjectPath("D:\\work\\openwolf", "C:\\Users\\dev\\memory.md"),
      null
    );
    assert.strictEqual(
      resolveProjectPath("D:\\work\\openwolf", "..\\outside.ts"),
      null
    );
  });

  test("rejects similarly-prefixed sibling roots", () => {
    assert.strictEqual(
      resolveProjectPath("D:\\work\\openwolf", "D:\\work\\openwolf-other\\file.ts"),
      null
    );
  });

  test("handles native absolute paths", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-path-"));
    const inside = path.join(root, "src", "file.ts");
    const outside = path.join(path.dirname(root), `${path.basename(root)}-other`, "file.ts");
    assert.strictEqual(resolveProjectPath(root, inside)?.relativePath, "src/file.ts");
    assert.strictEqual(resolveProjectPath(root, outside), null);
  });

  test("pre-read and post-read share one canonical session key", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-read-key-"));
    const wolfDir = path.join(root, ".wolf");
    const hooksDir = path.join(wolfDir, "hooks");
    const relativePath = path.join("src", "feature", "..", "feature.ts");
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(root, "src", "feature.ts"), "export const value = 1;\n", "utf-8");
    fs.writeFileSync(
      path.join(hooksDir, "_session.json"),
      JSON.stringify({
        session_id: "read-key-test",
        files_read: {},
        anatomy_hits: 0,
        anatomy_misses: 0,
        repeated_reads_warned: 0,
      }),
      "utf-8"
    );

    const env = { ...process.env, CLAUDE_PROJECT_DIR: root };
    const pre = spawnSync(process.execPath, [preReadPath], {
      cwd: root,
      env,
      input: JSON.stringify({ tool_input: { file_path: relativePath } }),
      encoding: "utf-8",
    });
    const post = spawnSync(process.execPath, [postReadPath], {
      cwd: root,
      env,
      input: JSON.stringify({
        tool_input: { file_path: relativePath },
        tool_output: { content: "export const value = 1;\n" },
      }),
      encoding: "utf-8",
    });

    assert.strictEqual(pre.status, 0, pre.stderr);
    assert.strictEqual(post.status, 0, post.stderr);
    const session = JSON.parse(
      fs.readFileSync(path.join(hooksDir, "_session.json"), "utf-8")
    );
    const entries = Object.entries(session.files_read) as Array<[
      string,
      { count: number; tokens: number }
    ]>;
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0][0], path.join(root, "src", "feature.ts").replace(/\\/g, "/"));
    assert.strictEqual(entries[0][1].count, 1);
    assert.ok(entries[0][1].tokens > 0);
  });
});
