import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { getWolfDir, ensureWolfDir, writeJSON, appendMarkdown, readJSON, timestamp, timeShort, estimateTokens, readStdin, detectAgent } from "./shared.js";
import { loadStore } from "./anatomy-store.js";

// ─── Session digest (Workstream E/F: model-aware context budgeting) ─────────
//
// Instead of relying on the agent to read .wolf/ files, inject a compact
// digest of the highest-value state directly into the session's context via
// the SessionStart additionalContext channel — capped to a per-agent token
// budget so injection cost stays fixed and predictable.

interface ContextConfig {
  session_digest_budget_tokens?: number;
  budgets?: Record<string, number>;
}

function digestBudget(wolfDir: string): number {
  const cfg = readJSON<{ openwolf?: { context?: ContextConfig } }>(
    path.join(wolfDir, "config.json"), {}
  );
  const ctx = cfg.openwolf?.context ?? {};
  const agent = detectAgent();
  return ctx.budgets?.[agent] ?? ctx.session_digest_budget_tokens ?? 1500;
}

/** Extract one `## heading` section (heading line through the next ## or ---). */
function extractSection(markdown: string, headingPattern: RegExp): string {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => headingPattern.test(l));
  if (start === -1) return "";
  const out: string[] = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i]) || /^---\s*$/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join("\n").trim();
}

