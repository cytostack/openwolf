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
  test("--selfcheck passes on a healthy install and fails on a broken one", () => {
    const root = tmpProject();
    const hooksDir = path.join(root, ".wolf", "hooks");
    for (const f of fs.readdirSync(DIST_HOOKS)) {
      if (f.endsWith(".js")) fs.copyFileSync(path.join(DIST_HOOKS, f), path.join(hooksDir, f));
    }
    fs.writeFileSync(path.join(hooksDir, "package.json"), JSON.stringify({ type: "module" }));

    const out = execFileSync(process.execPath, [path.join(hooksDir, "pre-read.js"), "--selfcheck"], { encoding: "utf-8" });
    assert.ok(out.includes("ok pre-read"));

    // Induce the exact 440-crash class: delete a dependency, not the hook.
    fs.unlinkSync(path.join(hooksDir, "anatomy-store.js"));
    assert.throws(() => {
      execFileSync(process.execPath, [path.join(hooksDir, "pre-read.js"), "--selfcheck"], { stdio: "pipe" });
    });
  });

  test("two sessions do not cross-contaminate duplicate tracking", async () => {
    const root = tmpProject();
    const hooksDir = path.join(root, ".wolf", "hooks");
    for (const f of fs.readdirSync(DIST_HOOKS)) {
      if (f.endsWith(".js")) fs.copyFileSync(path.join(DIST_HOOKS, f), path.join(hooksDir, f));
    }
    fs.writeFileSync(path.join(hooksDir, "package.json"), JSON.stringify({ type: "module" }));
    const target = path.join(root, "src.ts");
    fs.writeFileSync(target, "export const x = 1;\n");

    const runHook = (file: string, payload: unknown): Promise<{ stdout: string }> =>
      new Promise((resolve, reject) => {
        const child = execFile(
          process.execPath,
          [path.join(hooksDir, file)],
          { env: { ...process.env, CLAUDE_PROJECT_DIR: root }, timeout: 10000 },
          (err, stdout) => (err ? reject(err) : resolve({ stdout }))
        );
        child.stdin!.end(JSON.stringify(payload));
      });

    // Session A reads the file twice (full): pre-read + post-read then pre-read again.
    await runHook("pre-read.js", { session_id: "sessA", tool_input: { file_path: target } });
    await runHook("post-read.js", { session_id: "sessA", tool_input: { file_path: target }, tool_response: { file: { content: "export const x = 1;\n" } } });
    const dupA = await runHook("pre-read.js", { session_id: "sessA", tool_input: { file_path: target } });
    assert.ok(dupA.stdout.includes("already read this session"), "same session sees the duplicate warning");

    // Session B reads the same file for the FIRST time: no warning.
    const freshB = await runHook("pre-read.js", { session_id: "sessB", tool_input: { file_path: target } });
    assert.ok(!freshB.stdout.includes("already read this session"), "other session must not inherit A's reads");

    // Ranged read in a third session then a full read: no duplicate warning.
    await runHook("pre-read.js", { session_id: "sessC", tool_input: { file_path: target, offset: 1, limit: 1 } });
    const fullAfterRanged = await runHook("pre-read.js", { session_id: "sessC", tool_input: { file_path: target } });
    assert.ok(!fullAfterRanged.stdout.includes("already read this session"), "ranged contact must not mark the file as fully read");

    assert.ok(fs.existsSync(path.join(hooksDir, "sessions", "sessA.json")));
    assert.ok(fs.existsSync(path.join(hooksDir, "sessions", "sessB.json")));
  });
});

