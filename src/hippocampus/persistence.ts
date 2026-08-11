import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const LOCK_DIR = "hippocampus.lock";
const OWNER_FILE = "owner.json";

export const HIPPOCAMPUS_HOOK_LOCK_BUDGET_MS = 5_000;
export const HIPPOCAMPUS_CLI_LOCK_BUDGET_MS = 10_000;

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function tryAcquire(lockPath: string): boolean {
  try {
    fs.mkdirSync(lockPath);
    try {
      fs.writeFileSync(
        path.join(lockPath, OWNER_FILE),
        JSON.stringify({
          pid: process.pid,
          acquired_at: Date.now(),
          owner_token: crypto.randomBytes(12).toString("hex"),
        }),
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

export function withHippocampusLock<T>(
  wolfDir: string,
  budgetMs: number,
  fn: () => T
): T | null {
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

function timestampForFilename(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function backupCorruptFile(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  const parsed = path.parse(filePath);

  for (let attempt = 0; attempt < 10; attempt++) {
    const suffix = crypto.randomBytes(4).toString("hex");
    const backupPath = path.join(
      parsed.dir,
      `${parsed.name}.corrupt-${timestampForFilename()}-${suffix}${parsed.ext || ".json"}`
    );

    try {
      fs.copyFileSync(filePath, backupPath, fs.constants.COPYFILE_EXCL);
      fs.unlinkSync(filePath);
      return backupPath;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EEXIST") continue;
      try { fs.unlinkSync(backupPath); } catch {}
      throw error;
    }
  }

  throw new Error(`Could not create a unique corrupt backup for ${filePath}`);
}

export function readJsonFile<T>(
  filePath: string,
  recoverCorrupt: boolean = false
): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    if (recoverCorrupt) backupCorruptFile(filePath);
    return null;
  }
}

export function writeJsonAtomic(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`
  );
  const payload = JSON.stringify(data, null, 2) + "\n";

  try {
    const fd = fs.openSync(tempPath, "wx", 0o600);
    try {
      fs.writeFileSync(fd, payload, "utf-8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }

    // Node's rename replaces an existing file atomically on supported local
    // filesystems, including Windows. Never remove or move the canonical file
    // first: unlocked readers must always see either the old or new document.
    fs.renameSync(tempPath, filePath);
  } finally {
    try { fs.unlinkSync(tempPath); } catch {}
  }
}
