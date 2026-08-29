import { test, describe } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";

import { mutateJSON, HOOK_LOCK_BUDGET_MS } from "../src/hooks/anatomy-lock.ts";

// P1 (davdittrich): atomic writes prevent torn files, never lost updates.
// #83 parallel hooks lose session-state updates
// #84 concurrent SessionStart hooks lose token-ledger session increments
// #86 cron state writes bypass lock after contention timeout
// #88 concurrent project registry updates lose entries
//
// Every "concurrent" case here spawns REAL processes, not promises: the bug is
// cross-process, and an in-process test would pass on the broken code.

const ROOT = path.resolve(import.meta.dirname ?? ".", "..");
const DIST_HOOKS = path.join(ROOT, "dist", "hooks");
const DIST_REGISTRY = path.join(ROOT, "dist", "src", "cli", "registry.js");
const haveDist = fs.existsSync(path.join(DIST_HOOKS, "post-read.js")) && fs.existsSync(DIST_REGISTRY);

const FANOUT = 60; // the fan-out the issues measured their losses at

function tmpProject(): { root: string; hooksDir: string; wolfDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ow-conc-"));
  const wolfDir = path.join(root, ".wolf");
  const hooksDir = path.join(wolfDir, "hooks");
  fs.mkdirSync(hooksDir, { recursive: true });
  for (const f of fs.readdirSync(DIST_HOOKS)) {
    if (f.endsWith(".js")) fs.copyFileSync(path.join(DIST_HOOKS, f), path.join(hooksDir, f));
  }
  fs.writeFileSync(path.join(hooksDir, "package.json"), JSON.stringify({ type: "module" }));
  return { root, hooksDir, wolfDir };
}

function runProcess(args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; stdin?: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, args, { cwd: opts.cwd, env: opts.env, timeout: 30000 }, (err) =>
      err ? reject(err) : resolve(),
    );
    child.stdin!.end(opts.stdin ?? "");
  });
}

describe("mutateJSON transaction", () => {
  test("returns null and writes NOTHING when the lock is held by a live process", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ow-lock-"));
    const target = path.join(dir, "state.json");
    fs.writeFileSync(target, JSON.stringify({ n: 1 }));
    // A live holder: this very process, so the staleness check cannot steal it.
    fs.writeFileSync(
      target + ".lock",
      JSON.stringify({ pid: process.pid, hostname: os.hostname(), acquiredAt: Date.now() }),
    );

    const result = mutateJSON<{ n: number }>(target, { n: 0 }, 300, (s) => { s.n = 999; });

    assert.strictEqual(result, null, "contention must be reported, not papered over");
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(target, "utf-8")), { n: 1 }, "no unlocked fallback write");
    assert.ok(fs.existsSync(target + ".lock"), "someone else's lock must survive");
  });

  test("creates the target directory so a first write can take its own lock", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ow-lock-"));
    const target = path.join(dir, "nested", "deeper", "state.json");
    const result = mutateJSON<{ n: number }>(target, { n: 0 }, HOOK_LOCK_BUDGET_MS, (s) => { s.n = 7; });
    assert.deepStrictEqual(result, { n: 7 });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(target, "utf-8")), { n: 7 });
  });

  test("releases the lock on a throwing mutator", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ow-lock-"));
    const target = path.join(dir, "state.json");
    assert.throws(() => mutateJSON(target, {}, 500, () => { throw new Error("boom"); }));
    assert.strictEqual(fs.existsSync(target + ".lock"), false, "a thrown mutator must not strand the lock");
    assert.deepStrictEqual(mutateJSON<{ ok?: boolean }>(target, {}, 500, (s) => { s.ok = true; }), { ok: true });
  });
});

describe("concurrent hooks (compiled)", { skip: !haveDist ? "dist not built" : false }, () => {
  test(`#83: ${FANOUT} parallel post-read hooks keep every distinct read`, async () => {
    const { root, hooksDir } = tmpProject();
    const files: string[] = [];
    for (let i = 0; i < FANOUT; i++) {
      const f = path.join(root, `file-${i}.ts`);
      fs.writeFileSync(f, `export const v${i} = ${i};\n`);
      files.push(f);
    }

    await Promise.all(
      files.map((f) =>
        runProcess([path.join(hooksDir, "post-read.js")], {
          env: { ...process.env, CLAUDE_PROJECT_DIR: root },
          stdin: JSON.stringify({
            session_id: "concurrent-session",
            tool_input: { file_path: f },
            tool_response: { file: { content: fs.readFileSync(f, "utf-8") } },
          }),
        }),
      ),
    );

    const state = JSON.parse(fs.readFileSync(path.join(hooksDir, "sessions", "concurrent-session.json"), "utf-8"));
    assert.strictEqual(
      Object.keys(state.files_read).length,
      FANOUT,
      `expected all ${FANOUT} reads; unlocked read-modify-write kept 26 of 60`,
    );
  });

  test(`#84: ${FANOUT} parallel SessionStart hooks count every session`, async () => {
    const { root, hooksDir, wolfDir } = tmpProject();
    await Promise.all(
      Array.from({ length: FANOUT }, (_, i) =>
        runProcess([path.join(hooksDir, "session-start.js")], {
          env: { ...process.env, CLAUDE_PROJECT_DIR: root },
          stdin: JSON.stringify({ session_id: `startup-session-${i}`, source: "startup" }),
        }),
      ),
    );

    const ledger = JSON.parse(fs.readFileSync(path.join(wolfDir, "token-ledger.json"), "utf-8"));
    const created = fs.readdirSync(path.join(hooksDir, "sessions")).filter((f) => f.endsWith(".json")).length;
    assert.strictEqual(created, FANOUT, "every session file should exist");
    assert.strictEqual(
      ledger.lifetime.total_sessions,
      FANOUT,
      `lifetime count must match sessions created; unlocked increment counted 35 of 60`,
    );
  });
});

