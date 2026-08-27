import * as fs from "node:fs"
import * as path from "node:path"
import * as crypto from "node:crypto"
import { getWolfDir, getSessionFilePath, writeJSON, readJSON, appendMarkdown, timeShort, normalizePath, estimateTokens, isSensitiveFile } from "./fs.js"
import { extractDescription, withAnatomyLock, loadStoreReconciled, saveStore, renderToFile, sha256, LOCK_BUDGET_MS } from "./anatomy.js"
import type { PartialSessionState, FixDetection } from "./types.js"

// File types where a value/string change is normal content editing, not a bug
// fix — auto bug detection never runs on these (see autoDetectBugFix). Without
// this, a version bump in a README or a key change in a JSON/YAML config is
// logged as a "wrong-value" bug, since the detector matches quoted spans
// (including markdown backticks) regardless of file type.
const NON_CODE_EXTS = new Set([
  ".md", ".mdx", ".markdown", ".txt", ".rst", ".adoc",
  ".json", ".jsonc", ".yaml", ".yml", ".toml", ".ini", ".env",
  ".lock", ".csv", ".tsv",
])

export function handlePostWrite(
  directory: string,
  sessionId: string,
  toolName: string,
  filePath: string,
  content: string,
  oldStr: string,
  newStr: string
): void {
  const wolfDir = getWolfDir(directory)
  if (!fs.existsSync(wolfDir)) return

  const sessionFile = getSessionFilePath(directory, sessionId)
  const projectRoot = directory

  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(projectRoot, filePath)
  const relPath = normalizePath(path.relative(projectRoot, absolutePath))
  if (relPath.startsWith(".wolf/")) return

  // Never track files outside the project root (e.g. a scratchpad under
  // /private/tmp). path.relative() yields ../.. section keys that pollute
  // anatomy.md and are wiped again by every full scan, so the index churns
  // instead of converging.
  if (relPath.startsWith("..") || path.isAbsolute(relPath)) return

  // Never track secret-bearing files in anatomy/memory (issue #54): .env is
  // not the only file whose description would leak sensitive content.
  const baseName = path.basename(absolutePath)
  if (isSensitiveFile(baseName)) return

  updateAnatomy(wolfDir, absolutePath, projectRoot, content)
  appendToMemory(wolfDir, toolName, absolutePath, projectRoot, content, newStr)
  trackSession(sessionFile, filePath, toolName, content, newStr, baseName, projectRoot, absolutePath)

  if (oldStr && newStr) {
    autoDetectBugFix(wolfDir, absolutePath, projectRoot, oldStr, newStr)
  }
}

function updateAnatomy(wolfDir: string, absolutePath: string, projectRoot: string, content: string): void {
  try {
    const relPathLocal = normalizePath(path.relative(projectRoot, absolutePath))

    let fileContent = ""
    try {
      fileContent = fs.readFileSync(absolutePath, "utf-8")
    } catch {
      fileContent = content ?? ""
    }

    const desc = extractDescription(absolutePath).slice(0, 100)
    const ext = path.extname(absolutePath).toLowerCase()
    const codeExts = new Set([".ts", ".js", ".tsx", ".jsx", ".py", ".json", ".yaml", ".yml", ".css"])
    const proseExts = new Set([".md", ".txt", ".rst"])
    const type = codeExts.has(ext) ? "code" : proseExts.has(ext) ? "prose" : "mixed"
    const tokens = estimateTokens(fileContent, type as "code" | "prose" | "mixed")

    let size: number | undefined
    let mtimeMs: number | undefined
    try {
      const st = fs.statSync(absolutePath)
      size = st.size
      mtimeMs = st.mtimeMs
    } catch {}

    withAnatomyLock(wolfDir, LOCK_BUDGET_MS, () => {
      const store = loadStoreReconciled(wolfDir, projectRoot)
      store.files[relPathLocal] = {
        description: desc,
        tokens,
        hash: sha256(fileContent).slice(0, 16),
        size,
        mtimeMs,
        updatedAt: new Date().toISOString(),
        source: "hook",
        // The plugin cannot recompute symbols; drop them so stale line
        // ranges never misdirect a slice read (the next scan restores them).
        symbols: undefined,
      }
      store.meta.lastScanned = new Date().toISOString()
      renderToFile(wolfDir, store)
      saveStore(wolfDir, store)
    })
  } catch {}
}

