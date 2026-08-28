import * as fs from "node:fs";
import * as path from "node:path";
import { readJSON } from "../utils/fs-safe.js";
import { readRegistry } from "./registry.js";

// `openwolf survey` ??cross-repo hippocampus performance comparison.
// Reads .wolf/ stores from any set of repos (or the global registry) and
// prints the comparable metric table so external dogfood data (cindy, P4V
// trunk, ...) counts toward the "is hippocampus making the agent better?"
// question instead of living in unreadable per-repo JSON files.

interface RealUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  api_calls: number;
}

interface LedgerSession {
  id: string;
  started?: string;
  ended?: string;
  totals?: {
    input_tokens_estimated?: number;
    output_tokens_estimated?: number;
    reads_count?: number;
    writes_count?: number;
    repeated_reads_blocked?: number;
    anatomy_lookups?: number;
    recurrences?: number;
    negative_writes?: number;
  };
  real_usage?: RealUsage;
}

interface Ledger {
  created_at?: string;
  lifetime?: Record<string, number>;
  sessions?: LedgerSession[];
}

interface HippoStore {
  last_updated?: string;
  buffer?: unknown[];
  stats?: {
    total_events?: number;
    reward_count?: number;
    penalty_count?: number;
    trauma_count?: number;
    neutral_count?: number;
    recurrences?: number;
    negative_writes?: number;
  };
}

interface BugLog {
  bugs?: Array<{ error_message?: string; file?: string; occurrences?: number; last_seen?: string }>;
}

interface RepoMetrics {
  root: string;
  name: string;
  hasWolf: boolean;
  hookVersion: string;
  hasOutcomeDetectors: boolean;
  sessions: number;
  reads: number;
  writes: number;
  repeatedReadsBlocked: number;
  anatomyHits: number;
  anatomyMisses: number;
  estTokens: number;
  estSavings: number;
  realInput: number;
  realOutput: number;
  realCacheRead: number;
  realApiCalls: number;
  hippoEvents: number;
  hippoPenalty: number;
  hippoTrauma: number;
  hippoReward: number;
  hippoNeutral: number;
  hippoRecurrences: number;
  hippoNegativeWrites: number;
  buglogCount: number;
  lastActivity: string;
  outOfDate: boolean;
}

const fmt = (n: number | undefined): string => (n ?? 0).toLocaleString("en-US");

function detectHookVersion(wolfDir: string): string {
  const sharedPath = path.join(wolfDir, "hooks", "shared.js");
  try {
    const shared = fs.readFileSync(sharedPath, "utf-8");
    if (/extractTestFailures/.test(shared)) return "outcome-detectors";
    if (/recurrences/.test(shared)) return "recurrence-counters";
    return "legacy";
  } catch {
    return "no-hooks";
  }
}

function hasOutcomeDetectors(wolfDir: string): boolean {
  return fs.existsSync(path.join(wolfDir, "hooks", "user-prompt.js")) ||
    fs.existsSync(path.join(wolfDir, "hooks", "post-test.js"));
}

function lastActivityOf(wolfDir: string): string {
  const candidates = ["token-ledger.json", "hippocampus.json", "memory.md"];
  let latest = 0;
  for (const file of candidates) {
    try {
      const st = fs.statSync(path.join(wolfDir, file));
      if (st.mtimeMs > latest) latest = st.mtimeMs;
    } catch {}
  }
  return latest > 0 ? new Date(latest).toISOString() : "";
}

