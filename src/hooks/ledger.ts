import * as path from "node:path";
import { readJSON, writeJSON, readTranscriptUsage, detectAgent } from "./shared.js";
import { withFileLock, HOOK_LOCK_BUDGET_MS } from "./anatomy-lock.js";
import {
  MAX_LEDGER_SESSIONS,
  emptyLedger,
  buildSessionTotals,
  numericFields,
  foldEntry,
  foldEntryMaps,
  emptyMaps,
  recomputeLifetime,
  type SessionData,
  type SessionEntry,
  type LedgerData,
} from "./ledger-math.js";

// ─────────────────────────────────────────────────────────────────────────────
// Token-ledger writer shared by the Stop and SessionEnd hooks.
//
// Stop fires at the end of EVERY turn, so the ledger write must be idempotent:
// the session entry is UPSERTED by session id (replaced, never appended), and
// lifetime totals are derived — archived baseline + fold over the retained
// sessions — rather than incremented. The old increment-on-every-Stop scheme
// re-added turns 1..N on turn N, quadratically inflating every lifetime metric
// and duplicating session entries.
//
// The pure math (folds, lifetime derivation, migrations) lives in
// ledger-math.ts; this module owns IO and session-entry assembly.
// ─────────────────────────────────────────────────────────────────────────────

export * from "./ledger-math.js";

/** Build the ledger entry for the current session state (idempotent). */
export function buildSessionEntry(session: SessionData, transcriptPath?: string): SessionEntry {
  const reads = Object.entries(session.files_read).map(([file, data]) => ({
    file,
    tokens_estimated: data.tokens,
    was_repeated: data.count > 1,
    anatomy_had_description: data.anatomy_hit === true,
  }));

  const writes = session.files_written.map((w) => ({
    file: w.file,
    tokens_estimated: w.tokens,
    action: w.action,
  }));

  const entry: SessionEntry = {
    id: session.session_id,
    agent: detectAgent(),
    started: session.started,
    ended: new Date().toISOString(),
    reads,
    writes,
    totals: buildSessionTotals(session, reads, writes),
  };

  if (session.injected_by_source && Object.keys(session.injected_by_source).length > 0) {
    entry.injected_by_source = { ...session.injected_by_source };
  }

  if (transcriptPath) {
    // readTranscriptUsage dedupes by message id, so this is the cumulative
    // total for the whole session — correct to REPLACE, never to add.
    const real = readTranscriptUsage(transcriptPath);
    if (real) entry.real_usage = real;
  }

  return entry;
}

/** Upsert the entry, roll old sessions into the baseline, derive lifetime. */
export function flushSessionToLedger(wolfDir: string, entry: SessionEntry): void {
  if (!entry.id) return;
  const ledgerPath = path.join(wolfDir, "token-ledger.json");
  // Locked read-modify-write: the daemon's report generator writes this file
  // too, and an unlocked interleave dropped whole sessions. On contention we
  // skip — the upsert is idempotent, so the next Stop converges the state.
  withFileLock(ledgerPath + ".lock", HOOK_LOCK_BUDGET_MS, () => {
    const ledger = readJSON<LedgerData>(ledgerPath, emptyLedger());
    if (!Array.isArray(ledger.sessions)) ledger.sessions = [];

    const idx = ledger.sessions.findIndex((s) => s && s.id === entry.id);
    if (idx >= 0) ledger.sessions[idx] = entry;
    else ledger.sessions.push(entry);

    while (ledger.sessions.length > MAX_LEDGER_SESSIONS) {
      const oldest = ledger.sessions.shift()!;
      const baseline = numericFields(ledger.lifetime_baseline);
      foldEntry(baseline, oldest);
      ledger.lifetime_baseline = baseline;
      // The per-family and per-model rollups have to be folded off separately:
      // numericFields() keeps scalars only, so a map left in lifetime_baseline
      // would be silently dropped the first time a session rolled off.
      const baselineMaps = ledger.lifetime_baseline_maps ?? emptyMaps();
      foldEntryMaps(baselineMaps, oldest);
      ledger.lifetime_baseline_maps = baselineMaps;
    }

    recomputeLifetime(ledger);
    writeJSON(ledgerPath, ledger);
  });
}