function appendToMemory(
  wolfDir: string,
  toolName: string,
  absolutePath: string,
  projectRoot: string,
  content: string,
  newStr: string
): void {
  try {
    const action = toolName === "Write" ? "Created" : toolName === "MultiEdit" ? "Multi-edited" : "Edited"
    const relFile = normalizePath(path.relative(projectRoot, absolutePath))
    const fileContent = content ?? ""
    const ext = path.extname(absolutePath).toLowerCase()
    const codeExts = new Set([".ts", ".js", ".tsx", ".jsx", ".py", ".json", ".yaml", ".yml", ".css"])
    const type = codeExts.has(ext) ? "code" : "mixed"
    const writeTokens = estimateTokens(fileContent || newStr, type as "code" | "prose" | "mixed")

    let changeDesc = ""
    if (content && newStr) {
      changeDesc = summarizeEdit(content, newStr, path.basename(absolutePath))
    }

    const memoryPath = path.join(wolfDir, "memory.md")
    const outcome = changeDesc || "—"
    appendMarkdown(memoryPath, `| ${timeShort()} | ${action} ${relFile} | ${outcome} | ~${writeTokens} |\n`)
  } catch {}
}

function trackSession(
  sessionFile: string,
  filePath: string,
  toolName: string,
  content: string,
  newStr: string,
  baseName: string,
  projectRoot: string,
  absolutePath: string
): void {
  try {
    const session = readJSON<PartialSessionState>(sessionFile, { files_written: [], edit_counts: {} })
    if (!session.edit_counts) session.edit_counts = {}

    const normalizedFile = normalizePath(filePath)
    const action = toolName === "Write" ? "create" : "edit"
    const fileContent = content ?? ""
    const tokens = estimateTokens(fileContent || newStr, "code")

    session.files_written!.push({
      file: normalizedFile,
      action,
      tokens,
      at: new Date().toISOString(),
    })

    const editKey = normalizePath(path.relative(projectRoot, absolutePath))
    session.edit_counts![editKey] = (session.edit_counts![editKey] || 0) + 1

    // A write invalidates the read record: the next read of this file is
    // legitimate, not a duplicate.
    if (session.files_read && session.files_read[normalizedFile]) {
      delete session.files_read[normalizedFile]
    }

    writeJSON(sessionFile, session)

    if (session.edit_counts![editKey] >= 3) {
      console.warn(`⚠️ OpenWolf: ${baseName} has been edited ${session.edit_counts![editKey]} times this session. If you're fixing a bug, remember to log it to .wolf/buglog.json.`)
    }
  } catch {}
}

