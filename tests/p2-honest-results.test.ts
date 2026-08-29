import { test, describe } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFile, execFileSync } from "node:child_process";

import { condenseOutput } from "../src/hooks/bash-output-governor.ts";

// P2 (davdittrich): four places where OpenWolf reported success it had not
// achieved.
//   #82 Bash governor points at an already deleted log
//   #85 anatomy scan marks Git HEAD fresh when the locked write was skipped
//   #87 unknown cron task IDs return success to API and CLI callers
//   #90 benchmark arms can run different source revisions

const ROOT = path.resolve(import.meta.dirname ?? ".", "..");
const DIST_HOOKS = path.join(ROOT, "dist", "hooks");
const DIST_BENCH = path.join(ROOT, "dist", "src", "cli", "bench.js");
const DIST_SCANNER = path.join(ROOT, "dist", "src", "scanner", "anatomy-scanner.js");
const DIST_CRON = path.join(ROOT, "dist", "src", "daemon", "cron-engine.js");
const haveDist = fs.existsSync(path.join(DIST_HOOKS, "post-bash.js")) && fs.existsSync(DIST_BENCH);

describe("#82 preserved-output pointer", () => {
  test("names the cache path when the output was preserved", () => {
    const r = condenseOutput("grep_flood", "match\n".repeat(20000), 100, ".wolf/cache/bash/x.log");
    assert.ok(r);
    assert.ok(r!.text.includes("Full output preserved verbatim at .wolf/cache/bash/x.log"));
  });

  test("says so plainly when the output was NOT preserved", () => {
    const r = condenseOutput("grep_flood", "match\n".repeat(20000), 100, null);
    assert.ok(r);
    assert.ok(!r!.text.includes("preserved verbatim"), "must not claim preservation");
    assert.ok(!r!.text.includes(".log"), "must not name a file that does not exist");
    assert.match(r!.text, /NOT preserved/);
    assert.ok(r!.condensed_tokens < r!.original_tokens);
  });
});

describe("#82 governor over the cache cap (compiled)", { skip: !haveDist ? "dist not built" : false }, () => {
  test("a single log larger than the cache budget is never advertised as preserved", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ow-gov-"));
    const hooksDir = path.join(root, ".wolf", "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    for (const f of fs.readdirSync(DIST_HOOKS)) {
      if (f.endsWith(".js")) fs.copyFileSync(path.join(DIST_HOOKS, f), path.join(hooksDir, f));
    }
    fs.writeFileSync(path.join(hooksDir, "package.json"), JSON.stringify({ type: "module" }));
    fs.writeFileSync(
      path.join(root, ".wolf", "config.json"),
      JSON.stringify({ openwolf: { bash: { mode: "on", threshold_tokens: 100, families: { grep_flood: "replace" } } } }),
    );

    // Over the 50 MB cache budget, so the log the pointer would name cannot be
    // retained. 52,432,896 bytes is the issue's exact repro size; the line is
    // 22 bytes, so it has to be repeated past that before slicing.
    const flood = ("src/a.ts:1:match here\n".repeat(2_500_000)).slice(0, 52_432_896);
    assert.ok(Buffer.byteLength(flood, "utf-8") > 50 * 1024 * 1024, "payload must exceed the cache cap");

    const stdout: string = await new Promise((resolve, reject) => {
      const child = execFile(
        process.execPath,
        [path.join(hooksDir, "post-bash.js")],
        { env: { ...process.env, CLAUDE_PROJECT_DIR: root }, timeout: 120000, maxBuffer: 200 * 1024 * 1024 },
        (err, out) => (err ? reject(err) : resolve(out)),
      );
      child.stdin!.end(JSON.stringify({
        session_id: "governor-session",
        tool_use_id: "toolu_overcap",
        tool_input: { command: "grep -rn match ." },
        tool_response: { stdout: flood },
      }));
    });

    const logPath = path.join(root, ".wolf", "cache", "bash", "toolu_overcap.log");
    assert.ok(stdout.length > 0, "the hook must still govern an output this size");
    assert.strictEqual(fs.existsSync(logPath), false, "an over-cap output cannot be retained");
    assert.ok(
      !stdout.includes("preserved verbatim"),
      "the hook must not claim preservation for a log that is not on disk",
    );
    assert.ok(!stdout.includes("toolu_overcap.log"), "must not point at a file that does not exist");
    assert.match(stdout, /NOT preserved/, "it must say plainly that the output was not kept");
  });
});