describe("concurrent registry (compiled)", { skip: !haveDist ? "dist not built" : false }, () => {
  test(`#88: ${FANOUT} parallel registrations keep every project`, async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ow-home-"));
    const roots = Array.from({ length: FANOUT }, (_, i) => path.join(home, "projects", `p${i}`));

    await Promise.all(
      roots.map((r, i) =>
        runProcess(
          [
            "-e",
            `import(${JSON.stringify(DIST_REGISTRY)}).then(m => m.registerProject(${JSON.stringify(r)}, "p${i}", "2.5.0"))`,
          ],
          { env: { ...process.env, HOME: home, USERPROFILE: home } },
        ),
      ),
    );

    const registry = JSON.parse(fs.readFileSync(path.join(home, ".openwolf", "registry.json"), "utf-8"));
    assert.strictEqual(
      registry.projects.length,
      FANOUT,
      `expected all ${FANOUT} projects; unlocked read-modify-write kept 43 of 60`,
    );
    assert.strictEqual(new Set(registry.projects.map((p: { root: string }) => p.root)).size, FANOUT);
  });

  test("#88: a concurrent unregister removes only its own entry", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ow-home-"));
    const roots = Array.from({ length: 20 }, (_, i) => path.join(home, "projects", `p${i}`));
    for (const [i, r] of roots.entries()) {
      await runProcess(
        ["-e", `import(${JSON.stringify(DIST_REGISTRY)}).then(m => m.registerProject(${JSON.stringify(r)}, "p${i}", "2.5.0"))`],
        { env: { ...process.env, HOME: home, USERPROFILE: home } },
      );
    }

    // Unregister the first 10 while registering 10 more, all at once.
    await Promise.all([
      ...roots.slice(0, 10).map((r) =>
        runProcess(["-e", `import(${JSON.stringify(DIST_REGISTRY)}).then(m => m.unregisterProject(${JSON.stringify(r)}))`],
          { env: { ...process.env, HOME: home, USERPROFILE: home } }),
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        runProcess(
          ["-e", `import(${JSON.stringify(DIST_REGISTRY)}).then(m => m.registerProject(${JSON.stringify(path.join(home, "projects", `late${i}`))}, "late${i}", "2.5.0"))`],
          { env: { ...process.env, HOME: home, USERPROFILE: home } },
        ),
      ),
    ]);

    const registry = JSON.parse(fs.readFileSync(path.join(home, ".openwolf", "registry.json"), "utf-8"));
    assert.strictEqual(registry.projects.length, 20, "10 survivors + 10 late registrations");
  });
});

describe("cron state lock (compiled)", { skip: !haveDist ? "dist not built" : false }, () => {
  const DIST_CRON_CMD = path.join(ROOT, "dist", "src", "cli", "cron-cmd.js");

  test("#86: a held lock blocks the write instead of bypassing it", async () => {
    const { root, wolfDir } = tmpProject();
    const statePath = path.join(wolfDir, "cron-state.json");
    const original = {
      engine_status: "running",
      execution_log: [],
      dead_letter_queue: [{ task_id: "nightly-scan", error: "boom", timestamp: new Date().toISOString(), attempts: 3 }],
    };
    fs.writeFileSync(statePath, JSON.stringify(original, null, 2));
    // Held by a live process (this one), so the staleness check cannot steal it.
    fs.writeFileSync(
      statePath + ".lock",
      JSON.stringify({ pid: process.pid, hostname: os.hostname(), acquiredAt: Date.now() }),
    );

    let stderr = "";
    let code: number | null = 0;
    await new Promise<void>((resolve) => {
      const child = execFile(
        process.execPath,
        ["-e", `import(${JSON.stringify(DIST_CRON_CMD)}).then(m=>m.cronRetry("nightly-scan")).then(()=>process.exit(process.exitCode ?? 0))`],
        { cwd: root, timeout: 30000 },
        (err, _out, errOut) => { stderr = errOut ?? ""; code = err ? (err as NodeJS.ErrnoException & { code?: number }).code ?? 1 : 0; resolve(); },
      );
      child.stdin!.end("");
    });

    assert.deepStrictEqual(
      JSON.parse(fs.readFileSync(statePath, "utf-8")),
      original,
      "the dead letter entry must survive: no unlocked write past the budget",
    );
    assert.notStrictEqual(code, 0, "contention must be a nonzero exit, not a silent success");
    assert.match(stderr, /locked/i);
    assert.ok(fs.existsSync(statePath + ".lock"), "someone else's lock must survive");
  });

  test("#86: with the lock free, retry actually removes the entry", async () => {
    const { root, wolfDir } = tmpProject();
    const statePath = path.join(wolfDir, "cron-state.json");
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        engine_status: "running",
        execution_log: [],
        dead_letter_queue: [{ task_id: "nightly-scan", error: "boom", timestamp: new Date().toISOString(), attempts: 3 }],
      }),
    );

    await runProcess(["-e", `import(${JSON.stringify(DIST_CRON_CMD)}).then(m=>m.cronRetry("nightly-scan"))`], { cwd: root });

    const after = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    assert.strictEqual(after.dead_letter_queue.length, 0);
  });
});
