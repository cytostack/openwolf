import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

// Antigravity's Stop event fires every turn, not once at session close, so
// `openwolf finalize` exists to do manually what session-end.js normally does
// automatically for harnesses with a true SessionEnd hook (see docs/hooks.md).

function project(t: any) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-finalize-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, ".wolf", "hooks", "sessions"), { recursive: true });
  return root;
}

function writeSession(root: string, id: string, data: Record<string, unknown>) {
  fs.writeFileSync(
    path.join(root, ".wolf", "hooks", "sessions", `${id}.json`),
    JSON.stringify({
      session_id: id,
      started: "2026-09-19T00:00:00.000Z",
      files_read: {},
      files_written: [],
      edit_counts: {},
      anatomy_hits: 0,
      anatomy_misses: 0,
      repeated_reads_warned: 0,
      stop_count: 1,
      reminders_sent: {},
      ...data,
    })
  );
}

test("finalizeSession() flushes the ledger and writes Session end once, idempotently", async () => {
  const { finalizeSession } = await import("../dist/hooks/session-end.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-finalize-fn-"));
  try {
    fs.mkdirSync(path.join(root, ".wolf", "hooks", "sessions"), { recursive: true });
    process.env.OPENWOLF_PROJECT_ROOT = root;
    writeSession(root, "session-one", { files_written: [{ file: "a.ts", at: "2026-09-19T00:00:01.000Z" }] });

    const first = await finalizeSession({ session_id: "session-one" });
    assert.equal(first.finalized, true);
    assert.equal(first.session_id, "session-one");
    const memory = fs.readFileSync(path.join(root, ".wolf/memory.md"), "utf8");
    assert.match(memory, /Session end: 1 writes across 1 files \(a\.ts\)/);

    const second = await finalizeSession({ session_id: "session-one" });
    assert.equal(second.finalized, false);
    assert.equal(fs.readFileSync(path.join(root, ".wolf/memory.md"), "utf8").split("\n").filter(Boolean).length, 1);
  } finally {
    delete process.env.OPENWOLF_PROJECT_ROOT;
  }
});

test("finalizeSession() reports honestly when there is no session state to close", async () => {
  const { finalizeSession } = await import("../dist/hooks/session-end.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-finalize-empty-"));
  try {
    fs.mkdirSync(path.join(root, ".wolf"), { recursive: true });
    process.env.OPENWOLF_PROJECT_ROOT = root;
    const result = await finalizeSession({ session_id: "never-existed" });
    assert.equal(result.finalized, false);
    assert.match(result.reason ?? "", /no active session state/);
  } finally {
    delete process.env.OPENWOLF_PROJECT_ROOT;
  }
});

test("CLI `openwolf finalize` rejects agents that already have an automatic SessionEnd hook", t => {
  const root = project(t);
  assert.throws(
    () =>
      execFileSync(process.execPath, [path.resolve("dist/bin/openwolf.js"), "finalize", "--agent", "claude", "--session", "session-one"], {
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    /Unknown finalize agent/
  );
});

test("CLI `openwolf finalize --agent antigravity` closes a session end-to-end", t => {
  const root = project(t);
  writeSession(root, "session-two", { files_written: [{ file: "b.ts", at: "2026-09-19T00:00:01.000Z" }] });
  const out = execFileSync(process.execPath, [path.resolve("dist/bin/openwolf.js"), "finalize", "--agent", "antigravity", "--session", "session-two"], {
    cwd: root,
    encoding: "utf8",
  });
  const result = JSON.parse(out);
  assert.equal(result.finalized, true);
  assert.equal(result.session_id, "session-two");
});
