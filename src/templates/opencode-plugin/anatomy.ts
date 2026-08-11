import * as fs from "node:fs"
import * as path from "node:path"
import type { AnatomyEntry } from "./types.js"

export function parseAnatomy(content: string): Map<string, AnatomyEntry[]> {
  const sections = new Map<string, AnatomyEntry[]>()
  let currentSection = ""
  for (const raw of content.split("\n")) {
    const line = raw.replace(/\r$/, "")
    const sm = line.match(/^## (.+)/)
    if (sm) {
      currentSection = sm[1].trim()
      if (!sections.has(currentSection)) sections.set(currentSection, [])
      continue
    }
    if (!currentSection) continue
    const em = line.match(/^- `([^`]+)`(?:\s+—\s+(.+?))?\s*\(~(\d+)\s+tok\)$/)
    if (em) {
      sections.get(currentSection)!.push({
        file: em[1],
        description: em[2] || "",
        tokens: parseInt(em[3], 10),
      })
    }
  }
  return sections
}

export function serializeAnatomy(
  sections: Map<string, AnatomyEntry[]>,
  metadata: { lastScanned: string; fileCount: number; hits: number; misses: number }
): string {
  const lines: string[] = [
    "# anatomy.md",
    "",
    `> Auto-maintained by OpenWolf. Last scanned: ${metadata.lastScanned}`,
    `> Files: ${metadata.fileCount} tracked | Anatomy hits: ${metadata.hits} | Misses: ${metadata.misses}`,
    "",
  ]
  const keys = [...sections.keys()].sort()
  for (const key of keys) {
    lines.push(`## ${key}`)
    lines.push("")
    const entries = sections.get(key)!.sort((a, b) => a.file.localeCompare(b.file))
    for (const e of entries) {
      const desc = e.description ? ` — ${e.description}` : ""
      lines.push(`- \`${e.file}\`${desc} (~${e.tokens} tok)`)
    }
    lines.push("")
  }
  return lines.join("\n")
}

export function extractDescription(filePath: string): string {
  const MAX_DESC = 150
  const basename = path.basename(filePath)
  const ext = path.extname(basename).toLowerCase()
  const known: Record<string, string> = {
    "package.json": "Node.js package manifest",
    "tsconfig.json": "TypeScript configuration",
    ".gitignore": "Git ignore rules",
    "README.md": "Project documentation",
  }
  if (known[basename]) return known[basename]

  let content: string
  try {
    const fd = fs.openSync(filePath, "r")
    const buf = Buffer.alloc(12288)
    const n = fs.readSync(fd, buf, 0, 12288, 0)
    fs.closeSync(fd)
    content = buf.subarray(0, n).toString("utf-8")
  } catch {
    return ""
  }
  if (!content.trim()) return ""

  const cap = (s: string) => s.length <= MAX_DESC ? s : s.slice(0, MAX_DESC - 3) + "..."

  if (ext === ".md" || ext === ".mdx") {
    const m = content.match(/^#{1,2}\s+(.+)$/m)
    if (m) return cap(m[1].trim())
  }

  if (ext === ".ts" || ext === ".tsx" || ext === ".js" || ext === ".jsx") {
    if (basename === "page.tsx" || basename === "page.js") return "Next.js page component"
    if (basename === "layout.tsx" || basename === "layout.js") return "Next.js layout"
    const exports = (content.match(/export\s+(?:async\s+)?(?:function|class|const|interface|type|enum)\s+(\w+)/g) || [])
      .map(e => e.match(/(\w+)$/)?.[1]).filter(Boolean) as string[]
    if (exports.length > 0 && exports.length <= 5) return `Exports ${exports.join(", ")}`
    if (exports.length > 5) return cap(`Exports ${exports.slice(0, 4).join(", ")} + ${exports.length - 4} more`)
  }

  const declM = content.match(/(?:function|class|const|interface|type|enum)\s+(\w+)/)
  if (declM) return `Declares ${declM[1]}`
  return ""
}

// ── Durable store + lock (mirrors src/hooks/anatomy-store.ts, F2b) ──────────
import * as crypto from "node:crypto"

export const STORE_FILE = "anatomy-index.json"
export const LOCK_BUDGET_MS = 2_000

export function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex")
}

export interface StoreFileEntry {
  description: string
  tokens: number
  hash?: string
  size?: number
  mtimeMs?: number
  updatedAt: string
  source: "hook" | "scan" | "md-import"
  symbols?: Array<{ name: string; kind: string; startLine: number; endLine: number; tokens: number }>
}

export interface AnatomyStoreData {
  version: 1
  meta: { lastScanned: string; fileCount: number; hits: number; misses: number; renderedHash: string; storeUpdatedAt: string }
  files: Record<string, StoreFileEntry>
}

export function newStore(): AnatomyStoreData {
  const now = new Date().toISOString()
  return { version: 1, meta: { lastScanned: now, fileCount: 0, hits: 0, misses: 0, renderedHash: "", storeUpdatedAt: now }, files: {} }
}

export function loadStore(wolfDir: string): AnatomyStoreData | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(wolfDir, STORE_FILE), "utf-8"))
    if (parsed && parsed.version === 1 && parsed.files && parsed.meta) return parsed as AnatomyStoreData
    return null
  } catch {
    return null
  }
}

