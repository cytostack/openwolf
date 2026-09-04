import type { RealUsage } from "./shared.js";

// ─────────────────────────────────────────────────────────────────────────────
// Pure token-ledger math: types, folds, lifetime derivation, migrations.
// Deliberately free of value imports so tests (and any consumer) can load it
// straight from source under Node's type stripping. IO and session assembly
// live in ledger.ts.
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_LEDGER_SESSIONS = 200;

export interface SessionFileRead {
  count: number;
  tokens: number;
  first_read: string;
  read_mtime?: number;
  anatomy_hit?: boolean;
}

export interface SessionData {
  session_id: string;
  started: string;
  files_read: Record<string, SessionFileRead>;
  files_written: Array<{ file: string; action: string; tokens: number; at: string }>;
  edit_counts: Record<string, number>;
  anatomy_hits: number;
  anatomy_misses: number;
  repeated_reads_warned: number;
  reads_denied?: number;
  denied_tokens_saved?: number;
  stop_count: number;
  reminders_sent: Record<string, number>;
  pending_reminders?: string[];
  injected_tokens_estimated?: number;
  injected_by_source?: Record<string, number>;
  bash_governed?: Array<{ family: string; action: string; original_tokens: number; entered_tokens: number; at: string }>;
  [key: string]: unknown;
}

export interface FamilyTotals {
  calls: number;
  original_tokens: number;
  entered_tokens: number;
}

/** Sum of two per-key maps, used for both family and per-model rollups. */
export function foldMap<T extends object>(
  target: Record<string, T>,
  source: Record<string, T> | undefined
): void {
  for (const [key, value] of Object.entries(source ?? {})) {
    if (!value || typeof value !== "object") continue;
    const bucket = (target[key] ??= {} as T);
    for (const [field, n] of Object.entries(value)) {
      if (typeof n !== "number" || !isFinite(n)) continue;
      (bucket as Record<string, number>)[field] = ((bucket as Record<string, number>)[field] ?? 0) + n;
    }
  }
}

export interface SessionEntry {
  id: string;
  agent: string;
  started: string;
  ended: string;
  reads: Array<{
    file: string;
    tokens_estimated: number;
    was_repeated: boolean;
    anatomy_had_description: boolean;
  }>;
  writes: Array<{ file: string; tokens_estimated: number; action: string }>;
  totals: {
    input_tokens_estimated: number;
    output_tokens_estimated: number;
    reads_count: number;
    writes_count: number;
    repeated_reads_blocked: number;
    repeated_reads_warned?: number;
    anatomy_lookups: number;
    anatomy_misses?: number;
    savings_estimated?: number;
    /** Tokens OpenWolf itself injected into context (digests, hints, warnings). */
    injection_tokens_estimated?: number;
    /** Bash governor (2.3): original size of governed outputs vs what entered. */
    bash_governed_original_tokens?: number;
    bash_governed_entered_tokens?: number;
    bash_governed_calls?: number;
    /** Per-command-family governor breakdown (2.5). The scalars above cannot
     * answer "which families are actually paying off" — the classifier
     * already knows the family at the rewrite point, so keep it. */
    bash_governed_by_family?: Record<string, FamilyTotals>;
    /** Tokens the agent spent reading .wolf/ state itself (2.4). */
    wolf_internal_tokens?: number;
  };
  injected_by_source?: Record<string, number>;
  real_usage?: RealUsage;
  /** Transcript-verified hook activity (2.2). Absent = verification
   * unavailable (old transcript, format drift, or non-Claude agent); the
   * self-reported totals are then estimates, not facts. */
  verified?: {
    hooks_fired: number;
    hooks_failed: number;
    injections_delivered: number;
    injection_tokens_delivered: number;
    per_hook: Record<string, { fired: number; failed: number; last_exit: number }>;
    last_failure?: { hook: string; stderr_head: string };
  };
}

export interface LifetimeTotals {
  total_tokens_estimated: number;
  total_reads: number;
  total_writes: number;
  total_sessions: number;
  anatomy_hits: number;
  anatomy_misses: number;
  repeated_reads_blocked: number;
  repeated_reads_warned: number;
  estimated_savings_vs_bare_cli: number;
  injection_tokens_estimated: number;
  [key: string]: number;
}

export interface LifetimeMaps {
  /** Governor deltas per command family, lifetime. */
  bash_governed_by_family: Record<string, FamilyTotals>;
  /** Measured usage per model id, lifetime. Drives the cost figure. */
  real_by_model: Record<string, ModelUsage>;
}

