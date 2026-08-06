import { test, describe } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/**
 * Drives the real hooks as child processes, the way the harness runs them, because the
 * defect is about what several PROCESSES sharing `_session.json` do to each other — it does
 * not reproduce inside one process.
 *
 * Hooks are loaded from `dist/` (built on demand): they import each other with relative
 * `.js` specifiers, which type-stripping does not rewrite.
 */
const repoRoot = path.resolve(import.meta.dirname, "..");
const distHooks = path.join(repoRoot, "dist", "src", "hooks");
if (!fs.existsSync(path.join(distHooks, "stop.js"))) {
  try {
    execSyncBuild();
  } catch {}
  if (!fs.existsSync(path.join(distHooks, "stop.js"))) throw new Error("build produced no dist/src/hooks");
}
function execSyncBuild() {
  // tsc exits non-zero on the pre-existing cron-engine TS2503 but still emits, so the
  // emitted file decides success, not the exit code.
  spawnSync("npx", ["tsc", "-p", "tsconfig.json"], { cwd: repoRoot, stdio: "ignore", shell: true });
}

const A = "sid-aaaa", B = "sid-bbbb", C = "sid-cccc";
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

function makeProject(session: Record<string, unknown>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-scope-"));
  const hooks = path.join(root, ".wolf", "hooks");
  fs.mkdirSync(hooks, { recursive: true });
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".wolf", "memory.md"),
    "# memory\n\n| Time | Action | File(s) | Outcome | ~Tokens |\n|---|---|---|---|---|\n",
    "utf-8"
  );
  fs.writeFileSync(path.join(hooks, "_session.json"), JSON.stringify(session), "utf-8");
  return { root, sessionFile: path.join(hooks, "_session.json") };
}
function runHook(p: { root: string }, hook: string, payload: unknown) {
  return spawnSync(process.execPath, [path.join(distHooks, hook)], {
    input: JSON.stringify(payload),
    encoding: "utf-8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: p.root },
  });
}
const readSession = (p: { sessionFile: string }) =>
  JSON.parse(fs.readFileSync(p.sessionFile, "utf-8")) as {
    files_written?: Array<{ sid?: string; file: string }>;
    edit_counts?: Record<string, number>;
  };

const baseSession = (writes: unknown[] = [], edit_counts: Record<string, number> = {}) => ({
  session_id: A,
  started: iso(3_600_000),
  files_read: {},
  files_written: writes,
  edit_counts,
  anatomy_hits: 0,
  anatomy_misses: 0,
  repeated_reads_warned: 0,
  cerebrum_warnings: 0,
  stop_count: 0,
});
const write = (sid: string, file: string, msAgo = 1000) => ({
  file,
  action: "edit",
  tokens: 5,
  at: iso(msAgo),
  sid,
});

describe("write tracking is scoped to the owning session", () => {
  test("post-write stamps the harness session id on each record", () => {
    const p = makeProject(baseSession());
    const target = path.join(p.root, "src", "x.py");
    fs.writeFileSync(target, "x = 1\n", "utf-8");
    runHook(p, "post-write.js", {
      session_id: A,
      tool_name: "Write",
      tool_input: { file_path: target, content: "x = 1\n" },
    });
    const rec = (readSession(p).files_written ?? [])[0];
    assert.ok(rec, "post-write recorded nothing");
    assert.equal(rec.sid, A, "record has no owner, so it belongs to every session");
    fs.rmSync(p.root, { recursive: true, force: true });
  });

  test("stop counts only its own writes, and deletes nobody else's", () => {
    const p = makeProject(
      baseSession([
        write(A, "src/mine1.py"),
        write(A, "src/mine2.py"),
        write(B, "src/theirs1.py"),
        write(B, "src/theirs2.py"),
        write(B, "src/theirs3.py"),
      ])
    );
    runHook(p, "stop.js", { session_id: A });

    const memory = fs.readFileSync(path.join(p.root, ".wolf", "memory.md"), "utf-8");
    const row = memory.split("\n").find((l) => l.includes("Session end:")) ?? "";
    assert.match(row, /Session end: 2 writes/, `reported the union, not this session: ${row}`);
    assert.equal(
      (readSession(p).files_written ?? []).length,
      5,
      "reading the scoped view must not persist it — that would delete the other session"
    );
    fs.rmSync(p.root, { recursive: true, force: true });
  });

  test("a new session does not wipe a live session's history", () => {
    const p = makeProject(
      baseSession(
        [
          write(A, "src/live.py", 60_000), // live
          write(A, "src/long.py", 13 * 3_600_000), // 13h — long-running, must survive
          write(B, "src/dead.py", 50 * 3_600_000), // >48h — genuinely dead
          write(C, "src/own.py", 60_000), // the starting session's own
        ],
        { [`${A}::src/live.py`]: 2, [`${B}::src/dead.py`]: 9 }
      )
    );
    runHook(p, "session-start.js", { session_id: C, source: "startup" });

    const after = readSession(p);
    const sids = (after.files_written ?? []).map((w) => w.sid);
    assert.equal(sids.filter((s) => s === A).length, 2, "dropped a live session's records");
    assert.ok(!sids.includes(B), "kept a >48h record; growth is unbounded");
    assert.ok(!sids.includes(C), "kept the starting session's own stale record");
    const counts = Object.keys(after.edit_counts ?? {});
    assert.ok(counts.some((k) => k.startsWith(A)));
    assert.ok(!counts.some((k) => k.startsWith(B)));
    fs.rmSync(p.root, { recursive: true, force: true });
  });

  test("edit_counts are namespaced, so the 3-edit reminder cannot count another session", () => {
    const p = makeProject(baseSession());
    const target = path.join(p.root, "src", "y.py");
    fs.writeFileSync(target, "y = 1\n", "utf-8");
    for (const sid of [A, A, B]) {
      runHook(p, "post-write.js", {
        session_id: sid,
        tool_name: "Edit",
        tool_input: { file_path: target, old_string: "y", new_string: "z" },
      });
    }
    const counts = readSession(p).edit_counts ?? {};
    assert.equal(Object.values(counts).filter((n) => n === 2).length, 1, JSON.stringify(counts));
    assert.equal(Object.keys(counts).length, 2, "one key per (session, file), not per file");
    fs.rmSync(p.root, { recursive: true, force: true });
  });
});