function writeFileAtomic(filePath: string, content: string): void {
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`
  )

  try {
    const fd = fs.openSync(tmp, "wx", 0o600)
    try {
      fs.writeFileSync(fd, content, "utf-8")
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    fs.renameSync(tmp, filePath)
  } finally {
    try { fs.unlinkSync(tmp) } catch {}
  }
}

export function saveStore(wolfDir: string, store: AnatomyStoreData): void {
  store.meta.fileCount = Object.keys(store.files).length
  store.meta.storeUpdatedAt = new Date().toISOString()
  writeFileAtomic(
    path.join(wolfDir, STORE_FILE),
    JSON.stringify(store, null, 2) + "\n"
  )
}

export function renderStore(store: AnatomyStoreData): string {
  const bySection = new Map<string, Array<{ file: string; entry: StoreFileEntry }>>()
  for (const [relPath, entry] of Object.entries(store.files)) {
    const dir = relPath.includes("/") ? relPath.slice(0, relPath.lastIndexOf("/") + 1) : "./"
    if (!bySection.has(dir)) bySection.set(dir, [])
    bySection.get(dir)!.push({ file: relPath.slice(relPath.lastIndexOf("/") + 1), entry })
  }
  const lines: string[] = [
    "# anatomy.md",
    "",
    `> Auto-maintained by OpenWolf. Last scanned: ${store.meta.lastScanned}`,
    `> Files: ${Object.keys(store.files).length} tracked | Anatomy hits: ${store.meta.hits} | Misses: ${store.meta.misses}`,
    "",
  ]
  const keys = [...bySection.keys()].sort()
  for (const key of keys) {
    lines.push(`## ${key}`)
    lines.push("")
    const entries = bySection.get(key)!.sort((a, b) => a.file.localeCompare(b.file))
    for (const { file, entry } of entries) {
      const desc = entry.description ? ` — ${entry.description}` : ""
      lines.push(`- \`${file}\`${desc} (~${entry.tokens} tok)`)
      for (const sym of entry.symbols ?? []) {
        lines.push(`  - ${sym.kind} \`${sym.name}\` L${sym.startLine}-${sym.endLine} (~${sym.tokens} tok)`)
      }
    }
    lines.push("")
  }
  return lines.join("\n")
}

export function renderToFile(wolfDir: string, store: AnatomyStoreData): void {
  const content = renderStore(store)
  store.meta.renderedHash = sha256(content)
  writeFileAtomic(path.join(wolfDir, "anatomy.md"), content)
}

export function importFromMarkdown(store: AnatomyStoreData, mdContent: string, projectRoot: string): void {
  const sections = parseAnatomy(mdContent)
  const seen = new Set<string>()
  for (const [sectionKey, entries] of sections) {
    const dir = sectionKey === "./" ? "" : sectionKey
    for (const e of entries) {
      const relPath = (dir + e.file).split("\\").join("/")
      seen.add(relPath)
      const existing = store.files[relPath]
      if (!existing) {
        store.files[relPath] = { description: e.description, tokens: e.tokens, updatedAt: new Date().toISOString(), source: "md-import" }
      } else if (existing.description !== e.description || existing.tokens !== e.tokens) {
        existing.description = e.description
        existing.tokens = e.tokens
        existing.updatedAt = new Date().toISOString()
        existing.source = "md-import"
      }
    }
  }
  for (const relPath of Object.keys(store.files)) {
    if (seen.has(relPath)) continue
    if (!fs.existsSync(path.join(projectRoot, relPath))) delete store.files[relPath]
  }
}

export function loadStoreReconciled(wolfDir: string, projectRoot: string): AnatomyStoreData {
  let store = loadStore(wolfDir)
  let md: string | null = null
  try { md = fs.readFileSync(path.join(wolfDir, "anatomy.md"), "utf-8") } catch {}
  if (!store) {
    store = newStore()
    if (md) importFromMarkdown(store, md, projectRoot)
    return store
  }
  if (md !== null && sha256(md) !== store.meta.renderedHash) importFromMarkdown(store, md, projectRoot)
  return store
}

function lockSleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

const LOCK_DIR = "anatomy-index.lock"
const OWNER_FILE = "owner.json"

function tryAcquire(lockPath: string): boolean {
  try {
    fs.mkdirSync(lockPath)
    try {
      fs.writeFileSync(
        path.join(lockPath, OWNER_FILE),
        JSON.stringify({ pid: process.pid, acquiredAt: Date.now() }),
        { flag: "wx" }
      )
      return true
    } catch (error) {
      try { fs.rmdirSync(lockPath) } catch {}
      throw error
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    return false
  }
}

function release(lockPath: string): void {
  try { fs.unlinkSync(path.join(lockPath, OWNER_FILE)) } catch {}
  try { fs.rmdirSync(lockPath) } catch {}
}

export function withAnatomyLock<T>(wolfDir: string, budgetMs: number, fn: () => T): T | null {
  fs.mkdirSync(wolfDir, { recursive: true })
  const lockPath = path.join(wolfDir, LOCK_DIR)
  const deadline = Date.now() + budgetMs
  while (!tryAcquire(lockPath)) {
    if (Date.now() >= deadline) return null
    lockSleep(25 + Math.floor(Math.random() * 25))
  }
  try {
    return fn()
  } finally {
    release(lockPath)
  }
}