function analyzeRepo(root: string, fallbackName: string): RepoMetrics {
  const wolfDir = path.join(root, ".wolf");
  const name = path.basename(root) || fallbackName;
  const empty: RepoMetrics = {
    root, name, hasWolf: false, hookVersion: "no-wolf", hasOutcomeDetectors: false,
    sessions: 0, reads: 0, writes: 0, repeatedReadsBlocked: 0,
    anatomyHits: 0, anatomyMisses: 0, estTokens: 0, estSavings: 0,
    realInput: 0, realOutput: 0, realCacheRead: 0, realApiCalls: 0,
    hippoEvents: 0, hippoPenalty: 0, hippoTrauma: 0, hippoReward: 0, hippoNeutral: 0,
    hippoRecurrences: 0, hippoNegativeWrites: 0, buglogCount: 0,
    lastActivity: "", outOfDate: false,
  };
  if (!fs.existsSync(wolfDir)) return empty;

  const ledger = readJSON<Ledger>(path.join(wolfDir, "token-ledger.json"), { sessions: [] });
  const hippo = readJSON<HippoStore>(path.join(wolfDir, "hippocampus.json"), {});
  const buglog = readJSON<BugLog>(path.join(wolfDir, "buglog.json"), { bugs: [] });

  const lt = ledger.lifetime ?? {};
  const sessions = (ledger.sessions ?? []).filter((s) => s.totals && (s.totals.reads_count || s.totals.writes_count || s.totals.recurrences || s.totals.negative_writes));
  const real = sessions.reduce((sum, s) => {
    const r = s.real_usage;
    if (!r) return sum;
    return {
      input: sum.input + (r.input_tokens ?? 0),
      output: sum.output + (r.output_tokens ?? 0),
      cacheRead: sum.cacheRead + (r.cache_read_input_tokens ?? 0),
      calls: sum.calls + (r.api_calls ?? 0),
    };
  }, { input: 0, output: 0, cacheRead: 0, calls: 0 });

  const hippoStats = hippo.stats ?? {};
  const bufferEvents = (hippo.buffer ?? []) as Array<{ outcome?: { valence?: string } }>;
  const negativeFromBuffer = bufferEvents.filter((e) => e.outcome?.valence === "penalty" || e.outcome?.valence === "trauma").length;
  const penaltyFromBuffer = bufferEvents.filter((e) => e.outcome?.valence === "penalty").length;
  const traumaFromBuffer = bufferEvents.filter((e) => e.outcome?.valence === "trauma").length;
  const rewardFromBuffer = bufferEvents.filter((e) => e.outcome?.valence === "reward").length;
  const neutralFromBuffer = bufferEvents.filter((e) => e.outcome?.valence === "neutral").length;
  const buffer = hippo.buffer ?? [];
  const m: RepoMetrics = {
    ...empty,
    hasWolf: true,
    hookVersion: detectHookVersion(wolfDir),
    hasOutcomeDetectors: hasOutcomeDetectors(wolfDir),
    sessions: sessions.length || lt.total_sessions || 0,
    reads: lt.total_reads ?? sessions.reduce((a, s) => a + (s.totals?.reads_count ?? 0), 0),
    writes: lt.total_writes ?? sessions.reduce((a, s) => a + (s.totals?.writes_count ?? 0), 0),
    repeatedReadsBlocked: lt.repeated_reads_blocked ?? sessions.reduce((a, s) => a + (s.totals?.repeated_reads_blocked ?? 0), 0),
    anatomyHits: lt.anatomy_hits ?? 0,
    anatomyMisses: lt.anatomy_misses ?? 0,
    estTokens: lt.total_tokens_estimated ?? 0,
    estSavings: lt.estimated_savings_vs_bare_cli ?? 0,
    realInput: real.input,
    realOutput: real.output,
    realCacheRead: real.cacheRead,
    realApiCalls: real.calls,
    hippoEvents: buffer.length || hippoStats.total_events || 0,
    hippoPenalty: hippoStats.penalty_count ?? penaltyFromBuffer,
    hippoTrauma: hippoStats.trauma_count ?? traumaFromBuffer,
    hippoReward: hippoStats.reward_count ?? rewardFromBuffer,
    hippoNeutral: hippoStats.neutral_count ?? neutralFromBuffer,
    hippoRecurrences: hippoStats.recurrences ?? 0,
    hippoNegativeWrites: hippoStats.negative_writes ?? negativeFromBuffer,
    buglogCount: buglog.bugs?.length ?? 0,
    lastActivity: lastActivityOf(wolfDir),
    outOfDate: !hasOutcomeDetectors(wolfDir),
  };
  return m;
}

