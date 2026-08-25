import { test, describe } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync, execFile } from "node:child_process";

import { recordHeartbeat, getSessionFilePath, gcSessionFiles } from "../src/hooks/shared.ts";

const DIST_HOOKS = path.resolve(import.meta.dirname ?? ".", "..", "dist", "hooks");
const haveDist = fs.existsSync(path.join(DIST_HOOKS, "pre-read.js"));

function tmpProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-hh-"));
  fs.mkdirSync(path.join(root, ".wolf", "hooks"), { recursive: true });
  return root;
}

function withProjectEnv<T>(root: string, fn: () => T): T {
  const prev = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = root;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = prev;
  }
}

describe("heartbeat", () => {
  test("records success and failure with consecutive counts", () => {
    const root = tmpProject();
    withProjectEnv(root, () => {
      recordHeartbeat("pre-read");
      recordHeartbeat("post-write", new Error("boom"));
      recordHeartbeat("post-write", new Error("boom again"));
      const beats = JSON.parse(fs.readFileSync(path.join(root, ".wolf", "hooks", "_heartbeat.json"), "utf-8"));
      assert.ok(beats["pre-read"].last_ok);
      assert.strictEqual(beats["pre-read"].consecutive_failures, 0);
      assert.strictEqual(beats["post-write"].consecutive_failures, 2);
      assert.ok(beats["post-write"].last_error_message.includes("boom"));
      // Recovery resets the streak.
      recordHeartbeat("post-write");
      const after = JSON.parse(fs.readFileSync(path.join(root, ".wolf", "hooks", "_heartbeat.json"), "utf-8"));
      assert.strictEqual(after["post-write"].consecutive_failures, 0);
    });
  });
});

describe("session keying", () => {
  test("session_id maps to its own file; missing id falls back to legacy", () => {
    const root = tmpProject();
    withProjectEnv(root, () => {
      const a = getSessionFilePath({ session_id: "abc-123" });
      const b = getSessionFilePath({ session_id: "def-456" });
      const legacy = getSessionFilePath({});
      assert.ok(a.endsWith(path.join("sessions", "abc-123.json")));
      assert.notStrictEqual(a, b);
      assert.ok(legacy.endsWith("_session.json"));
      // Hostile ids never escape the sessions dir.
      const evil = getSessionFilePath({ session_id: "../../etc/passwd" });
      assert.ok(evil.endsWith("_session.json"));
    });
  });

  test("gc removes only old session files", () => {
    const root = tmpProject();
    withProjectEnv(root, () => {
      const dir = path.join(root, ".wolf", "hooks", "sessions");
      fs.mkdirSync(dir, { recursive: true });
      const oldFile = path.join(dir, "old.json");
      const newFile = path.join(dir, "new.json");
      fs.writeFileSync(oldFile, "{}");
      fs.writeFileSync(newFile, "{}");
      const past = Date.now() / 1000 - 10 * 24 * 3600;
      fs.utimesSync(oldFile, past, past);
      gcSessionFiles(7);
      assert.strictEqual(fs.existsSync(oldFile), false);
      assert.strictEqual(fs.existsSync(newFile), true);
    });
  });
});