describe("#85 anatomy freshness (compiled)", { skip: !haveDist ? "dist not built" : false }, () => {
  test("a skipped locked write does not advance _scan-state.json", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ow-scan-"));
    const wolfDir = path.join(root, ".wolf");
    fs.mkdirSync(wolfDir, { recursive: true });
    fs.writeFileSync(path.join(root, "only-file.ts"), "export const x = 1;\n");
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    execFileSync("git", ["add", "-A"], { cwd: root });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], { cwd: root });

    // Hold the anatomy lock with a live pid so the write must be skipped.
    fs.writeFileSync(
      path.join(wolfDir, "anatomy-index.lock"),
      JSON.stringify({ pid: process.pid, hostname: os.hostname(), acquiredAt: Date.now() }),
    );

    const { scanProject } = await import(DIST_SCANNER);
    await scanProject(wolfDir, root);

    assert.strictEqual(fs.existsSync(path.join(wolfDir, "anatomy.md")), false, "nothing was indexed");
    assert.strictEqual(
      fs.existsSync(path.join(wolfDir, "_scan-state.json")),
      false,
      "freshness must not claim the current HEAD is indexed when it is not",
    );
  });

  test("a successful scan does advance _scan-state.json", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ow-scan-ok-"));
    const wolfDir = path.join(root, ".wolf");
    fs.mkdirSync(wolfDir, { recursive: true });
    fs.writeFileSync(path.join(root, "only-file.ts"), "export const x = 1;\n");

    const { scanProject } = await import(DIST_SCANNER);
    await scanProject(wolfDir, root);

    assert.ok(fs.existsSync(path.join(wolfDir, "_scan-state.json")), "a real scan records freshness");
  });
});

describe("#87 unknown cron task id (compiled)", { skip: !haveDist ? "dist not built" : false }, () => {
  test("runTask rejects with a typed not-found instead of resolving", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ow-cron-"));
    const wolfDir = path.join(root, ".wolf");
    fs.mkdirSync(wolfDir, { recursive: true });
    fs.writeFileSync(
      path.join(wolfDir, "cron-manifest.json"),
      JSON.stringify({ version: 1, tasks: [{ id: "real-task", name: "Real", schedule: "0 * * * *", action: "scan", enabled: true }] }),
    );

    const { CronEngine, CronTaskNotFoundError } = await import(DIST_CRON);
    const engine = new CronEngine(wolfDir, root, { info() {}, warn() {}, error() {}, debug() {} }, () => {});

    await assert.rejects(
      () => engine.runTask("does-not-exist"),
      (err: unknown) => {
        assert.ok(err instanceof CronTaskNotFoundError, "must be the typed not-found error");
        assert.strictEqual((err as { taskId: string }).taskId, "does-not-exist");
        assert.deepStrictEqual((err as { knownTaskIds: string[] }).knownTaskIds, ["real-task"]);
        return true;
      },
    );
  });
});

describe("#90 benchmark revision pinning (compiled)", { skip: !haveDist ? "dist not built" : false }, () => {
  test("both arms get the pinned commit even when the branch moves mid-run", async () => {
    const { resolveRepoCommit, prepareRepoCheckout } = await import(DIST_BENCH);

    const origin = fs.mkdtempSync(path.join(os.tmpdir(), "ow-bench-origin-"));
    const git = (args: string[]) => execFileSync("git", args, { cwd: origin, stdio: "pipe" });
    git(["init", "--quiet"]);
    fs.writeFileSync(path.join(origin, "f.txt"), "first\n");
    git(["add", "-A"]);
    git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "first"]);

    const pinned = resolveRepoCommit(origin);
    assert.match(pinned, /^[0-9a-f]{40}$/);

    // Arm 1 is prepared, then the branch moves before arm 2 is prepared.
    const armA = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ow-arm-a-")), "repo");
    prepareRepoCheckout(origin, pinned, armA);

    fs.writeFileSync(path.join(origin, "f.txt"), "second\n");
    git(["add", "-A"]);
    git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "second"]);
    assert.notStrictEqual(resolveRepoCommit(origin), pinned, "the branch really moved");

    const armB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ow-arm-b-")), "repo");
    prepareRepoCheckout(origin, pinned, armB);

    const shaOf = (dir: string) =>
      execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf-8" }).trim();
    assert.strictEqual(shaOf(armA), pinned);
    assert.strictEqual(shaOf(armB), pinned, "arm B must not drift onto the newer commit");
    assert.strictEqual(fs.readFileSync(path.join(armA, "f.txt"), "utf-8"), "first\n");
    assert.strictEqual(fs.readFileSync(path.join(armB, "f.txt"), "utf-8"), "first\n");
  });
});
