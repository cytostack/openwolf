import * as fs from "node:fs"
import * as path from "node:path"
import { getWolfDir, writeJSON, readJSON, appendMarkdown, timeShort, timestamp, readMarkdown } from "./fs.js"
import type { SessionState } from "./types.js"

const sessions = new Map<string, SessionState>()

export function getSessionState(sessionId: string): SessionState | undefined {
  return sessions.get(sessionId)
}

export function setSessionState(sessionId: string, state: SessionState): void {
  sessions.set(sessionId, state)
}

export function deleteSession(sessionId: string): void {
  sessions.delete(sessionId)
}

export function handleSessionStart(directory: string, sessionId: string): void {
  const wolfDir = getWolfDir(directory)
  if (!fs.existsSync(wolfDir)) return

  const hooksDir = path.join(wolfDir, "hooks")
  fs.mkdirSync(hooksDir, { recursive: true })

  try {
    const files = fs.readdirSync(wolfDir)
    for (const f of files) {
      if (f.endsWith(".tmp")) {
        try { fs.unlinkSync(path.join(wolfDir, f)) } catch {}
      }
    }
  } catch {}

  const sessionFile = path.join(hooksDir, "_session.json")
  const state: SessionState = {
    session_id: sessionId,
    started: timestamp(),
    files_read: {},
    files_written: [],
    edit_counts: {},
    anatomy_hits: 0,
    anatomy_misses: 0,
    repeated_reads_warned: 0,
    cerebrum_warnings: 0,
    stop_count: 0,
  }
  sessions.set(sessionId, state)
  writeJSON(sessionFile, state)

  const memoryPath = path.join(wolfDir, "memory.md")
  const now = new Date()
  const header = `\n## Session: ${now.toISOString().slice(0, 10)} ${timeShort()}\n\n| Time | Action | File(s) | Outcome | ~Tokens |\n|------|--------|---------|---------|--------|\n`
  appendMarkdown(memoryPath, header)

  try {
    const cerebrumPath = path.join(wolfDir, "cerebrum.md")
    const cerebrumContent = fs.readFileSync(cerebrumPath, "utf-8")
    const stat = fs.statSync(cerebrumPath)
    const daysSinceUpdate = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24)
    const entryLines = cerebrumContent.split("\n").filter(l => {
      const t = l.trim()
      return t.startsWith("- ") || t.startsWith("* ") || (t.startsWith("[") && t.includes("]"))
    })
    if (entryLines.length < 3) {
      console.warn(`💡 OpenWolf: cerebrum.md has only ${entryLines.length} entries. Learn from this session — record user preferences, project conventions, and mistakes to .wolf/cerebrum.md.`)
    } else if (daysSinceUpdate > 3) {
      console.warn(`💡 OpenWolf: cerebrum.md hasn't been updated in ${Math.floor(daysSinceUpdate)} days. Look for opportunities to add learnings this session.`)
    }
  } catch {}

  try {
    const buglogPath = path.join(wolfDir, "buglog.json")
    const buglog = readJSON<{ bugs: unknown[] }>(buglogPath, { bugs: [] })
    if (buglog.bugs.length === 0) {
      console.warn(`📋 OpenWolf: buglog.json is empty. If you encounter or fix any bugs, errors, or failed tests this session, log them to .wolf/buglog.json.`)
    }
  } catch {}

  const ledgerPath = path.join(wolfDir, "token-ledger.json")
  const ledger = readJSON<Record<string, unknown>>(ledgerPath, { version: 1, lifetime: { total_sessions: 0 } }) as {
    version: number
    lifetime: { total_sessions: number }
    [key: string]: unknown
  }
  ledger.lifetime.total_sessions++
  writeJSON(ledgerPath, ledger)
}