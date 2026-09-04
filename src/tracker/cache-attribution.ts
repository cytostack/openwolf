import * as fs from "node:fs";

// ─────────────────────────────────────────────────────────────────────────────
// Cache-invalidation attribution (2.2, unowned ecosystem gap). Prefix
// invalidation is arithmetically the largest waste class in agentic sessions:
// a full rebuild at 400k context re-pays the whole prefix at the cache-WRITE
// rate instead of the 0.1x read rate. The platform's /usage only flags "cache
// misses" as a bucket; nothing names the trigger. This module detects rebuild
// events from the per-call usage sequence and correlates them with the
// documented triggers that are visible in the transcript: model switches,
// compaction boundaries, Claude Code version changes, and cache-TTL gaps.
// Everything else is honestly labeled unattributed.
//
// Dependency-free (node builtins) so tests load it from source.
// ─────────────────────────────────────────────────────────────────────────────

export interface UsageCall {
  index: number;
  timestamp?: string;
  model: string;
  version?: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export interface CacheRebuild {
  call_index: number;
  timestamp?: string;
  creation_tokens: number;
  cause: "model_switch" | "compaction" | "version_change" | "cache_expired" | "unattributed";
  detail: string;
}

export interface CacheAttributionReport {
  calls: number;
  rebuilds: CacheRebuild[];
  total_rebuild_tokens: number;
}

/** Minimum creation spike (tokens) to count as a rebuild rather than normal growth. */
const REBUILD_MIN_TOKENS = 50_000;
/** Creation must also be a substantial fraction of the prior context size. */
const REBUILD_MIN_RATIO = 0.3;
/** Gap beyond which the subscription cache TTL (1h) has expired. */
const CACHE_TTL_MS = 65 * 60 * 1000;

/**
 * Read the ordered per-call usage sequence plus compaction boundaries from a
 * transcript. Dedupe follows the same message.id+requestId rule as the
 * aggregate scanner; order is file order (append-only log).
 */
export function readUsageSequence(transcriptPath: string): { calls: UsageCall[]; compactions: string[] } | null {
  let raw: string;
  try {
    raw = fs.readFileSync(transcriptPath, "utf-8");
  } catch {
    return null;
  }
  const calls: UsageCall[] = [];
  const compactions: string[] = [];
  const seen = new Set<string>();
  let anon = 0;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry?.type === "system" && entry?.subtype === "compact_boundary") {
      if (typeof entry.timestamp === "string") compactions.push(entry.timestamp);
      continue;
    }
    const usage = entry?.message?.usage;
    if (!usage || typeof usage.output_tokens !== "number") continue;
    const key = `${entry.message.id ?? `anon-${anon++}`}:${entry.requestId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    calls.push({
      index: calls.length,
      timestamp: typeof entry.timestamp === "string" ? entry.timestamp : undefined,
      model: typeof entry.message.model === "string" ? entry.message.model : "unknown",
      version: typeof entry.version === "string" ? entry.version : undefined,
      input_tokens: usage.input_tokens ?? 0,
      output_tokens: usage.output_tokens ?? 0,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
    });
  }
  if (calls.length === 0) return null;
  return { calls, compactions };
}

/** Detect prefix rebuilds and attribute each to a visible trigger. */
export function attributeCacheRebuilds(calls: UsageCall[], compactions: string[] = []): CacheAttributionReport {
  const rebuilds: CacheRebuild[] = [];
  const compactionTimes = compactions
    .map((t) => Date.parse(t))
    .filter((t) => Number.isFinite(t));

  for (let i = 1; i < calls.length; i++) {
    const cur = calls[i];
    const prev = calls[i - 1];
    const prevContext = prev.cache_read_input_tokens + prev.cache_creation_input_tokens + prev.input_tokens;
    const creation = cur.cache_creation_input_tokens;
    if (creation < REBUILD_MIN_TOKENS) continue;
    if (prevContext > 0 && creation < prevContext * REBUILD_MIN_RATIO) continue;

    // Sidechain/subagent first calls legitimately write a fresh prefix; those
    // are separate transcripts here, so a spike inside one sequence is real.
    let cause: CacheRebuild["cause"] = "unattributed";
    let detail = `${creation.toLocaleString("en-US")} tokens rewritten`;

    const curTime = cur.timestamp ? Date.parse(cur.timestamp) : NaN;
    const prevTime = prev.timestamp ? Date.parse(prev.timestamp) : NaN;

    if (cur.model !== prev.model) {
      cause = "model_switch";
      detail = `${prev.model} -> ${cur.model}; ${detail}`;
    } else if (
      Number.isFinite(curTime) &&
      compactionTimes.some((ct) => Number.isFinite(prevTime) ? ct > prevTime && ct <= curTime + 1000 : Math.abs(ct - curTime) < 120_000)
    ) {
      cause = "compaction";
      detail = `context compacted; ${detail}`;
    } else if (cur.version && prev.version && cur.version !== prev.version) {
      cause = "version_change";
      detail = `Claude Code ${prev.version} -> ${cur.version}; ${detail}`;
    } else if (Number.isFinite(curTime) && Number.isFinite(prevTime) && curTime - prevTime > CACHE_TTL_MS) {
      cause = "cache_expired";
      detail = `${Math.round((curTime - prevTime) / 60000)} min idle exceeded the cache TTL; ${detail}`;
    }

    rebuilds.push({
      call_index: cur.index,
      timestamp: cur.timestamp,
      creation_tokens: creation,
      cause,
      detail,
    });
  }

  return {
    calls: calls.length,
    rebuilds,
    total_rebuild_tokens: rebuilds.reduce((sum, r) => sum + r.creation_tokens, 0),
  };
}
