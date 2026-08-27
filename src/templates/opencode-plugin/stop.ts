import * as fs from "node:fs"
import * as path from "node:path"
import { getWolfDir, getSessionFilePath, writeJSON, readJSON, appendMarkdown, timeShort } from "./fs.js"
import type { SessionState } from "./types.js"

// ─────────────────────────────────────────────────────────────────────────────
// Token-ledger writer (mirrors src/hooks/ledger.ts).
//
// Stop fires at the end of EVERY turn, so the ledger write must be idempotent:
// the session entry is UPSERTED by session id (replaced, never appended), and
// lifetime totals are derived — archived baseline + fold over the retained
// sessions — rather than incremented. The old increment-on-every-Stop scheme
// re-added turns 1..N on turn N, quadratically inflating every lifetime metric
// and duplicating session entries.
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_LEDGER_SESSIONS = 200

interface SessionEntry {
  id: string
  agent: string
  started: string
  ended: string
  reads: Array<{
    file: string
    tokens_estimated: number
    was_repeated: boolean
    anatomy_had_description: boolean
  }>
  writes: Array<{ file: string; tokens_estimated: number; action: string }>
  totals: {
    input_tokens_estimated: number
    output_tokens_estimated: number
    reads_count: number
    writes_count: number
    repeated_reads_blocked: number
    repeated_reads_warned?: number
    anatomy_lookups: number
    anatomy_misses?: number
    savings_estimated?: number
    injection_tokens_estimated?: number
  }
}

interface LifetimeTotals {
  total_tokens_estimated: number
  total_reads: number
  total_writes: number
  total_sessions: number
  anatomy_hits: number
  anatomy_misses: number
  repeated_reads_blocked: number
  repeated_reads_warned: number
  estimated_savings_vs_bare_cli: number
  injection_tokens_estimated: number
  [key: string]: number
}

interface LedgerData {
  version: number
  created_at: string
  lifetime: LifetimeTotals
  /** Totals folded out of sessions that were rolled off the retained window. */
  lifetime_baseline?: Partial<LifetimeTotals>
  sessions: SessionEntry[]
  [key: string]: unknown
}

function emptyLedger(): LedgerData {
  return {
    version: 1,
    created_at: "",
    lifetime: {
      total_tokens_estimated: 0,
      total_reads: 0,
      total_writes: 0,
      total_sessions: 0,
      anatomy_hits: 0,
      anatomy_misses: 0,
      repeated_reads_blocked: 0,
      repeated_reads_warned: 0,
      estimated_savings_vs_bare_cli: 0,
      injection_tokens_estimated: 0,
    },
    sessions: [],
    daemon_usage: [],
    waste_flags: [],
    optimization_report: { last_generated: null, patterns: [] },
  }
}

/** Build the ledger entry for the current session state (idempotent). */
function buildSessionEntry(session: SessionState): SessionEntry {
  const reads = Object.entries(session.files_read).map(([file, data]) => ({
    file,
    tokens_estimated: data.tokens,
    was_repeated: data.count > 1,
    anatomy_had_description: data.anatomy_hit === true,
  }))

  const writes = session.files_written.map((w) => ({
    file: w.file,
    tokens_estimated: w.tokens,
    action: w.action,
  }))

  return {
    id: session.session_id,
    agent: "opencode",
    started: session.started,
    ended: new Date().toISOString(),
    reads,
    writes,
    totals: {
      input_tokens_estimated: reads.reduce((sum, r) => sum + r.tokens_estimated, 0),
      output_tokens_estimated: writes.reduce((sum, w) => sum + w.tokens_estimated, 0),
      reads_count: reads.length,
      writes_count: writes.length,
      // Honest accounting: only reads the hook actually denied count as
      // blocked (warnings do not prevent the read from happening).
      repeated_reads_blocked: session.reads_denied ?? 0,
      repeated_reads_warned: session.repeated_reads_warned ?? 0,
      anatomy_lookups: session.anatomy_hits,
      anatomy_misses: session.anatomy_misses,
      // Honest savings: tokens of reads that were denied, nothing else.
      savings_estimated: session.denied_tokens_saved ?? 0,
      injection_tokens_estimated: session.injected_tokens_estimated ?? 0,
    },
  }
}

