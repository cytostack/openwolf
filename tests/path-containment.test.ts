import { test, describe } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";

import { relativeIfInside, isInsideDir, projectRelativePath } from "../src/hooks/shared.ts";

// Issue #80 (davdittrich): read hooks used `startsWith(projectDir)` for
// containment and the Bash read channel had no project-root check at all, so
// `.../project-private/secret.ts` was recorded in `.../project`'s session
// state and token metrics.

const DIST_HOOKS = path.resolve(import.meta.dirname ?? ".", "..", "dist", "hooks");
const haveDist = fs.existsSync(path.join(DIST_HOOKS, "post-read.js"));

describe("relativeIfInside", () => {
  const root = path.resolve(os.tmpdir(), "ow-containment", "project");

  test("a sibling directory sharing a string prefix is outside", () => {
    assert.strictEqual(relativeIfInside(root, path.join(path.dirname(root), "project-private", "secret.ts")), null);
    assert.strictEqual(isInsideDir(root, path.join(path.dirname(root), "project-private", "secret.ts")), false);
  });

  test("parent traversal is outside", () => {
    assert.strictEqual(relativeIfInside(root, path.join(root, "..", "..", "etc", "passwd")), null);
    assert.strictEqual(relativeIfInside(root, "../outside.ts"), null);
  });

  test("an unrelated absolute path is outside", () => {
    assert.strictEqual(relativeIfInside(root, path.resolve(path.sep, "etc", "passwd")), null);
  });

  test("files inside the project return a forward-slashed relative path", () => {
    assert.strictEqual(relativeIfInside(root, path.join(root, "src", "index.ts")), "src/index.ts");
    assert.strictEqual(relativeIfInside(root, "src/index.ts"), "src/index.ts");
    assert.strictEqual(relativeIfInside(root, path.join(root, ".wolf", "cerebrum.md")), ".wolf/cerebrum.md");
  });

  test("a path that traverses out and back in is inside", () => {
    assert.strictEqual(relativeIfInside(root, path.join(root, "src", "..", "README.md")), "README.md");
  });

  test("the root itself is contained but has an empty relative path", () => {
    assert.strictEqual(relativeIfInside(root, root), "");
  });

  test("empty inputs are rejected rather than resolving to cwd", () => {
    assert.strictEqual(relativeIfInside(root, ""), null);
    assert.strictEqual(relativeIfInside("", "anything.ts"), null);
  });

  test("a symlinked project root still resolves in-project files (macOS /tmp)", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "ow-link-"));
    const real = path.join(base, "real-project");
    const link = path.join(base, "linked-project");
    fs.mkdirSync(path.join(real, "src"), { recursive: true });
    fs.writeFileSync(path.join(real, "src", "a.ts"), "export const a = 1;\n");
    try {
      fs.symlinkSync(real, link, "dir");
    } catch {
      return; // no symlink privilege (Windows without developer mode)
    }
    // Root resolved one way, file path the other: lexically this looks external.
    assert.strictEqual(relativeIfInside(real, path.join(link, "src", "a.ts")), null);
    // The hook-facing check must still see it as in-project, existing or not.
    assert.strictEqual(projectRelativePath(real, path.join(link, "src", "a.ts")), "src/a.ts");
    assert.strictEqual(projectRelativePath(real, path.join(link, "src", "does-not-exist-yet.ts")), "src/does-not-exist-yet.ts");
    // And a genuine outsider stays outside even after realpath.
    assert.strictEqual(projectRelativePath(real, path.join(base, "elsewhere.ts")), null);
  });

  test("a directory whose name merely starts with the root name is outside", () => {
    // The exact shape of the original bug: no separator between root and rest.
    assert.strictEqual(relativeIfInside("/w/project", "/w/projectile/x.ts"), null);
    assert.strictEqual(relativeIfInside("/w/project", "/w/project/x.ts"), "x.ts");
  });
});

