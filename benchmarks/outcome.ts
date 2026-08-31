import * as fs from "node:fs";
import * as path from "node:path";

export interface OutcomeResult {
  token_savings_vs_bare_cli: number | null;
  repeated_reads_blocked: number | null;
  anatomy_hits: number | null;
  recurrences: number;
  negative_writes: number;
  recurrence_rate: number | null;
  insufficient_data: boolean;
}

interface LedgerLike {
  lifetime?: {
    estimated_savings_vs_bare_cli?: number;
    repeated_reads_blocked?: number;
    anatomy_hits?: number;
    recurrences?: number;
    negative_writes?: number;
  };
}
interface HippoLike {
  stats?: { recurrences?: number; negative_writes?: number };
}

function readJson<T>(p: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
  } catch {
    return null;
  }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function computeOutcome(
  lifetime: LedgerLike["lifetime"],
  stats: HippoLike["stats"]
): OutcomeResult {
  const lf = lifetime ?? {};
  const st = stats ?? {};
  const recurrences = Number(st.recurrences ?? lf.recurrences ?? 0);
  const negativeWrites = Number(st.negative_writes ?? lf.negative_writes ?? 0);
  const insufficient = negativeWrites === 0;

  return {
    token_savings_vs_bare_cli:
      typeof lf.estimated_savings_vs_bare_cli === "number"
        ? lf.estimated_savings_vs_bare_cli
        : null,
    repeated_reads_blocked:
      typeof lf.repeated_reads_blocked === "number"
        ? lf.repeated_reads_blocked
        : null,
    anatomy_hits:
      typeof lf.anatomy_hits === "number" ? lf.anatomy_hits : null,
    recurrences,
    negative_writes: negativeWrites,
    recurrence_rate: insufficient ? null : round3(recurrences / negativeWrites),
    insufficient_data: insufficient,
  };
}

export function collectOutcome(wolfDir: string): OutcomeResult {
  const ledger = readJson<LedgerLike>(path.join(wolfDir, "token-ledger.json"));
  const hippo = readJson<HippoLike>(path.join(wolfDir, "hippocampus.json"));
  return computeOutcome(ledger?.lifetime ?? {}, hippo?.stats ?? {});
}