function addInto(target: Record<string, number>, key: string, value: number | undefined): void {
  if (typeof value !== "number" || !isFinite(value)) return
  target[key] = (target[key] ?? 0) + value
}

/** Copy only real numeric fields out of a possibly-partial totals object. */
function numericFields(source: Record<string, number | undefined> | undefined): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(source ?? {})) {
    if (typeof v === "number" && isFinite(v)) out[k] = v
  }
  return out
}

function foldEntry(acc: Record<string, number>, e: SessionEntry): void {
  addInto(acc, "total_tokens_estimated", e.totals.input_tokens_estimated + e.totals.output_tokens_estimated)
  addInto(acc, "total_reads", e.totals.reads_count)
  addInto(acc, "total_writes", e.totals.writes_count)
  addInto(acc, "anatomy_hits", e.totals.anatomy_lookups)
  addInto(acc, "anatomy_misses", e.totals.anatomy_misses)
  addInto(acc, "repeated_reads_blocked", e.totals.repeated_reads_blocked)
  addInto(acc, "repeated_reads_warned", e.totals.repeated_reads_warned)
  addInto(acc, "estimated_savings_vs_bare_cli", e.totals.savings_estimated)
  addInto(acc, "injection_tokens_estimated", e.totals.injection_tokens_estimated)
}

/**
 * Derive lifetime = baseline + fold(sessions). total_sessions is intentionally
 * NOT derived here — session start counts it once per new session.
 */
function recomputeLifetime(ledger: LedgerData): void {
  const acc = numericFields(ledger.lifetime_baseline)
  delete acc.total_sessions
  for (const e of ledger.sessions) foldEntry(acc, e)
  const totalSessions = ledger.lifetime?.total_sessions ?? 0
  ledger.lifetime = {
    total_tokens_estimated: 0,
    total_reads: 0,
    total_writes: 0,
    anatomy_hits: 0,
    anatomy_misses: 0,
    repeated_reads_blocked: 0,
    repeated_reads_warned: 0,
    estimated_savings_vs_bare_cli: 0,
    injection_tokens_estimated: 0,
    ...acc,
    total_sessions: totalSessions,
  } as LifetimeTotals
}

/** Upsert the entry, roll old sessions into the baseline, derive lifetime. */
function flushSessionToLedger(wolfDir: string, entry: SessionEntry): void {
  if (!entry.id) return
  const ledgerPath = path.join(wolfDir, "token-ledger.json")
  const ledger = readJSON<LedgerData>(ledgerPath, emptyLedger())
  if (!Array.isArray(ledger.sessions)) ledger.sessions = []

  const idx = ledger.sessions.findIndex((s) => s && s.id === entry.id)
  if (idx >= 0) ledger.sessions[idx] = entry
  else ledger.sessions.push(entry)

  while (ledger.sessions.length > MAX_LEDGER_SESSIONS) {
    const oldest = ledger.sessions.shift()!
    const baseline = numericFields(ledger.lifetime_baseline)
    foldEntry(baseline, oldest)
    ledger.lifetime_baseline = baseline
  }

  recomputeLifetime(ledger)
  writeJSON(ledgerPath, ledger)
}

export function handleStop(directory: string, sessionId: string): void {
  const wolfDir = getWolfDir(directory)
  if (!fs.existsSync(wolfDir)) return

  const sessionFile = getSessionFilePath(directory, sessionId)

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

  // Idempotent ledger write: the entry for this session id is REPLACED, not
  // appended — Stop fires every turn, and appending per turn is what used to
  // duplicate sessions and quadratically inflate lifetime totals.
  const entry = buildSessionEntry(session)
  flushSessionToLedger(wolfDir, entry)

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
