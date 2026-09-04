import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// Project-wide measured usage (Workstream J1): parse the harness's own
// transcript JSONL files for ground-truth token usage, per model and in total.
//
// The hook-side readTranscriptUsage (hooks/shared.ts) covers only the single
// transcript the Stop payload names; this scanner covers everything under the
// project's transcript directory, including subagent sidechains and headless
// runs no hook ever saw. Dedupe pattern (message.id + requestId, global across
// files, since resumed sessions replay lines into new files) follows ccusage
// (MIT, github.com/ryoppippi/ccusage).
//
// Deliberately free of value imports beyond node builtins so tests load it
// straight from source under Node's type stripping.
// ─────────────────────────────────────────────────────────────────────────────

export interface ModelUsageTotals {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  api_calls: number;
}

export interface ProjectUsage extends ModelUsageTotals {
  /** Transcript files that contributed at least one usage record. */
  transcripts: number;
  by_model: Record<string, ModelUsageTotals>;
  /** Subagent (sidechain) share, already included in the totals. */
  sidechain: ModelUsageTotals;
  /** ISO timestamp of the newest usage record seen. */
  last_activity: string | null;
  scanned_at: string;
}

function emptyTotals(): ModelUsageTotals {
  return { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, api_calls: 0 };
}

function addUsage(target: ModelUsageTotals, u: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }): void {
  target.input_tokens += u.input_tokens ?? 0;
  target.output_tokens += u.output_tokens ?? 0;
  target.cache_read_input_tokens += u.cache_read_input_tokens ?? 0;
  target.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0;
  target.api_calls++;
}

/**
 * The harness's transcript directory for a project: ~/.claude/projects/<slug>,
 * where the slug is the absolute project path with every non-alphanumeric
 * character replaced by "-".
 */
export function projectTranscriptDir(projectRoot: string, home: string = os.homedir()): string {
  const slug = path.resolve(projectRoot).replace(/[^a-zA-Z0-9]/g, "-");
  return path.join(home, ".claude", "projects", slug);
}

interface UsageRecord {
  model: string;
  sidechain: boolean;
  timestamp?: string;
  usage: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
}

/**
 * Scan every transcript JSONL under the project's transcript dir and aggregate
 * measured usage. Returns null when the directory does not exist or holds no
 * usage records. The slug flattens path separators, so two different roots can
 * collide on one directory; files whose `cwd` lines point at a different root
 * are skipped.
 */
export function scanProjectUsage(projectRoot: string, transcriptDir?: string): ProjectUsage | null {
  const dir = transcriptDir ?? projectTranscriptDir(projectRoot);
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return null;
  }
  if (files.length === 0) return null;

  const resolvedRoot = path.resolve(projectRoot);
  // Global dedupe across files: a resumed session replays earlier lines into
  // its new transcript file, and streaming can emit several lines per message.
  const byId = new Map<string, UsageRecord>();
  let contributingFiles = 0;
  let anon = 0;

  for (const file of files) {
    let raw: string;
    try {
      raw = fs.readFileSync(path.join(dir, file), "utf-8");
    } catch {
      continue;
    }
    let fileCwd: string | null = null;
    let fileContributed = false;
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      let entry: any;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (fileCwd === null && typeof entry?.cwd === "string" && entry.cwd) {
        fileCwd = path.resolve(entry.cwd);
        // Slug collision guard: this transcript belongs to a different root.
        if (fileCwd !== resolvedRoot && !fileCwd.startsWith(resolvedRoot + path.sep)) break;
      }
      const usage = entry?.message?.usage;
      if (!usage || typeof usage !== "object" || typeof usage.output_tokens !== "number") continue;
      const key = `${entry.message.id ?? `anon-${anon++}`}:${entry.requestId ?? ""}`;
      byId.set(key, {
        model: typeof entry.message.model === "string" ? entry.message.model : "unknown",
        sidechain: entry.isSidechain === true,
        timestamp: typeof entry.timestamp === "string" ? entry.timestamp : undefined,
        usage,
      });
      fileContributed = true;
    }
    if (fileContributed) contributingFiles++;
  }

  if (byId.size === 0) return null;

  const result: ProjectUsage = {
    ...emptyTotals(),
    transcripts: contributingFiles,
    by_model: {},
    sidechain: emptyTotals(),
    last_activity: null,
    scanned_at: new Date().toISOString(),
  };

  for (const rec of byId.values()) {
    addUsage(result, rec.usage);
    const m = result.by_model[rec.model] ?? (result.by_model[rec.model] = emptyTotals());
    addUsage(m, rec.usage);
    if (rec.sidechain) addUsage(result.sidechain, rec.usage);
    if (rec.timestamp && (!result.last_activity || rec.timestamp > result.last_activity)) {
      result.last_activity = rec.timestamp;
    }
  }

  return result;
}