export function summarizeEdit(oldStr: string, newStr: string, filename: string): string {
  const oldLines = oldStr.split("\n")
  const newLines = newStr.split("\n")
  const oldCount = oldLines.length
  const newCount = newLines.length

  if (newStr.includes("try") && newStr.includes("catch") && !oldStr.includes("catch")) return "added error handling"
  if (newStr.includes("?.") && !oldStr.includes("?.")) return "added optional chaining"
  if (newStr.includes("?? ") && !oldStr.includes("?? ")) return "added nullish coalescing"

  if (!newStr.trim() || newStr.trim().length < oldStr.trim().length * 0.2) return `removed ${oldCount} lines`

  const oldImports = oldLines.filter(l => /^\s*(import|require|use |from )/.test(l)).length
  const newImports = newLines.filter(l => /^\s*(import|require|use |from )/.test(l)).length
  if (newImports > oldImports && Math.abs(newCount - oldCount) <= newImports - oldImports + 1) return `added ${newImports - oldImports} import(s)`

  if (oldCount === 1 && newCount === 1) {
    const o = oldStr.trim()
    const n = newStr.trim()
    const oStr = o.match(/['"`]([^'"`]+)['"`]/)
    const nStr = n.match(/['"`]([^'"`]+)['"`]/)
    if (oStr && nStr && oStr[1] !== nStr[1]) return `"${oStr[1].slice(0, 25)}" → "${nStr[1].slice(0, 25)}"`
    return "inline fix"
  }

  const fnMatch = newStr.match(/(?:function|def|fn|func|async\s+function)\s+(\w+)/)
  if (fnMatch) return `modified ${fnMatch[1]}()`

  if (newCount > oldCount + 5) return `expanded (+${newCount - oldCount} lines)`
  if (oldCount > newCount + 5) return `reduced (-${oldCount - newCount} lines)`

  return `${oldCount}→${newCount} lines`
}

function bugAutoDetectEnabled(wolfDir: string): boolean {
  try {
    const cfg = readJSON<{ openwolf?: { buglog?: { auto_detect?: boolean } } }>(
      path.join(wolfDir, "config.json"),
      {}
    )
    // Default on; only an explicit `false` disables auto bug detection.
    return cfg.openwolf?.buglog?.auto_detect !== false
  } catch {
    return true
  }
}

export function autoDetectBugFix(wolfDir: string, absolutePath: string, projectRoot: string, oldStr: string, newStr: string): void {
  const basename = path.basename(absolutePath)
  const ext = path.extname(basename).toLowerCase()

  // Bug-fix detection is a code concept — never fire on prose/docs/data files.
  if (NON_CODE_EXTS.has(ext)) return
  // Respect an explicit opt-out in .wolf/config.json (default: enabled).
  if (!bugAutoDetectEnabled(wolfDir)) return

  const bugLogPath = path.join(wolfDir, "buglog.json")
  const bugLog = readJSON<{ version: number; bugs: Array<{ id: string; timestamp: string; error_message: string; file: string; root_cause: string; fix: string; tags: string[]; related_bugs: string[]; occurrences: number; last_seen: string }> }>(bugLogPath, { version: 1, bugs: [] })
  const relFile = normalizePath(path.relative(projectRoot, absolutePath))

  const detection = detectFixPattern(oldStr, newStr, ext, basename)
  if (!detection) return

  const recentDupe = bugLog.bugs.find(b => {
    if (path.basename(b.file) !== basename) return false
    if (!b.tags.includes("auto-detected")) return false
    if (!b.tags.includes(detection.category)) return false
    const bugTime = new Date(b.last_seen).getTime()
    return (Date.now() - bugTime) < 5 * 60 * 1000
  })

  if (recentDupe) {
    recentDupe.occurrences++
    recentDupe.last_seen = new Date().toISOString()
    if (detection.context && !recentDupe.fix.includes(detection.context)) {
      recentDupe.fix += ` | Also: ${detection.context}`
    }
    writeJSON(bugLogPath, bugLog)
    return
  }

  const nextId = `bug-${String(bugLog.bugs.length + 1).padStart(3, "0")}`
  bugLog.bugs.push({
    id: nextId,
    timestamp: new Date().toISOString(),
    error_message: detection.summary,
    file: relFile,
    root_cause: detection.rootCause,
    fix: detection.fix,
    tags: ["auto-detected", detection.category, ext.replace(".", "") || "unknown"],
    related_bugs: [],
    occurrences: 1,
    last_seen: new Date().toISOString(),
  })
  writeJSON(bugLogPath, bugLog)
}

export function detectFixPattern(oldStr: string, newStr: string, ext: string, basename: string): FixDetection | null {
  const oldLines = oldStr.split("\n")
  const newLines = newStr.split("\n")

  if (newStr.includes("catch") && !oldStr.includes("catch")) {
    const fn = newStr.match(/(?:function|def|async)\s+(\w+)/)?.[1] || "unknown"
    return { category: "error-handling", summary: `Missing error handling in ${fn}`, rootCause: "Code path had no error handling", fix: "Added try/catch block", context: extractChangedLines(oldStr, newStr) }
  }

  if ((newStr.includes("?.") && !oldStr.includes("?.")) || (newStr.includes("?? ") && !oldStr.includes("?? "))) {
    return { category: "null-safety", summary: `Null/undefined access in ${basename}`, rootCause: "Property access on potentially null/undefined value", fix: "Added null safety", context: extractChangedLines(oldStr, newStr) }
  }

  if (/if\s*\([^)]*\)\s*(return|throw|continue|break)/.test(newStr) && !/if\s*\([^)]*\)\s*(return|throw|continue|break)/.test(oldStr)) {
    const condition = newStr.match(/if\s*\(([^)]+)\)/)?.[1]?.trim().slice(0, 60) || "condition"
    return { category: "guard-clause", summary: "Missing guard clause", rootCause: `No early return for: ${condition}`, fix: `Added guard clause: if (${condition.slice(0, 40)})` }
  }

  if (oldLines.length <= 3 && newLines.length <= 3) {
    const oStrs = oldStr.trim().match(/['"`]([^'"`]{2,})['"`]/g) || []
    const nStrs = newStr.trim().match(/['"`]([^'"`]{2,})['"`]/g) || []
    if (oStrs.length > 0 && nStrs.length > 0) {
      for (let i = 0; i < Math.min(oStrs.length, nStrs.length); i++) {
        if (oStrs[i] !== nStrs[i]) {
          return { category: "wrong-value", summary: "Incorrect value in code", rootCause: `Had ${oStrs[i].slice(0, 50)}`, fix: `Changed to ${nStrs[i].slice(0, 50)}` }
        }
      }
    }
  }

  if (newStr.includes("await ") && !oldStr.includes("await ")) {
    return { category: "async-fix", summary: "Missing await", rootCause: "Async call without await", fix: "Added await to async call", context: extractChangedLines(oldStr, newStr) }
  }

  return null
}

function extractChangedLines(oldStr: string, newStr: string): string {
  const oldLines = new Set(oldStr.split("\n").map(l => l.trim()).filter(Boolean))
  const added = newStr.split("\n").map(l => l.trim()).filter(l => l && !oldLines.has(l))
  return added.slice(0, 2).map(l => l.slice(0, 60)).join("; ")
}
