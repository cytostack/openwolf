import * as fs from "node:fs";
import * as path from "node:path";

// Cross-process mutual exclusion for anatomy writers (OPENWOLF-2.0 §F2b).
//
// The lock is an atomically-created directory. Unlike stale-file deletion,
// mkdir does not require a check-then-unlink sequence that can remove a newer
// owner's replacement lock. Hooks wait only for a bounded budget and then
// degrade gracefully; abandoned directories require explicit cleanup.

const LOCK_DIR = "anatomy-index.lock";
const OWNER_FILE = "owner.json";

export const HOOK_LOCK_BUDGET_MS = 2_000;
export const CLI_LOCK_BUDGET_MS = 5_000;

/** Dependency-free synchronous sleep. */
function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function tryAcquire(lockPath: string): boolean {
  try {
    fs.mkdirSync(lockPath);
    try {
      fs.writeFileSync(
        path.join(lockPath, OWNER_FILE),
        JSON.stringify({ pid: process.pid, acquiredAt: Date.now() }),
        { flag: "wx" }
      );
      return true;
    } catch (error) {
      try { fs.rmdirSync(lockPath); } catch {}
      throw error;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return false;
  }
}

function release(lockPath: string): void {
  try { fs.unlinkSync(path.join(lockPath, OWNER_FILE)); } catch {}
  try { fs.rmdirSync(lockPath); } catch {}
}

/**
 * Run `fn` while holding the anatomy lock. Returns fn's result, or null if
 * the lock could not be acquired within `budgetMs`.
 */
export function withAnatomyLock<T>(wolfDir: string, budgetMs: number, fn: () => T): T | null {
  fs.mkdirSync(wolfDir, { recursive: true });
  const lockPath = path.join(wolfDir, LOCK_DIR);
  const deadline = Date.now() + budgetMs;

  while (!tryAcquire(lockPath)) {
    if (Date.now() >= deadline) return null;
    sleep(25 + Math.floor(Math.random() * 25));
  }

  try {
    return fn();
  } finally {
    release(lockPath);
  }
}
