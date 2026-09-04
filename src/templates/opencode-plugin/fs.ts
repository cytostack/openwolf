import * as fs from "node:fs"
import * as path from "node:path"
import * as crypto from "node:crypto"

export function getWolfDir(directory: string): string {
  return path.join(directory, ".wolf")
}

export function wolfDirExists(directory: string): boolean {
  return fs.existsSync(getWolfDir(directory))
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    Object.getPrototypeOf(v) === Object.prototype
  )
}

/**
 * Recursively fills missing keys in `loaded` from `defaults`.
 * Loaded values always win; defaults only fill gaps. Arrays and scalars
 * are replaced wholesale (not merged).
 */
function deepMergeDefaults<T>(defaults: T, loaded: T): T {
  if (!isPlainObject(defaults) || !isPlainObject(loaded)) return loaded
  const result: Record<string, unknown> = { ...(defaults as Record<string, unknown>) }
  for (const key of Object.keys(loaded as Record<string, unknown>)) {
    const lv = (loaded as Record<string, unknown>)[key]
    const dv = (defaults as Record<string, unknown>)[key]
    if (isPlainObject(lv) && isPlainObject(dv)) {
      result[key] = deepMergeDefaults(dv, lv)
    } else {
      result[key] = lv
    }
  }
  return result as T
}

/**
 * Reads JSON from `filePath`. If the file exists and parses, its values are
 * deep-merged over `fallback` so that missing nested keys fall back to the
 * provided defaults (loaded values always win). If the file is missing or
 * unparseable, `fallback` is returned as-is.
 *
 * This prevents `TypeError: Cannot read properties of undefined` when a
 * user's file predates a section a newer release reads (e.g. a pre-2.0
 * token-ledger.json without `lifetime`).
 */
export function readJSON<T>(filePath: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(filePath, "utf-8")
    const parsed = JSON.parse(raw) as T
    return deepMergeDefaults(fallback, parsed)
  } catch {
    return fallback
  }
}

export function writeJSON(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const tmp = filePath + "." + crypto.randomBytes(4).toString("hex") + ".tmp"
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8")
    fs.renameSync(tmp, filePath)
  } catch {
    try { fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8") } catch {}
    try { fs.unlinkSync(tmp) } catch {}
  }
}

/**
 * Per-session state path, mirroring getSessionFilePath() in src/hooks/shared.ts
 * (same id validation, same layout).
 *
 * Issue #89, reported with PR #113 by @davdittrich, whose session-file GC is
 * adopted below.
 *
 * Every OpenCode handler receives a sessionId but they all used to persist to
 * one shared hooks/_session.json, so starting a second session in the same
 * project overwrote the first one's state and each later read or write from
 * either session mutated the survivor (#89). The legacy shared file is used
 * only when there is no usable id, so existing single-session installs keep
 * working.
 */
export function sessionFilePath(hooksDir: string, sessionId: string | undefined): string {
  if (typeof sessionId === "string" && /^[\w.-]{4,128}$/.test(sessionId)) {
    return path.join(hooksDir, "sessions", `${sessionId}.json`)
  }
  return path.join(hooksDir, "_session.json")
}

/**
 * Delete per-session state files older than maxAgeDays.
 *
 * Mirrors gcSessionFiles() in src/hooks/shared.ts. Splitting state per session
 * fixes cross-session contamination but creates one file per session forever,
 * so the directory needs the same bound the main hooks already apply.
 */
export function gcSessionFiles(hooksDir: string, maxAgeDays = 7): void {
  const dir = path.join(hooksDir, "sessions")
  const cutoff = Date.now() - maxAgeDays * 24 * 3600 * 1000
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".json")) continue
      try {
        if (fs.statSync(path.join(dir, f)).mtimeMs < cutoff) fs.unlinkSync(path.join(dir, f))
      } catch {}
    }
  } catch {}
}

export function readMarkdown(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf-8")
  } catch {
    return ""
  }
}

export function appendMarkdown(filePath: string, line: string): void {
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.appendFileSync(filePath, line, "utf-8")
}

export function timeShort(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

export function timestamp(): string {
  return new Date().toISOString()
}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/")
}

export function estimateTokens(text: string, type: "code" | "prose" | "mixed" = "mixed"): number {
  const ratio = type === "code" ? 3.5 : type === "prose" ? 4.0 : 3.75
  return Math.ceil(text.length / ratio)
}

// Files whose contents (or content-derived descriptions) must never reach
// anatomy.md / memory.md because they hold secrets (issue #54). Mirrors
// isSensitiveFile in src/hooks/shared.ts.
const SENSITIVE_EXTENSIONS = new Set([
  ".pem", ".key", ".p8", ".p12", ".pfx", ".keystore", ".jks", ".ppk", ".kdbx", ".tfstate",
])
const SENSITIVE_BASENAMES = new Set([".npmrc", ".netrc", ".htpasswd", ".pgpass"])

export function isSensitiveFile(basename: string): boolean {
  const lower = basename.toLowerCase()
  if (lower === ".env" || lower.startsWith(".env.")) return true
  if (SENSITIVE_BASENAMES.has(lower)) return true
  const dot = lower.lastIndexOf(".")
  if (dot >= 0 && SENSITIVE_EXTENSIONS.has(lower.slice(dot))) return true
  if (/^id_(rsa|dsa|ecdsa|ed25519)/.test(lower)) return true
  if (lower.includes("credential") || /^secrets\.(json|ya?ml|toml)$/.test(lower)) return true
  return false
}