function recurrenceLabel(m: RepoMetrics): string {
  const n = m.hippoNegativeWrites;
  if (n === 0) return "n/a (no negative events)";
  return `${m.hippoRecurrences}/${n} (${((100 * m.hippoRecurrences) / n).toFixed(1)}%)`;
}

export function surveyCommand(repoArgs: string[]): void {
  const roots: string[] = [];
  if (repoArgs.length > 0) {
    for (const arg of repoArgs) {
      const abs = path.resolve(arg);
      if (fs.existsSync(abs)) roots.push(abs);
      else console.error(`  openwolf survey: not found: ${arg}`);
    }
  } else {
    const registry = readRegistry();
    for (const p of registry.projects) {
      if (fs.existsSync(p.root)) roots.push(p.root);
    }
  }
  if (roots.length === 0) {
    console.log("");
    console.log("  openwolf survey: no repos to analyze.");
    console.log("  Pass paths:  openwolf survey <path-to-repo> [more-paths...]");
    console.log("  or use the global registry (openwolf init registers projects).");
    console.log("");
    return;
  }

  const repos = roots.map((root) => analyzeRepo(root, "repo"));

  console.log("");
  console.log("  OpenWolf cross-repo hippocampus survey");
  console.log("  " + "-".repeat(76));
  const header = `  ${"REPO".padEnd(18)} ${"HOOKS".padEnd(9)} ${"SESS".padStart(4)} ${"READS".padStart(6)} ${"BLOCKED".padStart(7)} ${"EVENTS".padStart(6)} ${"PENALTY".padStart(7)} ${"RECUR/ NEG".padStart(11)} ${"BUGS".padStart(4)}`;
  console.log(header);
  console.log("  " + "-".repeat(76));
  for (const m of repos) {
    const hookLabel = m.hasWolf ? (m.outOfDate ? "OUTDATED" : m.hookVersion) : "NO .WOLF";
    console.log(
      `  ${m.name.padEnd(18)} ${hookLabel.padEnd(9)} ${String(m.sessions).padStart(4)} ` +
      `${String(m.reads).padStart(6)} ${String(m.repeatedReadsBlocked).padStart(7)} ` +
      `${String(m.hippoEvents).padStart(6)} ${String(m.hippoPenalty).padStart(7)} ` +
      `${recurrenceLabel(m).padStart(11)} ${String(m.buglogCount).padStart(4)}`
    );
    console.log(`        ${m.root}`);
  }
  console.log("  " + "-".repeat(76));

  // Verdict lines
  const withEvents = repos.filter((m) => m.hasWolf && m.hippoEvents > 0);
  const withPenalty = repos.filter((m) => m.hasWolf && m.hippoNegativeWrites > 0);
  const withReal = repos.filter((m) => m.realInput > 0);
  if (withEvents.length > 0) {
    console.log("  Outcome data (counts toward hippocampus performance):");
    for (const m of withEvents) {
      console.log(`    ${m.name}: ${m.hippoEvents} events, recurrence rate ${recurrenceLabel(m)}`);
    }
  } else {
    console.log("  Outcome data: none yet (no repos have hippocampus events).");
    console.log("  Re-run `openwolf init` on each repo to install the new hooks,");
    console.log("  then correction/test-failure events will accumulate here.");
  }
  if (withReal.length > 0) {
    console.log("  Measured cost (from transcripts):");
    const totalIn = withReal.reduce((a, m) => a + m.realInput, 0);
    const totalCache = withReal.reduce((a, m) => a + m.realCacheRead, 0);
    console.log(`    ${withReal.length} repo(s), ${fmt(totalIn)} input tokens, ${fmt(totalCache)} cache-read tokens`);
  }
  console.log("");
}
