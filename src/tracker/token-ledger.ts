import * as path from "node:path";
import { readJSON, writeJSON } from "../utils/fs-safe.js";

interface ReadEntry {
  file: string;
  tokens_estimated: number;
  was_repeated: boolean;
  anatomy_had_description: boolean;
}

interface WriteEntry {
  file: string;
  tokens_estimated: number;
  action: string;
}

interface SessionTotals {
  input_tokens_estimated: number;
  output_tokens_estimated: number;
  reads_count: number;
  writes_count: number;
  repeated_reads_blocked: number;
  anatomy_lookups: number;
  recurrences: number;
  negative_writes: number;
}

interface SessionEntry {
  id: string;
  started: string;
  ended: string;
  reads: ReadEntry[];
  writes: WriteEntry[];
  totals: SessionTotals;
}

interface Lifetime {
  total_tokens_estimated: number;
  total_reads: number;
  total_writes: number;
  total_sessions: number;
  anatomy_hits: number;
  anatomy_misses: number;
  repeated_reads_blocked: number;
  estimated_savings_vs_bare_cli: number;
  recurrences: number;
  negative_writes: number;
}

interface TokenLedger {
  version: number;
  created_at: string;
  lifetime: Lifetime;
  sessions: SessionEntry[];
  daemon_usage: unknown[];
  waste_flags: unknown[];
  optimization_report: {
    last_generated: string | null;
    patterns: unknown[];
  };
}

export function getLedgerPath(wolfDir: string): string {
  return path.join(wolfDir, "token-ledger.json");
}

export function readLedger(wolfDir: string): TokenLedger {
  return readJSON<TokenLedger>(getLedgerPath(wolfDir), {
    version: 1,
    created_at: new Date().toISOString(),
    lifetime: {
      total_tokens_estimated: 0,
      total_reads: 0,
      total_writes: 0,
      total_sessions: 0,
      anatomy_hits: 0,
      anatomy_misses: 0,
      repeated_reads_blocked: 0,
      estimated_savings_vs_bare_cli: 0,
      recurrences: 0,
      negative_writes: 0,
    },
    sessions: [],
    daemon_usage: [],
    waste_flags: [],
    optimization_report: { last_generated: null, patterns: [] },
  });
}

export function writeLedger(wolfDir: string, ledger: TokenLedger): void {
  writeJSON(getLedgerPath(wolfDir), ledger);
}

export function incrementSessions(wolfDir: string): void {
  const ledger = readLedger(wolfDir);
  ledger.lifetime.total_sessions++;
  writeLedger(wolfDir, ledger);
}

export function addSessionToLedger(
  wolfDir: string,
  session: SessionEntry
): void {
  const ledger = readLedger(wolfDir);
  ledger.sessions.push(session);
  ledger.lifetime.total_reads += session.totals.reads_count;
  ledger.lifetime.total_writes += session.totals.writes_count;
  ledger.lifetime.total_tokens_estimated +=
    session.totals.input_tokens_estimated + session.totals.output_tokens_estimated;
  ledger.lifetime.anatomy_hits += session.totals.anatomy_lookups;
  ledger.lifetime.repeated_reads_blocked += session.totals.repeated_reads_blocked;
  ledger.lifetime.recurrences += session.totals.recurrences ?? 0;
  ledger.lifetime.negative_writes += session.totals.negative_writes ?? 0;
  writeLedger(wolfDir, ledger);
}