export interface ModelUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  api_calls: number;
}

export interface LedgerData {
  version: number;
  created_at: string;
  lifetime: LifetimeTotals;
  /** Totals folded out of sessions that were rolled off the retained window. */
  lifetime_baseline?: Partial<LifetimeTotals>;
  /** Lifetime per-key rollups. Kept out of LifetimeTotals, whose index
   * signature is number, and out of lifetime_baseline, which numericFields()
   * strips down to scalars on every trim. */
  lifetime_maps?: LifetimeMaps;
  lifetime_baseline_maps?: LifetimeMaps;
  sessions: SessionEntry[];
  [key: string]: unknown;
}

export function emptyLedger(): LedgerData {
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
  };
}

/** The totals block of a session entry, derived from live session state. */
export function buildSessionTotals(
  session: SessionData,
  reads: SessionEntry["reads"],
  writes: SessionEntry["writes"]
): SessionEntry["totals"] {
  return {
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
    // The other side of the scale: what OpenWolf's own context injection cost.
    injection_tokens_estimated: session.injected_tokens_estimated ?? 0,
    // Bash governor deltas: original-vs-entered is measured at the rewrite
    // point, which nothing else in the ecosystem can observe.
    bash_governed_calls: (session.bash_governed ?? []).length || undefined,
    bash_governed_original_tokens: sumBy(session.bash_governed, (g) => g.original_tokens),
    bash_governed_entered_tokens: sumBy(session.bash_governed, (g) => g.entered_tokens),
    bash_governed_by_family: byFamily(session.bash_governed),
    wolf_internal_tokens: typeof session.wolf_internal_tokens === "number" ? session.wolf_internal_tokens : undefined,
  };
}

/**
 * Group the session's governed calls by command family. The session file keeps
 * only the last 200 records, so this is computed at flush time while they are
 * still there; the ledger then carries the rollup forever.
 */
function byFamily(
  governed: SessionData["bash_governed"]
): Record<string, FamilyTotals> | undefined {
  if (!governed || governed.length === 0) return undefined;
  const out: Record<string, FamilyTotals> = {};
  for (const g of governed) {
    const key = typeof g.family === "string" && g.family ? g.family : "other";
    const bucket = (out[key] ??= { calls: 0, original_tokens: 0, entered_tokens: 0 });
    bucket.calls++;
    if (isFinite(g.original_tokens)) bucket.original_tokens += g.original_tokens;
    if (isFinite(g.entered_tokens)) bucket.entered_tokens += g.entered_tokens;
  }
  return out;
}

function sumBy<T>(arr: T[] | undefined, fn: (item: T) => number): number | undefined {
  if (!arr || arr.length === 0) return undefined;
  return arr.reduce((sum, item) => sum + fn(item), 0);
}

/**
 * Position-weighted context cost (2.2). Fresh input is ~0.004% of a session's
 * input-side tokens; the real cost of a byte is that it sits in the cached
 * prefix and is re-read at the cache-read rate on EVERY subsequent API call:
 *   cost = tokens x (total_calls - call_index) x rate_per_token
 * A 10k-token read at call 500 of 1,458 costs ~$2.87 (Sonnet-class rates);
 * the same read at call 1,450 costs ~$0.02. Waste rankings must use this,
 * not raw token counts.
 */
export function positionWeightedCostUsd(
  tokens: number,
  callIndex: number,
  totalCalls: number,
  cacheReadUsdPerMTok: number
): number {
  const remaining = Math.max(0, totalCalls - callIndex);
  return (tokens * remaining * cacheReadUsdPerMTok) / 1_000_000;
}

export function addInto(target: Record<string, number>, key: string, value: number | undefined): void {
  if (typeof value !== "number" || !isFinite(value)) return;
  target[key] = (target[key] ?? 0) + value;
}

/** Copy only real numeric fields out of a possibly-partial totals object. */
export function numericFields(source: Record<string, number | undefined> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(source ?? {})) {
    if (typeof v === "number" && isFinite(v)) out[k] = v;
  }
  return out;
}

/**
 * Fold one session's per-key rollups into a LifetimeMaps accumulator. Kept
 * separate from foldEntry because those maps cannot live in the scalar
 * accumulator that numericFields() produces.
 */
export function emptyMaps(): LifetimeMaps {
  return { bash_governed_by_family: {}, real_by_model: {} };
}