function buildSessionDigest(wolfDir: string, budget: number): string {
  const parts: string[] = [];
  let used = 0;
  const tryAdd = (text: string): boolean => {
    if (!text) return false;
    const cost = estimateTokens(text, "prose");
    if (used + cost > budget) return false;
    parts.push(text);
    used += cost;
    return true;
  };

  // 1. STATUS.md "next phase" — the single most valuable resume context.
  try {
    const status = fs.readFileSync(path.join(wolfDir, "STATUS.md"), "utf-8");
    tryAdd(extractSection(status, /^## 🚀/));
  } catch {}

  // 2. Do-Not-Repeat list from cerebrum (most recent 10 entries).
  try {
    const cerebrum = fs.readFileSync(path.join(wolfDir, "cerebrum.md"), "utf-8");
    const dnr = extractSection(cerebrum, /^## Do-Not-Repeat/);
    if (dnr) {
      const entries = dnr.split("\n").filter((l) => l.startsWith("- "));
      if (entries.length > 0) {
        tryAdd("## Do-Not-Repeat (from .wolf/cerebrum.md)\n" + entries.slice(-10).join("\n"));
      }
    }
  } catch {}

  // 3. Recent known bugs — prevents re-deriving fixes (issue #45).
  try {
    const buglog = readJSON<{ bugs: Array<{ error_message?: string; fix?: string }> }>(
      path.join(wolfDir, "buglog.json"), { bugs: [] }
    );
    if (buglog.bugs.length > 0) {
      const recent = buglog.bugs.slice(-5).map((b) => {
        const line = `- ${b.error_message ?? "?"} → ${b.fix ?? "?"}`;
        return line.length > 140 ? line.slice(0, 137) + "..." : line;
      });
      tryAdd("## Known bugs already fixed (check .wolf/buglog.json before re-debugging)\n" + recent.join("\n"));
    }
  } catch {}

  // 4. Anatomy pointer (one line — the index itself stays on disk).
  try {
    const store = loadStore(wolfDir);
    let count: number | null = store ? Object.keys(store.files).length : null;
    if (count === null) {
      const anatomy = fs.readFileSync(path.join(wolfDir, "anatomy.md"), "utf-8");
      const m = anatomy.match(/Files:\s*(\d+)\s*tracked/i);
      if (m) count = parseInt(m[1], 10);
    }
    if (count !== null && count > 0) {
      tryAdd(`anatomy.md tracks ${count} files with descriptions + token sizes — check it before reading any file.`);
    }
  } catch {}

  return parts.join("\n\n");
}

async function main(): Promise<void> {
  ensureWolfDir();
  const wolfDir = getWolfDir();

  // Clean up stale .tmp files left from failed atomic writes
  try {
    const files = fs.readdirSync(wolfDir);
    for (const f of files) {
      if (f.endsWith(".tmp")) {
        try { fs.unlinkSync(path.join(wolfDir, f)); } catch {}
      }
    }
  } catch {}
  const hooksDir = path.join(wolfDir, "hooks");
  const sessionFile = path.join(hooksDir, "_session.json");
  const now = new Date();
  const sessionId = `session-${now.toISOString().slice(0, 10)}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;

  // SessionStart fires for startup/resume/clear/compact. Only startup and
  // clear begin a genuinely new session — on resume/compact the session is
  // still live, and resetting _session.json would wipe read/write tracking
  // mid-flight (Workstream F3: compaction survival).
  let source = "startup";
  try {
    const hookInput = JSON.parse(await readStdin());
    if (typeof hookInput.source === "string") source = hookInput.source;
  } catch {}
  const continuing = (source === "compact" || source === "resume") && fs.existsSync(sessionFile);

  if (!continuing) {
    writeJSON(sessionFile, {
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
    });

    // Append session header to memory.md
    const memoryPath = path.join(wolfDir, "memory.md");
    const header = `\n## Session: ${now.toISOString().slice(0, 10)} ${timeShort()}\n\n| Time | Action | File(s) | Outcome | ~Tokens |\n|------|--------|---------|---------|--------|\n`;
    appendMarkdown(memoryPath, header);
  }

  // Check cerebrum freshness — remind Claude to learn
  try {
    const cerebrumPath = path.join(wolfDir, "cerebrum.md");
    const cerebrumContent = fs.readFileSync(cerebrumPath, "utf-8");
    const stat = fs.statSync(cerebrumPath);
    const daysSinceUpdate = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24);

    // Count actual entries (non-comment, non-empty lines in content sections)
    const entryLines = cerebrumContent.split("\n").filter(l => {
      const t = l.trim();
      return t.startsWith("- ") || t.startsWith("* ") || (t.startsWith("[") && t.includes("]"));
    });

    if (entryLines.length < 3) {
      process.stderr.write(
        `💡 OpenWolf: cerebrum.md has only ${entryLines.length} entries. Learn from this session — record user preferences, project conventions, and mistakes to .wolf/cerebrum.md.\n`
      );
    } else if (daysSinceUpdate > 3) {
      process.stderr.write(
        `💡 OpenWolf: cerebrum.md hasn't been updated in ${Math.floor(daysSinceUpdate)} days. Look for opportunities to add learnings this session.\n`
      );
    }
  } catch {}

  // Check buglog — remind if empty
  try {
    const buglogPath = path.join(wolfDir, "buglog.json");
    const buglog = readJSON<{ bugs: unknown[] }>(buglogPath, { bugs: [] });
    if (buglog.bugs.length === 0) {
      process.stderr.write(
        `📋 OpenWolf: buglog.json is empty. If you encounter or fix any bugs, errors, or failed tests this session, log them to .wolf/buglog.json.\n`
      );
    }
  } catch {}

  // Increment total_sessions in token-ledger
  const ledgerPath = path.join(wolfDir, "token-ledger.json");
  const ledger = readJSON(ledgerPath, { version: 1, lifetime: { total_sessions: 0 } }) as {
    version: number;
    lifetime: { total_sessions: number };
    [key: string]: unknown;
  };
  ledger.lifetime.total_sessions++;
  writeJSON(ledgerPath, ledger);

  // Inject the budget-capped digest into the model's context.
  try {
    let digest = buildSessionDigest(wolfDir, digestBudget(wolfDir));

    // Anatomy staleness detection (F2b): compare scan state against git HEAD
    // and the configured rescan interval — detection is free; the agent can
    // run the actual rescan.
    const staleReason = anatomyStaleReason(wolfDir);
    if (staleReason) {
      digest = `⚠ anatomy.md may be stale (${staleReason}). Run \`openwolf scan\` before relying on it.\n\n` + digest;
    }

    // Post-compaction restore (F3): resurface in-flight session state that
    // compaction would otherwise erase.
    if (continuing && source === "compact") {
      const session = readJSON<{ files_written?: Array<{ file: string }>; edit_counts?: Record<string, number> }>(sessionFile, {});
      const files = [...new Set((session.files_written ?? []).map((w) => w.file))];
      if (files.length > 0) {
        digest = `## Session in progress (context was just compacted)\nFiles already modified this session: ${files.slice(-15).join(", ")}. Do not re-read them wholesale — check .wolf/memory.md for what was done.\n\n` + digest;
      }
    }

    if (digest) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: digest },
      }));
    }
  } catch {}

  process.exit(0);
}

// How the current anatomy scan state is stale, or null if fresh (F2b).
function anatomyStaleReason(wolfDir: string): string | null {
  try {
    const state = readJSON<{ last_scanned?: string; git_head?: string | null }>(
      path.join(wolfDir, "_scan-state.json"), {}
    );
    if (!state.last_scanned) return null; // no scan state yet — nothing to compare

    let currentHead: string | null = null;
    try {
      currentHead = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: path.dirname(wolfDir), encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000,
      }).trim();
    } catch {}
    if (state.git_head && currentHead && state.git_head !== currentHead) {
      return "git HEAD moved since last scan";
    }

    const cfg = readJSON<{ openwolf?: { anatomy?: { rescan_interval_hours?: number } } }>(
      path.join(wolfDir, "config.json"), {}
    );
    const intervalH = cfg.openwolf?.anatomy?.rescan_interval_hours ?? 6;
    const ageH = (Date.now() - new Date(state.last_scanned).getTime()) / 3600000;
    if (ageH > intervalH) return `last scanned ${Math.floor(ageH)}h ago`;
  } catch {}
  return null;
}

main().catch(() => process.exit(0));
