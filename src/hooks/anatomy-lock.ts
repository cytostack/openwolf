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
 * Run `fn` while holding the anatomy lock. Returns fn's result, or null if
 * the lock could not be acquired within `budgetMs` (caller must degrade
 * gracefully — skip the update, never block).
 */
export function withAnatomyLock<T>(wolfDir: string, budgetMs: number, fn: () => T): T | null {
  const lockPath = path.join(wolfDir, LOCK_FILE);
  const deadline = Date.now() + budgetMs;

  while (true) {
    if (tryAcquire(lockPath)) break;
    if (isStale(lockPath)) trySteal(lockPath);
    if (Date.now() >= deadline) return null;
    sleep(25 + Math.floor(Math.random() * 25));
  }

  try {
    return fn();
  } finally {
    try { fs.unlinkSync(lockPath); } catch {}
  }
}