describe("compiled hook integration", { skip: !haveDist ? "dist/hooks not built" : false }, () => {
  function installHooks(): { root: string; hooksDir: string } {
    const root = tmpProject();
    const hooksDir = path.join(root, ".wolf", "hooks");
    for (const f of fs.readdirSync(DIST_HOOKS)) {
      if (f.endsWith(".js")) fs.copyFileSync(path.join(DIST_HOOKS, f), path.join(hooksDir, f));
    }
    fs.writeFileSync(path.join(hooksDir, "package.json"), JSON.stringify({ type: "module" }));
    return { root, hooksDir };
  }

  function runHook(
    hooksDir: string,
    root: string,
    file: string,
    payload: unknown,
    cwd = root
  ): Promise<{ stdout: string }> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        process.execPath,
        [path.join(hooksDir, file)],
        { cwd, env: { ...process.env, CLAUDE_PROJECT_DIR: root }, timeout: 10000 },
        (err, stdout) => (err ? reject(err) : resolve({ stdout }))
      );
      child.stdin!.end(JSON.stringify(payload));
    });
  }

  function readSession(root: string, sessionId: string): Record<string, any> | null {
    const file = path.join(root, ".wolf", "hooks", "sessions", `${sessionId}.json`);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf-8")) : null;
  }

  test("--selfcheck passes on a healthy install and fails on a broken one", () => {
    const { root, hooksDir } = installHooks();

    const out = execFileSync(process.execPath, [path.join(hooksDir, "pre-read.js"), "--selfcheck"], { encoding: "utf-8" });
    assert.ok(out.includes("ok pre-read"));

    // Induce the exact 440-crash class: delete a dependency, not the hook.
    fs.unlinkSync(path.join(hooksDir, "anatomy-store.js"));
    assert.throws(() => {
      execFileSync(process.execPath, [path.join(hooksDir, "pre-read.js"), "--selfcheck"], { stdio: "pipe" });
    });
  });

  test("two sessions do not cross-contaminate duplicate tracking", async () => {
    const { root, hooksDir } = installHooks();
    const target = path.join(root, "src.ts");
    fs.writeFileSync(target, "export const x = 1;\n");

    // Session A reads the file twice (full): pre-read + post-read then pre-read again.
    await runHook(hooksDir, root, "pre-read.js", { session_id: "sessA", tool_input: { file_path: target } });
    await runHook(hooksDir, root, "post-read.js", { session_id: "sessA", tool_input: { file_path: target }, tool_response: { file: { content: "export const x = 1;\n" } } });
    const dupA = await runHook(hooksDir, root, "pre-read.js", { session_id: "sessA", tool_input: { file_path: target } });
    assert.ok(dupA.stdout.includes("already read this session"), "same session sees the duplicate warning");

    // Session B reads the same file for the FIRST time: no warning.
    const freshB = await runHook(hooksDir, root, "pre-read.js", { session_id: "sessB", tool_input: { file_path: target } });
    assert.ok(!freshB.stdout.includes("already read this session"), "other session must not inherit A's reads");

    // Ranged read in a third session then a full read: no duplicate warning.
    await runHook(hooksDir, root, "pre-read.js", { session_id: "sessC", tool_input: { file_path: target, offset: 1, limit: 1 } });
    const fullAfterRanged = await runHook(hooksDir, root, "pre-read.js", { session_id: "sessC", tool_input: { file_path: target } });
    assert.ok(!fullAfterRanged.stdout.includes("already read this session"), "ranged contact must not mark the file as fully read");

    assert.ok(fs.existsSync(path.join(hooksDir, "sessions", "sessA.json")));
    assert.ok(fs.existsSync(path.join(hooksDir, "sessions", "sessB.json")));
  });

  test("project read state stays lexically contained across public hooks", async () => {
    const { root, hooksDir } = installHooks();
    const sibling = `${root}-private/secret.ts`;
    const parent = path.join(path.dirname(root), `${path.basename(root)}-parent.ts`);
    const unrelated = path.join(os.tmpdir(), `unrelated-${path.basename(root)}.ts`);
    const external = [sibling, parent, unrelated];
    const hooks = ["pre-read.js", "post-read.js", "post-bash.js"];

    for (const [hookIndex, hook] of hooks.entries()) {
      for (const [pathIndex, candidate] of external.entries()) {
        const sessionId = `outside-${hookIndex}-${pathIndex}`;
        const payload = hook === "pre-read.js"
          ? { session_id: sessionId, tool_input: { file_path: candidate } }
          : hook === "post-read.js"
            ? { session_id: sessionId, tool_input: { file_path: candidate }, tool_response: { file: { content: "external\n" } } }
            : { session_id: sessionId, tool_input: { command: `cat ${candidate}` }, tool_response: { stdout: "external\n", stderr: "" } };
        await runHook(hooksDir, root, hook, payload);
        const state = readSession(root, sessionId);
        assert.deepStrictEqual(state?.files_read ?? {}, {}, `${hook} recorded external path ${candidate}`);
      }
    }

    const externalCwd = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-hh-cwd-"));
    fs.writeFileSync(path.join(externalCwd, "relative.ts"), "external\n");
    await runHook(
      hooksDir,
      root,
      "post-bash.js",
      { session_id: "outside-cwd", tool_input: { command: "cat relative.ts" }, tool_response: { stdout: "external\n", stderr: "" } },
      externalCwd
    );
    assert.deepStrictEqual(readSession(root, "outside-cwd")?.files_read ?? {}, {}, "relative Bash read must resolve from subprocess cwd");

    const descendants = [path.join(root, "src", "child.ts"), path.join(root, "..notes.ts")];
    fs.mkdirSync(path.dirname(descendants[0]), { recursive: true });
    for (const candidate of descendants) fs.writeFileSync(candidate, "inside\n");
    for (const [hookIndex, hook] of hooks.entries()) {
      for (const [pathIndex, candidate] of descendants.entries()) {
        const sessionId = `inside-${hookIndex}-${pathIndex}`;
        const payload = hook === "pre-read.js"
          ? { session_id: sessionId, tool_input: { file_path: candidate } }
          : hook === "post-read.js"
            ? { session_id: sessionId, tool_input: { file_path: candidate }, tool_response: { file: { content: "inside\n" } } }
            : { session_id: sessionId, tool_input: { command: `cat ${candidate}` }, tool_response: { stdout: "inside\n", stderr: "" } };
        await runHook(hooksDir, root, hook, payload);
        assert.ok(readSession(root, sessionId)?.files_read?.[candidate], `${hook} rejected project path ${candidate}`);
      }
    }

    const anatomy = path.join(root, ".wolf", "anatomy.md");
    fs.writeFileSync(anatomy, "# anatomy\n".repeat(700));
    const preInternal = await runHook(hooksDir, root, "pre-read.js", {
      session_id: "wolf-pre",
      tool_input: { file_path: anatomy },
    });
    assert.ok(preInternal.stdout.includes("index, not a document"), "pre-read advice remains active");
    assert.strictEqual(readSession(root, "wolf-pre")?.wolf_read_advised?.["anatomy.md"], true);

    await runHook(hooksDir, root, "post-read.js", {
      session_id: "wolf-post",
      tool_input: { file_path: anatomy },
      tool_response: { file: { content: "internal context\n" } },
    });
    const internalState = readSession(root, "wolf-post");
    assert.ok(internalState?.wolf_internal_tokens > 0, "post-read internal token accounting remains active");
    assert.ok(internalState?.wolf_internal_reads?.[".wolf/anatomy.md"] > 0);
  });
});
