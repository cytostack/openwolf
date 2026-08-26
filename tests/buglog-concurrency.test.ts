import { test, describe } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// bug-tracker.ts imports ../hooks/anatomy-lock.js, and node's type stripping
// does not map a .js specifier onto its .ts source, so this exercises the
// build output the way buglog-shape.test.ts does.
const DIST = path.resolve(import.meta.dirname ?? ".", "..", "dist", "src", "buglog", "bug-tracker.js");
const tracker: {
  logBug: (d: string, b: Record<string, unknown>) => void;
  readBugLog: (d: string) => { bugs: Array<{ id: string; error_message: string; occurrences: number }> };
} | null = fs.existsSync(DIST) ? await import(DIST) : null;

function tmpWolf(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-blc-"));
  const wolfDir = path.join(root, ".wolf");
  fs.mkdirSync(wolfDir, { recursive: true });
  return wolfDir;
}

function bug(msg: string) {
  return { error_message: msg, file: "src/a.ts", root_cause: "r", fix: "f", tags: ["t"] };
}

// Multi-writer regression (TIK-System field report): two sessions sharing one
// .wolf logged bugs concurrently and the second read-modify-write clobbered
// the first. logBug now serializes through buglog.json.lock.
describe("buglog multi-writer", { skip: tracker === null && "dist build missing" }, () => {
  test("sequential logs assign distinct max-based ids and lose nothing", () => {
    const wolfDir = tmpWolf();
    tracker!.logBug(wolfDir, bug("first distinct failure alpha"));
    tracker!.logBug(wolfDir, bug("second distinct failure beta"));
    const log = tracker!.readBugLog(wolfDir);
    assert.equal(log.bugs.length, 2);
    assert.deepEqual(log.bugs.map((b) => b.id), ["bug-001", "bug-002"]);
  });

  test("a stale foreign lock does not drop a user-requested log", () => {
    const wolfDir = tmpWolf();
    // A lock owned by a dead pid on this host is stale and must be stolen
    // (or, at worst, fall back to the unlocked write) — never a silent drop.
    fs.writeFileSync(
      path.join(wolfDir, "buglog.json.lock"),
      JSON.stringify({ pid: 999999999, hostname: os.hostname(), acquiredAt: Date.now() - 60_000 }),
      "utf-8"
    );
    tracker!.logBug(wolfDir, bug("logged despite stale lock"));
    const log = tracker!.readBugLog(wolfDir);
    assert.equal(log.bugs.length, 1);
    assert.equal(log.bugs[0].error_message, "logged despite stale lock");
  });

  test("lock is released after logging (second log proceeds immediately)", () => {
    const wolfDir = tmpWolf();
    tracker!.logBug(wolfDir, bug("first distinct failure alpha"));
    assert.equal(fs.existsSync(path.join(wolfDir, "buglog.json.lock")), false);
    const start = Date.now();
    tracker!.logBug(wolfDir, bug("second distinct failure beta"));
    // No lock contention: must not burn the 5s CLI budget.
    assert.ok(Date.now() - start < 1000);
    assert.equal(tracker!.readBugLog(wolfDir).bugs.length, 2);
  });
});
