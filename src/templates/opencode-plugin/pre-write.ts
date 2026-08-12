import * as fs from "node:fs"
import * as path from "node:path"
import { getWolfDir, readMarkdown, normalizePath, readJSON } from "./fs.js"

const STOP_WORDS = new Set([
  "error", "function", "return", "const", "this", "that", "with", "from",
  "import", "export", "class", "interface", "type", "undefined", "null",
  "true", "false", "string", "number", "object", "array", "value",
  "file", "path", "name", "data", "response", "request", "result",
  "should", "must", "does", "have", "been", "will", "would", "could",
  "when", "then", "else", "each", "some", "every", "only",
])

function tokenize(text: string): Set<string> {
  return new Set(
    text.replace(/[^\w\s]/g, " ").split(/\s+/)
      .filter(w => w.length > 3 && !STOP_WORDS.has(w.toLowerCase()))
      .map(w => w.toLowerCase())
  )
}

export function handlePreWrite(directory: string, sessionId: string, filePath: string, content: string, oldStr: string, newStr: string): void {
  const wolfDir = getWolfDir(directory)
  if (!fs.existsSync(wolfDir)) return

  const allContent = [content, oldStr, newStr].join("\n")
  if (!allContent.trim()) return

  checkCerebrum(wolfDir, allContent)

  if (filePath && (oldStr || content)) {
    checkBugLog(wolfDir, filePath, oldStr, newStr, content)
  }
}

function checkCerebrum(wolfDir: string, content: string): void {
  const cerebrumContent = readMarkdown(path.join(wolfDir, "cerebrum.md"))
  const doNotRepeatSection = cerebrumContent.split("## Do-Not-Repeat")[1]
  if (!doNotRepeatSection) return

  const entries = doNotRepeatSection.split("## ")[0]
  const lines = entries.split("\n").filter((l) => l.trim().startsWith("[") || l.trim().startsWith("-"))
  for (const line of lines) {
    const trimmed = line.trim().replace(/^[-*]\s*/, "").replace(/^\[[\d-]+\]\s*/, "")
    if (!trimmed) continue
    const patterns: string[] = []
    const quotedMatches = trimmed.match(/"([^"]+)"/g) || trimmed.match(/'([^']+)'/g) || trimmed.match(/`([^`]+)`/g)
    if (quotedMatches) {
      for (const qm of quotedMatches) {
        patterns.push(qm.replace(/["'`]/g, ""))
      }
    }
    const neverMatch = trimmed.match(/(?:never use|avoid|don't use|do not use)\s+(\w+)/i)
    if (neverMatch) patterns.push(neverMatch[1])
    for (const pattern of patterns) {
      try {
        const regex = new RegExp(`\\b${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i")
        if (regex.test(content)) {
          console.warn(`⚠️ OpenWolf cerebrum warning: "${trimmed}" — check your code before proceeding.`)
        }
      } catch {}
    }
  }
}

interface BugEntry {
  id: string
  error_message: string
  root_cause: string
  fix: string
  file: string
  tags: string[]
}

function checkBugLog(wolfDir: string, filePath: string, oldStr: string, newStr: string, content: string): void {
  const bugLogPath = path.join(wolfDir, "buglog.json")
  if (!fs.existsSync(bugLogPath)) return

  const bugLog = readJSON<{ version: number; bugs: BugEntry[] }>(bugLogPath, { version: 1, bugs: [] })
  if (bugLog.bugs.length === 0) return

  const basename = path.basename(filePath)
  const fileMatches = bugLog.bugs.filter((b: BugEntry) => path.basename(b.file) === basename)
  if (fileMatches.length === 0) return

  const editText = (oldStr + " " + newStr + " " + content).toLowerCase()
  const editTokens = tokenize(editText)

  const relevant = fileMatches.filter((bug: BugEntry) => {
    const tagHit = bug.tags.some((t: string) => editText.includes(t.toLowerCase()))
    if (tagHit) return true
    const bugTokens = tokenize(bug.error_message + " " + bug.root_cause)
    const overlap = [...editTokens].filter(t => bugTokens.has(t))
    return overlap.length >= 3
  })

  if (relevant.length === 0) return

  console.warn(`📋 OpenWolf buglog: ${relevant.length} past bug(s) found for ${basename} — review for context, do NOT apply blindly:`)
  for (const bug of relevant.slice(0, 2)) {
    console.warn(`   [${bug.id}] "${bug.error_message.slice(0, 70)}"`)
    console.warn(`   Cause: ${bug.root_cause.slice(0, 80)}`)
    console.warn(`   Fix: ${bug.fix.slice(0, 80)}`)
  }
}