export function foldEntryMaps(acc: LifetimeMaps, e: SessionEntry): void {
  foldMap(acc.bash_governed_by_family, e.totals?.bash_governed_by_family);
  foldMap(acc.real_by_model, e.real_usage?.per_model as Record<string, ModelUsage> | undefined);
}

export function foldEntry(acc: Record<string, number>, e: SessionEntry): void {
  addInto(acc, "total_tokens_estimated", e.totals.input_tokens_estimated + e.totals.output_tokens_estimated);
  addInto(acc, "total_reads", e.totals.reads_count);
  addInto(acc, "total_writes", e.totals.writes_count);
  addInto(acc, "anatomy_hits", e.totals.anatomy_lookups);
  addInto(acc, "anatomy_misses", e.totals.anatomy_misses);
  addInto(acc, "repeated_reads_blocked", e.totals.repeated_reads_blocked);
  addInto(acc, "repeated_reads_warned", e.totals.repeated_reads_warned);
  addInto(acc, "estimated_savings_vs_bare_cli", e.totals.savings_estimated);
  addInto(acc, "injection_tokens_estimated", e.totals.injection_tokens_estimated);
  addInto(acc, "bash_governed_calls", e.totals.bash_governed_calls);
  addInto(acc, "bash_governed_original_tokens", e.totals.bash_governed_original_tokens);
  addInto(acc, "bash_governed_entered_tokens", e.totals.bash_governed_entered_tokens);
  addInto(acc, "wolf_internal_tokens", e.totals.wolf_internal_tokens);
  if (e.real_usage) {
    addInto(acc, "real_input_tokens", e.real_usage.input_tokens);
    addInto(acc, "real_output_tokens", e.real_usage.output_tokens);
    addInto(acc, "real_cache_read_tokens", e.real_usage.cache_read_input_tokens);
    addInto(acc, "real_cache_creation_tokens", e.real_usage.cache_creation_input_tokens);
    addInto(acc, "real_api_calls", e.real_usage.api_calls);
  }
}

/**
 * Derive lifetime = baseline + fold(sessions). total_sessions is intentionally
 * NOT derived here — session-start counts it once per new session.
 */
export function recomputeLifetime(ledger: LedgerData): void {
  const acc = numericFields(ledger.lifetime_baseline);
  delete acc.total_sessions;
  const maps = emptyMaps();
  foldMap(maps.bash_governed_by_family, ledger.lifetime_baseline_maps?.bash_governed_by_family);
  foldMap(maps.real_by_model, ledger.lifetime_baseline_maps?.real_by_model);
  for (const e of ledger.sessions) {
    foldEntry(acc, e);
    foldEntryMaps(maps, e);
  }
  ledger.lifetime_maps = maps;
  const totalSessions = ledger.lifetime?.total_sessions ?? 0;
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
  } as LifetimeTotals;
}

/**
 * One-time legacy migration: sessions written before 2.0.5 stored the number
 * of duplicate-read WARNINGS in totals.repeated_reads_blocked (the field
 * predates deny mode). Under the current semantics a blocked read always
 * credits savings_estimated > 0 (a denial saves the previous read's tokens,
 * and denyEligible requires tokens > 0), so blocked > 0 with zero savings can
 * only be legacy data. Move those counts to repeated_reads_warned and zero
 * the blocked field. Also migrates the lifetime_baseline, which may hold
 * folded-off legacy sessions. Returns the number of records rewritten.
 * Caller is responsible for recomputeLifetime() and persisting.
 */
export function migrateLegacyBlockedCounts(ledger: LedgerData): number {
  let migrated = 0;
  for (const s of ledger.sessions ?? []) {
    const t = s?.totals;
    if (!t) continue;
    if ((t.repeated_reads_blocked ?? 0) > 0 && !((t.savings_estimated ?? 0) > 0)) {
      t.repeated_reads_warned = (t.repeated_reads_warned ?? 0) + t.repeated_reads_blocked;
      t.repeated_reads_blocked = 0;
      migrated++;
    }
  }
  const base = ledger.lifetime_baseline;
  if (
    base &&
    (base.repeated_reads_blocked ?? 0) > 0 &&
    !((base.estimated_savings_vs_bare_cli ?? 0) > 0)
  ) {
    base.repeated_reads_warned = (base.repeated_reads_warned ?? 0) + (base.repeated_reads_blocked ?? 0);
    base.repeated_reads_blocked = 0;
    migrated++;
  }
  return migrated;
}
