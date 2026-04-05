import * as fs from "node:fs"
import * as path from "node:path"
import * as crypto from "node:crypto"
import { getWolfDir, writeJSON, readJSON, appendMarkdown, timeShort, normalizePath, estimateTokens } from "./fs.js"
import { parseAnatomy, serializeAnatomy, extractDescription } from "./anatomy.js"
import type { PartialSessionState, FixDetection } from "./types.js"

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

  const hooksDir = path.join(wolfDir, "hooks")
  const sessionFile = path.join(hooksDir, "_session.json")
  const projectRoot = directory

  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(projectRoot, filePath)
  const relPath = normalizePath(path.relative(projectRoot, absolutePath))
  if (relPath.startsWith(".wolf/")) return

  const baseName = path.basename(absolutePath)
  if (baseName === ".env" || baseName.startsWith(".env.")) return

  updateAnatomy(wolfDir, absolutePath, projectRoot, content)
  appendToMemory(wolfDir, toolName, absolutePath, projectRoot, content, newStr)
  trackSession(wolfDir, sessionFile, filePath, toolName, content, newStr, baseName)
  
  if (oldStr && newStr) {
    autoDetectBugFix(wolfDir, absolutePath, projectRoot, oldStr, newStr)
  }
}

function updateAnatomy(wolfDir: string, absolutePath: string, projectRoot: string, content: string): void {
  try {
    const anatomyPath = path.join(wolfDir, "anatomy.md")
    let anatomyContent: string
    try {
      anatomyContent = fs.readFileSync(anatomyPath, "utf-8")
    } catch {
      anatomyContent = "# anatomy.md\n\n> Auto-maintained by OpenWolf.\n"
    }

    const sections = parseAnatomy(anatomyContent)
    const relPathLocal = normalizePath(path.relative(projectRoot, absolutePath))
    const dir = path.dirname(relPathLocal)
    const fileName = path.basename(relPathLocal)
    const sectionKey = dir === "." ? "./" : dir + "/"

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

    if (!sections.has(sectionKey)) sections.set(sectionKey, [])
    const entries = sections.get(sectionKey)!
    const idx = entries.findIndex((e) => e.file === fileName)
    if (idx !== -1) {
      entries[idx] = { file: fileName, description: desc, tokens }
    } else {
      entries.push({ file: fileName, description: desc, tokens })
    }

    let fileCount = 0
    for (const [, list] of sections) fileCount += list.length

    const serialized = serializeAnatomy(sections, {
      lastScanned: new Date().toISOString(),
      fileCount,
      hits: 0,
      misses: 0,
    })

    const tmp = anatomyPath + "." + crypto.randomBytes(4).toString("hex") + ".tmp"
    try {
      fs.writeFileSync(tmp, serialized, "utf-8")
      fs.renameSync(tmp, anatomyPath)
    } catch {
      try { fs.writeFileSync(anatomyPath, serialized, "utf-8") } catch {}
      try { fs.unlinkSync(tmp) } catch {}
    }
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
  wolfDir: string,
  sessionFile: string,
  filePath: string,
  toolName: string,
  content: string,
  newStr: string,
  baseName: string
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

    const editKey = normalizePath(path.relative(wolfDir.replace("/.wolf", ""), path.join(wolfDir.replace("/.wolf", ""), filePath)))
    session.edit_counts![editKey] = (session.edit_counts![editKey] || 0) + 1

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

export function autoDetectBugFix(wolfDir: string, absolutePath: string, projectRoot: string, oldStr: string, newStr: string): void {
  const bugLogPath = path.join(wolfDir, "buglog.json")
  const bugLog = readJSON<{ version: number; bugs: Array<{ id: string; timestamp: string; error_message: string; file: string; root_cause: string; fix: string; tags: string[]; related_bugs: string[]; occurrences: number; last_seen: string }> }>(bugLogPath, { version: 1, bugs: [] })
  const relFile = normalizePath(path.relative(projectRoot, absolutePath))
  const basename = path.basename(absolutePath)
  const ext = path.extname(basename).toLowerCase()

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