describe("public session transactions", { skip: !haveDist ? "dist/hooks not built" : false }, () => {
  function installHooks(): { root: string; hooksDir: string } {
    const root = tmpProject();
    const hooksDir = path.join(root, ".wolf", "hooks");
    for (const file of fs.readdirSync(DIST_HOOKS)) {
      if (file.endsWith(".js")) fs.copyFileSync(path.join(DIST_HOOKS, file), path.join(hooksDir, file));
    }
    fs.writeFileSync(path.join(hooksDir, "package.json"), JSON.stringify({ type: "module" }));
    return { root, hooksDir };
  }

  function startHook(hooksDir: string, root: string, file: string): { child: ReturnType<typeof execFile>; done: Promise<string> } {
    let resolve!: (stdout: string) => void;
    let reject!: (error: Error) => void;
    const done = new Promise<string>((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    const child = execFile(
      process.execPath,
      [path.join(hooksDir, file)],
      { env: { ...process.env, CLAUDE_PROJECT_DIR: root }, timeout: 10000, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout) => error ? reject(error) : resolve(stdout)
    );
    return { child, done };
  }

  async function runHooks(
    hooksDir: string,
    root: string,
    requests: Array<{ file: string; payload: unknown }>
  ): Promise<string[]> {
    const started = requests.map(({ file }) => startHook(hooksDir, root, file));
    for (let index = 0; index < started.length; index++) {
      started[index].child.stdin!.end(JSON.stringify(requests[index].payload));
    }
    return Promise.all(started.map(({ done }) => done));
  }

  function postReadPayload(sessionId: string, file: string, content = "export const value = 1;\n"): object {
    return {
      session_id: sessionId,
      tool_input: { file_path: file },
      tool_response: { file: { content } },
    };
  }

  function readSession(hooksDir: string, sessionId: string): Record<string, any> {
    return JSON.parse(fs.readFileSync(path.join(hooksDir, "sessions", `${sessionId}.json`), "utf-8"));
  }

  test("preserves every sequential and concurrent post-read fact without torn JSON", async () => {
    const { root, hooksDir } = installHooks();
    const sequential = "sequential-reads";
    const concurrent = "concurrent-reads";
    const sequentialFiles = Array.from({ length: 60 }, (_, i) => path.join(root, `sequential-${i}.ts`));
    const concurrentFiles = Array.from({ length: 60 }, (_, i) => path.join(root, `concurrent-${i}.ts`));

    for (const file of sequentialFiles) {
      await runHooks(hooksDir, root, [{ file: "post-read.js", payload: postReadPayload(sequential, file) }]);
    }
    assert.deepStrictEqual(Object.keys(readSession(hooksDir, sequential).files_read).sort(), sequentialFiles.sort());

    const sessionDir = path.join(hooksDir, "sessions");
    const sessionFile = `${concurrent}.json`;
    const parseFailures: string[] = [];
    let observedReplacements = 0;
    const watcher = fs.watch(sessionDir, (_event, changed) => {
      if (changed === sessionFile && fs.existsSync(path.join(sessionDir, sessionFile))) {
        observedReplacements++;
        try {
          JSON.parse(fs.readFileSync(path.join(sessionDir, sessionFile), "utf-8"));
        } catch (error) {
          parseFailures.push(String(error));
        }
      }
    });
    try {
      await runHooks(hooksDir, root, concurrentFiles.map((file) => ({ file: "post-read.js", payload: postReadPayload(concurrent, file) })));
      await new Promise<void>((resolve) => setImmediate(resolve));
    } finally {
      watcher.close();
    }
    const state = readSession(hooksDir, concurrent);
    assert.deepStrictEqual(Object.keys(state.files_read).sort(), concurrentFiles.sort());
    assert.ok(observedReplacements > 0, "expected atomic session replacements to be observable");
    assert.deepStrictEqual(parseFailures, []);
    assert.deepStrictEqual(fs.readdirSync(sessionDir).filter((file) => file.endsWith(".tmp")), []);
  });

  test("composes concurrent post-read and post-bash mutations", async () => {
    const { root, hooksDir } = installHooks();
    const sessionId = "mixed-hooks";
    const reads = Array.from({ length: 30 }, (_, i) => path.join(root, `read-${i}.ts`));
    const bashReads = Array.from({ length: 30 }, (_, i) => path.join(root, `bash-${i}.ts`));
    const oversized = "line\n".repeat(3000);
    const output = await runHooks(hooksDir, root, [
      ...reads.map((file) => ({ file: "post-read.js", payload: postReadPayload(sessionId, file) })),
      ...bashReads.map((file, index) => ({
        file: "post-bash.js",
        payload: {
          session_id: sessionId,
          tool_use_id: `mixed-${index}`,
          tool_input: { command: `cat ${file}` },
          tool_response: { stdout: oversized, stderr: "", interrupted: false, isImage: false },
        },
      })),
    ]);
    for (const stdout of output.slice(reads.length)) assert.doesNotThrow(() => JSON.parse(stdout));
    const state = readSession(hooksDir, sessionId);
    assert.deepStrictEqual(Object.keys(state.files_read).sort(), [...reads, ...bashReads].sort());
    assert.strictEqual(state.bash_governed.length, bashReads.length);
  });

  test("uses session-specific locks and reports same-session exhaustion without mutation", async () => {
    const { root, hooksDir } = installHooks();
    const sessionDir = path.join(hooksDir, "sessions");
    fs.mkdirSync(sessionDir, { recursive: true });
    const liveLock = JSON.stringify({ pid: process.pid, hostname: os.hostname(), acquiredAt: Date.now() });
    const locked = "locked-session";
    const independent = "independent-session";
    const lockedFile = path.join(sessionDir, `${locked}.json`);
    const before = JSON.stringify({ files_read: { before: { count: 1, tokens: 1, first_read: "now" } } });
    fs.writeFileSync(lockedFile, before);
    fs.writeFileSync(`${lockedFile}.lock`, liveLock);
    try {
      await runHooks(hooksDir, root, [{ file: "post-read.js", payload: postReadPayload(independent, path.join(root, "independent.ts")) }]);
      assert.ok(fs.existsSync(path.join(sessionDir, `${independent}.json`)));

      const output = await runHooks(hooksDir, root, [{ file: "post-read.js", payload: postReadPayload(locked, path.join(root, "blocked.ts")) }]);
      assert.strictEqual(output[0], "");
      assert.strictEqual(fs.readFileSync(lockedFile, "utf-8"), before);
      const heartbeat = JSON.parse(fs.readFileSync(path.join(hooksDir, "_heartbeat.json"), "utf-8"));
      assert.match(heartbeat["post-read"].last_error_message, /session lock exhausted/i);
    } finally {
      fs.unlinkSync(`${lockedFile}.lock`);
    }
  });

  test("retains session recovery, legacy fallback, and post-read response parsing contracts", async () => {
    const { root, hooksDir } = installHooks();
    const sessionDir = path.join(hooksDir, "sessions");
    fs.mkdirSync(sessionDir, { recursive: true });
    const corrupt = "corrupt-session";
    fs.writeFileSync(path.join(sessionDir, `${corrupt}.json`), "{");
    const fromArray = path.join(root, "array-response.ts");
    await runHooks(hooksDir, root, [{
      file: "post-read.js",
      payload: { session_id: corrupt, tool_input: { file_path: fromArray }, tool_response: [{ text: "const arrayResponse = true;" }] },
    }]);
    const recovered = readSession(hooksDir, corrupt);
    assert.ok(recovered.files_read[fromArray].tokens > 0);

    await runHooks(hooksDir, root, [{
      file: "post-read.js",
      payload: { session_id: "../bad", tool_input: { file_path: path.join(root, "legacy.ts") }, tool_response: "legacy" },
    }]);
    assert.ok(fs.existsSync(path.join(hooksDir, "_session.json")));
  });
});
