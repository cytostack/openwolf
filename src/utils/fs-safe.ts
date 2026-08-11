import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    Object.getPrototypeOf(v) === Object.prototype
  );
}

/**
 * Recursively fills missing keys in `loaded` from `defaults`.
 * Loaded values always win; defaults only fill gaps. Arrays and scalars
 * are replaced wholesale (not merged).
 */
function deepMergeDefaults<T>(defaults: T, loaded: T): T {
  if (!isPlainObject(defaults) || !isPlainObject(loaded)) return loaded;
  const result: Record<string, unknown> = { ...(defaults as Record<string, unknown>) };
  for (const key of Object.keys(loaded as Record<string, unknown>)) {
    const lv = (loaded as Record<string, unknown>)[key];
    const dv = (defaults as Record<string, unknown>)[key];
    if (isPlainObject(lv) && isPlainObject(dv)) {
      result[key] = deepMergeDefaults(dv, lv);
    } else {
      result[key] = lv;
    }
  }
  return result as T;
}

/**
 * Reads JSON from `filePath`. If the file exists and parses, its values are
 * deep-merged over `fallback` so that missing nested keys fall back to the
 * provided defaults (loaded values always win). If the file is missing or
 * unparseable, `fallback` is returned as-is.
 *
 * This prevents `TypeError: Cannot read properties of undefined` when a
 * user's config file predates a section a newer release reads.
 */
export function readJSON<T = unknown>(filePath: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as T;
    return deepMergeDefaults(fallback, parsed);
  } catch {
    return fallback;
  }
}

export function writeJSON(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmp = filePath + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmp, filePath);
  } catch {
    // On Windows, rename can fail if another process holds a handle.
    // Fall back to direct write and clean up the tmp file.
    try { fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8"); } catch {}
    try { fs.unlinkSync(tmp); } catch {}
  }
}

export function readText(filePath: string, fallback: string = ""): string {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return fallback;
  }
}

export function writeText(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmp = filePath + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
  try {
    fs.writeFileSync(tmp, content, "utf-8");
    fs.renameSync(tmp, filePath);
  } catch {
    // On Windows, rename can fail if another process holds a handle.
    // Fall back to direct write and clean up the tmp file.
    try { fs.writeFileSync(filePath, content, "utf-8"); } catch {}
    try { fs.unlinkSync(tmp); } catch {}
  }
}

export function appendText(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.appendFileSync(filePath, content, "utf-8");
}

// Drop-in replacement for fs.copyFileSync that works around a libuv/9P
// limitation: fs.copyFileSync uses the copy_file_range syscall on Linux,
// which fails with EPERM when writing to EFS-encrypted directories on
// Windows volumes mounted via WSL2 9P. Plain read+write bypasses
// copy_file_range and works in all cases.
export function safeCopyFile(src: string, dest: string): void {
  const dir = path.dirname(dest);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(dest, fs.readFileSync(src));
  try {
    fs.chmodSync(dest, fs.statSync(src).mode);
  } catch {}
}
