import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";

// Cross-process mutual exclusion for anatomy writers (OPENWOLF-2.0 §F2b).
//
// Mechanism: lockfile created with the "wx" flag (atomic O_EXCL on macOS,
// Linux and Windows, no native deps). The file body records the owner for
// staleness detection. A stale lock (older than STALE_MS, or a dead pid on
// the same host) is stolen via rename-then-unlink: rename is atomic, so of N
// competing stealers exactly one wins and the rest keep waiting.
//
// Callers NEVER block the agent: on budget exhaustion withAnatomyLock returns
// null and the caller skips its update (the next writer converges the state).
// Self-contained on purpose: compiled standalone into the hooks bundle and
// imported directly by tests.

const LOCK_FILE = "anatomy-index.lock";
const STALE_MS = 10_000; // > hook timeout, so a killed hook's lock is reclaimable

export const HOOK_LOCK_BUDGET_MS = 2_000;
export const CLI_LOCK_BUDGET_MS = 5_000;

interface LockBody {
  pid: number;
  hostname: string;
  acquiredAt: number;
}

/** Dependency-free synchronous sleep. */
function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function tryAcquire(lockPath: string): boolean {
  try {
    const body: LockBody = { pid: process.pid, hostname: os.hostname(), acquiredAt: Date.now() };
    fs.writeFileSync(lockPath, JSON.stringify(body), { flag: "wx" });
    return true;
  } catch {
    return false;
  }
}

function isStale(lockPath: string): boolean {
  try {
    const body = JSON.parse(fs.readFileSync(lockPath, "utf-8")) as LockBody;
    if (typeof body.acquiredAt !== "number") return true;
    if (Date.now() - body.acquiredAt > STALE_MS) return true;
    if (body.hostname === os.hostname() && typeof body.pid === "number") {
      try {
        process.kill(body.pid, 0);
        return false; // owner alive
      } catch (err) {
        return (err as NodeJS.ErrnoException).code === "ESRCH";
      }
    }
    return false;
  } catch {
    // Unreadable/corrupt lock body: only age can save us; treat unreadable
    // as stale so a garbage file cannot deadlock the system forever.
    try {
      const st = fs.statSync(lockPath);
      return Date.now() - st.mtimeMs > STALE_MS;
    } catch {
      return false; // vanished — next acquire attempt will settle it
    }
  }
}

/** Steal a stale lock. Rename is atomic: exactly one competing stealer wins. */
function trySteal(lockPath: string): void {
  const graveyard = lockPath + "." + crypto.randomBytes(4).toString("hex") + ".stale";
  try {
    fs.renameSync(lockPath, graveyard);
    try { fs.unlinkSync(graveyard); } catch {}
  } catch {
    // Someone else won the steal or the owner released — keep waiting.
  }
}

/**
 * Run `fn` while holding the named lockfile. Returns fn's result, or null if
 * the lock could not be acquired within `budgetMs` (caller must degrade
 * gracefully — skip the update, never block). Same mechanism as the anatomy
 * lock; used for the other multi-writer JSON files (cron-state, token-ledger).
 */
export function withFileLock<T>(lockPath: string, budgetMs: number, fn: () => T): T | null {
  const deadline = Date.now() + budgetMs;
  let attempt = 0;

  while (true) {
    if (tryAcquire(lockPath)) break;
    if (isStale(lockPath)) trySteal(lockPath);
    if (Date.now() >= deadline) return null;
    // Start tight, then back off. A contended session-state critical section
    // is 1-3 ms, so the old flat 25-50 ms poll meant a 60-way herd needed
    // roughly 2 s just to drain — precisely the hook budget, which made the
    // slowest few writers give up and skip their update under load. The
    // capped exponential keeps long holders (anatomy writes) from spinning.
    const base = Math.min(2 * 2 ** Math.min(attempt, 4), 32);
    sleep(base + Math.floor(Math.random() * base));
    attempt++;
  }

  try {
    return fn();
  } finally {
    try { fs.unlinkSync(lockPath); } catch {}
  }
}

/**
 * Serialized read-modify-write against a shared JSON file.
 *
 * Issues #83, #84, #86 and #88, each reported with a fix by @davdittrich
 * (PRs #98, #109, #108, #105). This is the one helper those four sites share.
 *
 * Atomic writes (tmp + rename) prevent TORN files. They do not prevent LOST
 * UPDATES: two processes that each read, modify, and write independently both
 * produce a valid file, and the second one silently erases the first one's
 * change. Measured on real hooks: 60 concurrent post-read processes kept 26 of
 * 60 reads (#83); 60 concurrent registrations kept 43 of 60 projects (#88);
 * 60 concurrent SessionStart hooks counted 35 of 60 sessions (#84).
 *
 * The fix is not a better write, it is a serialized transaction. `mutate`
 * receives the CURRENT on-disk value, read inside the lock, and its result is
 * written before the lock is released. Never apply a delta to a snapshot read
 * before calling this.
 *
 * Returns the written value, or null if the lock could not be acquired within
 * `budgetMs` — callers must degrade, never block the agent. There is no
 * unlocked fallback on purpose: writing anyway on timeout defeats the lock for
 * every well-behaved writer (#86).
 */
export function mutateJSON<T>(
  filePath: string,
  fallback: T,
  budgetMs: number,
  mutate: (current: T) => T | void,
): T | null {
  // The lockfile lives next to the target, so its directory has to exist
  // BEFORE the first acquire attempt. Without this, a session file whose
  // directory has not been created yet can never take its own lock: every
  // tryAcquire fails with ENOENT, the whole budget is burned waiting, and the
  // update is skipped entirely.
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch {}

  return withFileLock(filePath + ".lock", budgetMs, () => {
    let current: T;
    try {
      current = JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
    } catch {
      current = fallback;
    }
    const returned = mutate(current);
    const next = returned === undefined ? current : (returned as T);
    writeJSONAtomic(filePath, next);
    return next;
  });
}

/** tmp + rename, with the Windows fallback used elsewhere in the codebase. */
function writeJSONAtomic(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const body = JSON.stringify(data, null, 2);
  const tmp = filePath + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
  try {
    fs.writeFileSync(tmp, body, "utf-8");
    fs.renameSync(tmp, filePath);
  } catch {
    // Rename can fail on Windows while another process holds a handle.
    try { fs.writeFileSync(filePath, body, "utf-8"); } catch {}
    try { fs.unlinkSync(tmp); } catch {}
  }
}

/**
 * Run `fn` while holding the anatomy lock. Returns fn's result, or null if
 * the lock could not be acquired within `budgetMs`.
 */
export function withAnatomyLock<T>(wolfDir: string, budgetMs: number, fn: () => T): T | null {
  return withFileLock(path.join(wolfDir, LOCK_FILE), budgetMs, fn);
}
