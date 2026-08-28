import * as fs from "node:fs"
import * as path from "node:path"
import * as crypto from "node:crypto"

export function getWolfDir(directory: string): string {
  return path.join(directory, ".wolf")
}

export function wolfDirExists(directory: string): boolean {
  return fs.existsSync(getWolfDir(directory))
}

export function readJSON<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T
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