describe("hook boundary (compiled)", { skip: !haveDist ? "dist/hooks not built" : false }, () => {
  function fixture(): { root: string; hooksDir: string; sibling: string } {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "ow-bound-"));
    const root = path.join(base, "project");
    const hooksDir = path.join(root, ".wolf", "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    for (const f of fs.readdirSync(DIST_HOOKS)) {
      if (f.endsWith(".js")) fs.copyFileSync(path.join(DIST_HOOKS, f), path.join(hooksDir, f));
    }
    fs.writeFileSync(path.join(hooksDir, "package.json"), JSON.stringify({ type: "module" }));

    // Sibling project: shares "project" as a string prefix, is not inside it.
    const siblingDir = path.join(base, "project-private");
    fs.mkdirSync(siblingDir, { recursive: true });
    const sibling = path.join(siblingDir, "secret.ts");
    fs.writeFileSync(sibling, "export const apiKey = 'sk-real';\n");
    return { root, hooksDir, sibling };
  }

  const runHook = (hooksDir: string, root: string, file: string, payload: unknown): Promise<string> =>
    new Promise((resolve, reject) => {
      const child = execFile(
        process.execPath,
        [path.join(hooksDir, file)],
        { env: { ...process.env, CLAUDE_PROJECT_DIR: root }, timeout: 10000 },
        (err, stdout) => (err ? reject(err) : resolve(stdout)),
      );
      child.stdin!.end(JSON.stringify(payload));
    });

  // Read BOTH the per-session file and the legacy shared one: a negative
  // assertion must not pass merely because state landed somewhere else.
  const filesReadAnywhere = (hooksDir: string, id: string): string[] => {
    const keys: string[] = [];
    for (const p of [path.join(hooksDir, "sessions", `${id}.json`), path.join(hooksDir, "_session.json")]) {
      if (!fs.existsSync(p)) continue;
      const state = JSON.parse(fs.readFileSync(p, "utf-8")) as { files_read?: Record<string, unknown> };
      keys.push(...Object.keys(state.files_read ?? {}));
    }
    return keys;
  };

  test("pre-read and post-read do not record a sibling path", async () => {
    const { root, hooksDir, sibling } = fixture();
    await runHook(hooksDir, root, "pre-read.js", { session_id: "sess-outside", tool_input: { file_path: sibling } });
    await runHook(hooksDir, root, "post-read.js", {
      session_id: "sess-outside",
      tool_input: { file_path: sibling },
      tool_response: { file: { content: fs.readFileSync(sibling, "utf-8") } },
    });

    assert.deepStrictEqual(filesReadAnywhere(hooksDir, "sess-outside"), [], "sibling file must not enter project session state");
  });

  test("post-bash does not register a read of a sibling path", async () => {
    const { root, hooksDir, sibling } = fixture();
    await runHook(hooksDir, root, "post-bash.js", {
      session_id: "sess-bash",
      tool_input: { command: `cat ${sibling}` },
      tool_response: { stdout: fs.readFileSync(sibling, "utf-8") },
    });

    assert.deepStrictEqual(filesReadAnywhere(hooksDir, "sess-bash"), [], "Bash channel must apply the same project boundary");
  });

  test("a file genuinely inside the project is still tracked", async () => {
    const { root, hooksDir } = fixture();
    const inside = path.join(root, "src.ts");
    fs.mkdirSync(path.dirname(inside), { recursive: true });
    fs.writeFileSync(inside, "export const x = 1;\n");

    await runHook(hooksDir, root, "pre-read.js", { session_id: "sess-inside", tool_input: { file_path: inside } });
    await runHook(hooksDir, root, "post-read.js", {
      session_id: "sess-inside",
      tool_input: { file_path: inside },
      tool_response: { file: { content: "export const x = 1;\n" } },
    });

    const keys = filesReadAnywhere(hooksDir, "sess-inside");
    assert.strictEqual(keys.length, 1, "in-project reads must still be recorded");
    assert.ok(keys[0].endsWith("src.ts"), `expected src.ts, got ${keys[0]}`);
  });
});
