import * as fs from "node:fs"
import * as path from "node:path"
import { getWolfDir, writeJSON, readJSON, appendMarkdown, timeShort } from "./fs.js"
import type { SessionState } from "./types.js"

export function handleStop(directory: string, sessionId: string): void {
  const wolfDir = getWolfDir(directory)
  if (!fs.existsSync(wolfDir)) return

  const hooksDir = path.join(wolfDir, "hooks")
  const sessionFile = path.join(hooksDir, "_session.json")

  const session = readJSON<SessionState>(sessionFile, {
    session_id: "", started: "", files_read: {}, files_written: [],
    edit_counts: {}, anatomy_hits: 0, anatomy_misses: 0,
    repeated_reads_warned: 0, cerebrum_warnings: 0, stop_count: 0,
  })

  session.stop_count++

  const readCount = Object.keys(session.files_read).length
  const writeCount = session.files_written.length

  if (readCount === 0 && writeCount === 0) {
    writeJSON(sessionFile, session)
    return
  }

  checkForMissingBugLogs(session)
  buildLedgerEntry(wolfDir, session)
  appendSessionSummary(wolfDir, session, readCount, writeCount)

  writeJSON(sessionFile, session)
}

function checkForMissingBugLogs(session: SessionState): void {
  if (!session.edit_counts) return

  const multiEditFiles = Object.entries(session.edit_counts)
    .filter(([, count]) => count >= 3)
    .map(([file]) => path.basename(file))

  if (multiEditFiles.length > 0) {
    const buglogWritten = session.files_written.some(w => w.file.includes("buglog.json"))
    if (!buglogWritten) {
      console.warn(`⚠️ OpenWolf: Files edited 3+ times this session (${multiEditFiles.join(", ")}) but buglog.json was not updated. If you fixed bugs, please log them.`)
    }
  }
}

function buildLedgerEntry(wolfDir: string, session: SessionState): void {
  const readCount = Object.keys(session.files_read).length
  const writeCount = session.files_written.length

  const reads = Object.entries(session.files_read).map(([file, data]) => ({
    file,
    tokens_estimated: data.tokens,
    was_repeated: data.count > 1,
    anatomy_had_description: false,
  }))

  const writes = session.files_written.map((w) => ({
    file: w.file,
    tokens_estimated: w.tokens,
    action: w.action,
  }))

  const inputTokens = reads.reduce((sum, r) => sum + r.tokens_estimated, 0)
  const outputTokens = writes.reduce((sum, w) => sum + w.tokens_estimated, 0)

  const ledgerPath = path.join(wolfDir, "token-ledger.json")
  const ledger = readJSON<Record<string, unknown>>(ledgerPath, {
    version: 1, created_at: "", lifetime: { total_tokens_estimated: 0, total_reads: 0, total_writes: 0, total_sessions: 0, anatomy_hits: 0, anatomy_misses: 0, repeated_reads_blocked: 0, estimated_savings_vs_bare_cli: 0 },
    sessions: [] as Array<{ id: string; started: string; ended: string; reads: unknown[]; writes: unknown[]; totals: Record<string, number> }>,
    daemon_usage: [], waste_flags: [], optimization_report: { last_generated: null, patterns: [] },
  }) as {
    version: number
    lifetime: Record<string, number>
    sessions: Array<{ id: string; started: string; ended: string; reads: unknown[]; writes: unknown[]; totals: Record<string, number> }>
    [key: string]: unknown
  }

  ledger.sessions.push({
    id: session.session_id,
    started: session.started,
    ended: new Date().toISOString(),
    reads,
    writes,
    totals: {
      input_tokens_estimated: inputTokens,
      output_tokens_estimated: outputTokens,
      reads_count: readCount,
      writes_count: writeCount,
      repeated_reads_blocked: session.repeated_reads_warned,
      anatomy_lookups: session.anatomy_hits,
    },
  })

  ledger.lifetime.total_reads += readCount
  ledger.lifetime.total_writes += writeCount
  ledger.lifetime.total_tokens_estimated += inputTokens + outputTokens
  ledger.lifetime.anatomy_hits += session.anatomy_hits
  ledger.lifetime.anatomy_misses += session.anatomy_misses
  ledger.lifetime.repeated_reads_blocked += session.repeated_reads_warned

  const savedFromAnatomy = session.anatomy_hits * 200
  const savedFromRepeats = Object.values(session.files_read)
    .filter((r) => r.count > 1)
    .reduce((sum, r) => sum + r.tokens * (r.count - 1), 0)
  ledger.lifetime.estimated_savings_vs_bare_cli += savedFromAnatomy + savedFromRepeats

  writeJSON(ledgerPath, ledger)
}

function appendSessionSummary(wolfDir: string, session: SessionState, readCount: number, writeCount: number): void {
  if (writeCount > 0) {
    try {
      const inputTokens = Object.values(session.files_read).reduce((sum, r) => sum + r.tokens, 0)
      const outputTokens = session.files_written.reduce((sum, w) => sum + w.tokens, 0)
      const uniqueFiles = new Set(session.files_written.map(w => path.basename(w.file)))
      const fileList = [...uniqueFiles].slice(0, 5).join(", ")
      const memoryPath = path.join(wolfDir, "memory.md")
      appendMarkdown(memoryPath, `| ${timeShort()} | Session end: ${writeCount} writes across ${uniqueFiles.size} files (${fileList}) | ${readCount} reads | ~${inputTokens + outputTokens} tok |\n`)
    } catch {}
  }
}