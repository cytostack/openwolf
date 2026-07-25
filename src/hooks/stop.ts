import * as fs from "node:fs";
import * as path from "node:path";
import { getWolfDir, ensureWolfDir, readJSON, writeJSON, appendMarkdown, timeShort, countSemanticEntries, readStdin, readTranscriptUsage, detectAgent, type RealUsage } from "./shared.js";

interface FileRead {
  count: number;
  tokens: number;
  first_read: string;
}

interface FileWrite {
  file: string;
  action: string;
  tokens: number;
  at: string;
}

interface SessionData {
  session_id: string;
  started: string;
  files_read: Record<string, FileRead>;
  files_written: FileWrite[];
  edit_counts: Record<string, number>;
  anatomy_hits: number;
  anatomy_misses: number;
  repeated_reads_warned: number;
  cerebrum_warnings: number;
  stop_count: number;
}

interface SessionEntry {
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
    anatomy_lookups: number;
  };
}

async function main(): Promise<void> {
  ensureWolfDir();
  const wolfDir = getWolfDir();
  const hooksDir = path.join(wolfDir, "hooks");
  const sessionFile = path.join(hooksDir, "_session.json");

  // Stop payload → transcript path for real usage measurement (F1)
  let hookInput: { transcript_path?: string } = {};
  try {
    hookInput = JSON.parse(await readStdin());
  } catch {}

  const session = readJSON<SessionData>(sessionFile, {
    session_id: "",
    started: "",
    files_read: {},
    files_written: [],
    edit_counts: {},
    anatomy_hits: 0,
    anatomy_misses: 0,
    repeated_reads_warned: 0,
    cerebrum_warnings: 0,
    stop_count: 0,
  });

  session.stop_count++;

  // Only write to ledger if there's been activity
  const readCount = Object.keys(session.files_read).length;
  const writeCount = session.files_written.length;

  if (readCount === 0 && writeCount === 0) {
    writeJSON(sessionFile, session);
    process.exit(0);
    return;
  }

  // Collect end-of-turn reminders — returned as strings, then surfaced via additionalContext
  const reminders = [
    checkForMissingBugLogs(wolfDir, session),
    checkCerebrumFreshness(wolfDir, session),
    checkCerebrumBudget(wolfDir),
    checkSemanticSummaries(wolfDir, session),
    checkTodoFreshness(wolfDir, session),
  ].filter((r): r is string => r !== null);

  // Check if STATUS.md is stale relative to this session
  checkStatusFreshness(wolfDir, session);

  // Housekeeping: keep the .wolf handoff files cheap to read.
  trimStatusJournal(wolfDir);   // STATUS.md journal → history.md (## Session Journal)
  trimMemoryLog(wolfDir);       // memory.md old sessions → history.md (## Action Log)
  trimBuglog(wolfDir);          // buglog.json old bugs → buglog-archive.json
  generateBuglogIndex(wolfDir); // buglog.json → compact buglog.md index

  // Build session entry for ledger
  const reads = Object.entries(session.files_read).map(([file, data]) => ({
    file,
    tokens_estimated: data.tokens,
    was_repeated: data.count > 1,
    anatomy_had_description: false, // simplified
  }));

  const writes = session.files_written.map((w) => ({
    file: w.file,
    tokens_estimated: w.tokens,
    action: w.action,
  }));

  const inputTokens = reads.reduce((sum, r) => sum + r.tokens_estimated, 0);
  const outputTokens = writes.reduce((sum, w) => sum + w.tokens_estimated, 0);

  const sessionEntry: SessionEntry = {
    id: session.session_id,
    agent: detectAgent(),
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
  };

  // Update token-ledger.json
  const ledgerPath = path.join(wolfDir, "token-ledger.json");
  const ledger = readJSON(ledgerPath, {
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
      estimated_savings_vs_bare_cli: 0,
    },
    sessions: [] as SessionEntry[],
    daemon_usage: [],
    waste_flags: [],
    optimization_report: { last_generated: null, patterns: [] },
  }) as {
    version: number;
    lifetime: Record<string, number>;
    sessions: SessionEntry[];
    [key: string]: unknown;
  };

  // Attach measured usage from the transcript when the harness provides it.
  if (hookInput.transcript_path) {
    const real = readTranscriptUsage(hookInput.transcript_path);
    if (real) {
      (sessionEntry as SessionEntry & { real_usage?: RealUsage }).real_usage = real;
      const lt = ledger.lifetime as Record<string, number>;
      lt.real_input_tokens = (lt.real_input_tokens ?? 0) + real.input_tokens;
      lt.real_output_tokens = (lt.real_output_tokens ?? 0) + real.output_tokens;
      lt.real_cache_read_tokens = (lt.real_cache_read_tokens ?? 0) + real.cache_read_input_tokens;
      lt.real_cache_creation_tokens = (lt.real_cache_creation_tokens ?? 0) + real.cache_creation_input_tokens;
      lt.real_api_calls = (lt.real_api_calls ?? 0) + real.api_calls;
    }
  }

  ledger.sessions.push(sessionEntry);
  ledger.lifetime.total_reads += readCount;
  ledger.lifetime.total_writes += writeCount;
  ledger.lifetime.total_tokens_estimated += inputTokens + outputTokens;
  ledger.lifetime.anatomy_hits += session.anatomy_hits;
  ledger.lifetime.anatomy_misses += session.anatomy_misses;
  ledger.lifetime.repeated_reads_blocked += session.repeated_reads_warned;

  // Estimate savings: anatomy hits save ~200 tokens each, repeated reads blocked save their token count
  const savedFromAnatomy = session.anatomy_hits * 200;
  const savedFromRepeats = Object.values(session.files_read)
    .filter((r) => r.count > 1)
    .reduce((sum, r) => sum + r.tokens * (r.count - 1), 0);
  ledger.lifetime.estimated_savings_vs_bare_cli += savedFromAnatomy + savedFromRepeats;

  writeJSON(ledgerPath, ledger);

  // Write a session summary line to memory.md if there was meaningful activity
  if (writeCount > 0) {
    try {
      const uniqueFiles = new Set(session.files_written.map(w => path.basename(w.file)));
      const fileList = [...uniqueFiles].slice(0, 5).join(", ");
      const memoryPath = path.join(wolfDir, "memory.md");
      appendMarkdown(memoryPath, `| ${timeShort()} | Session end: ${writeCount} writes across ${uniqueFiles.size} files (${fileList}) | ${readCount} reads | ~${inputTokens + outputTokens} tok |\n`);
    } catch {}
  }

  writeJSON(sessionFile, session);

  // Surface reminders via additionalContext so they appear in Claude's next context window.
  // Using process.stdout JSON is the only reliable way for Stop hooks to inject content
  // into Claude Code's context — process.stderr output goes to the terminal only.
  if (reminders.length > 0) {
    const additionalContext = `⚠️ OpenWolf end-of-turn reminders:\n${reminders.map(r => `• ${r}`).join("\n")}`;
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "Stop", additionalContext } }));
  }

  process.exit(0);
}

/**
 * Check if files were edited multiple times but buglog.json wasn't updated.
 * Returns a reminder string if action is needed, otherwise null.
 */
function checkForMissingBugLogs(wolfDir: string, session: SessionData): string | null {
  if (!session.edit_counts) return null;

  const multiEditFiles = Object.entries(session.edit_counts)
    .filter(([, count]) => count >= 3)
    .map(([file]) => path.basename(file));

  if (multiEditFiles.length === 0) return null;

  const buglogWritten = session.files_written.some(w =>
    w.file.includes("buglog.json")
  );

  if (!buglogWritten) {
    return `ACTION REQUIRED: Files edited 3+ times this session (${multiEditFiles.join(", ")}) but buglog.json was not updated. Log the bug fixes to .wolf/buglog.json now.`;
  }
  return null;
}

/**
 * Check if STATUS.md is older than the session start AND there was meaningful
 * code activity (3+ writes outside .wolf/). If so, nudge Claude to update
 * STATUS.md so the next /clear has fresh handoff context.
 */
function checkStatusFreshness(wolfDir: string, session: SessionData): void {
  const statusPath = path.join(wolfDir, "STATUS.md");
  const codeWrites = session.files_written.filter(
    (w) => !w.file.includes("/.wolf/") && !w.file.endsWith(".tmp")
  );

  try {
    const stat = fs.statSync(statusPath);
    const sessionStartMs = session.started ? Date.parse(session.started) : 0;
    if (!sessionStartMs) return;

    if (codeWrites.length >= 3 && stat.mtimeMs < sessionStartMs) {
      process.stderr.write(
        `📌 OpenWolf: STATUS.md not updated this session despite ${codeWrites.length} code writes. Update .wolf/STATUS.md (✅ done / 🚀 next quest) before /clear so next session resumes in 1 read.\n`
      );
    }
  } catch {
    // STATUS.md doesn't exist — nudge to create it if there were code writes
    if (codeWrites.length >= 3) {
      process.stderr.write(
        `📌 OpenWolf: .wolf/STATUS.md missing. Create it with current quest summary + next steps so /clear stays cheap.\n`
      );
    }
  }
}

/**
 * Nudge to keep TODO.md current. If TODO.md exists, still has unchecked items,
 * and wasn't touched this session despite real code activity (3+ writes outside
 * .wolf/), remind Claude to update it. Returns a reminder string (surfaced via
 * additionalContext) or null. TODO.md is optional — absence is never an error.
 */
function checkTodoFreshness(wolfDir: string, session: SessionData): string | null {
  const todoPath = path.join(wolfDir, "TODO.md");
  const codeWrites = session.files_written.filter(
    (w) => !w.file.includes("/.wolf/") && !w.file.endsWith(".tmp")
  );
  if (codeWrites.length < 3) return null;

  try {
    const stat = fs.statSync(todoPath);
    const sessionStartMs = session.started ? Date.parse(session.started) : 0;
    if (!sessionStartMs) return null;
    if (stat.mtimeMs >= sessionStartMs) return null; // already updated this session

    const hasOpenItems = /^\s*[-*]\s*\[ \]/m.test(fs.readFileSync(todoPath, "utf8"));
    if (!hasOpenItems) return null;

    return `ACTION REQUIRED: ${codeWrites.length} files changed but .wolf/TODO.md wasn't updated this session. Check off completed items and add any new tasks so the list stays actionable.`;
  } catch {
    return null; // no TODO.md — optional feature
  }
}

/** Atomic file write (tmp + rename) so a concurrent Stop hook from another
 * agent/session in the same project can never read a half-written file. */
function atomicWrite(p: string, data: string): void {
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, p);
}

const HISTORY_HEADER =
  "# History Archive\n\n> Older content rotated out of STATUS.md / memory.md by the stop hook (newest first). Read only when you need history beyond the live files.\n";

/** Resolve the shared history file (config openwolf.status.archive_file, default history.md). */
function historyPathOf(wolfDir: string): string {
  const cfg = readJSON<{ openwolf?: { status?: { archive_file?: string } } }>(
    path.join(wolfDir, "config.json"),
    {}
  );
  return path.join(wolfDir, cfg.openwolf?.status?.archive_file ?? "history.md");
}

/**
 * Prepend `moved` under a `## <section>` heading in the shared history file
 * (newest first). Creates the file / section as needed. Atomic write.
 */
function archiveToHistory(wolfDir: string, section: string, moved: string): void {
  const historyPath = historyPathOf(wolfDir);
  let content = fs.existsSync(historyPath) ? fs.readFileSync(historyPath, "utf8") : "";
  if (!content.startsWith("# History Archive")) {
    content = HISTORY_HEADER + (content ? "\n" + content : "");
  }
  const block = moved.replace(/\s+$/, "") + "\n";
  const heading = `## ${section}`;
  const hIdx = content.indexOf(`\n${heading}`);
  if (hIdx === -1) {
    content = content.replace(/\s+$/, "") + `\n\n${heading}\n\n${block}`;
  } else {
    const lineEnd = content.indexOf("\n", hIdx + 1) + 1;
    const rest = content.slice(lineEnd).replace(/^\n+/, "");
    content = content.slice(0, lineEnd) + "\n" + block + "\n" + rest;
  }
  atomicWrite(historyPath, content);
}

/**
 * Keep STATUS.md lean for cheap resumes. The leading blockquote of STATUS.md is
 * a session journal ("> **SESSÃO N ..." / "> **SESSION N ...") that grows every
 * session. Rotates all but the newest N blocks into the history file under
 * "## Session Journal" (newest first). N = openwolf.status.max_sessions
 * (default 2). No-op unless there are more than N blocks, so most Stops touch
 * nothing.
 */
function trimStatusJournal(wolfDir: string): void {
  try {
    const statusPath = path.join(wolfDir, "STATUS.md");
    if (!fs.existsSync(statusPath)) return;

    const cfg = readJSON<{ openwolf?: { status?: { max_sessions?: number } } }>(
      path.join(wolfDir, "config.json"),
      {}
    );
    const keep = Math.max(1, cfg.openwolf?.status?.max_sessions ?? 2);
    // Session-block header marker: "> **SESSÃO N" or "> **SESSION N" (any case).
    const SESS_RE = /^>\s*\*\*(SESS[ÃA]O|SESSION)\b/i;

    const raw = fs.readFileSync(statusPath, "utf8");
    const lines = raw.split("\n");

    // Leading blockquote region: from the first ">" line until a section boundary.
    const jStart = lines.findIndex((l) => /^>/.test(l));
    if (jStart === -1) return;
    let jEnd = jStart;
    while (jEnd < lines.length) {
      const l = lines[jEnd];
      if (/^---/.test(l) || /^#/.test(l)) break;
      if (/^>/.test(l) || /^\s*$/.test(l)) { jEnd++; continue; }
      break;
    }
    const journal = lines.slice(jStart, jEnd);

    // Split into preamble (intro quote lines) + session blocks (newest first).
    const markers = journal
      .map((l, i) => (SESS_RE.test(l) ? i : -1))
      .filter((i) => i >= 0);
    if (markers.length <= keep) return; // nothing to rotate

    const preamble = journal.slice(0, markers[0]);
    const blocks: string[][] = [];
    for (let i = 0; i < markers.length; i++) {
      const s = markers[i];
      const e = i + 1 < markers.length ? markers[i + 1] : journal.length;
      blocks.push(journal.slice(s, e));
    }
    const keepBlocks = blocks.slice(0, keep);
    const archiveBlocks = blocks.slice(keep);

    const newJournal = [...preamble, ...keepBlocks.flat()];
    while (newJournal.length && newJournal[newJournal.length - 1].trim() === "") {
      newJournal.pop();
    }
    const newStatus = [...lines.slice(0, jStart), ...newJournal, "", ...lines.slice(jEnd)].join("\n");

    // History first: a crash between writes can only duplicate a block, never lose one.
    archiveToHistory(wolfDir, "Session Journal", archiveBlocks.map((b) => b.join("\n")).join("\n"));
    atomicWrite(statusPath, newStatus);
  } catch {
    // Never break the Stop hook over housekeeping.
  }
}

/**
 * Keep memory.md lean. It is a chronological action log grouped into
 * "## Session: <date>" blocks, appended oldest→newest (newest at the bottom).
 * Rotates all but the newest N session blocks into the history file under
 * "## Action Log" (newest first). N = openwolf.memory.max_sessions (default 20).
 * No-op unless there are more than N blocks.
 */
function trimMemoryLog(wolfDir: string): void {
  try {
    const memPath = path.join(wolfDir, "memory.md");
    if (!fs.existsSync(memPath)) return;

    const cfg = readJSON<{ openwolf?: { memory?: { max_sessions?: number } } }>(
      path.join(wolfDir, "config.json"),
      {}
    );
    const keep = Math.max(2, cfg.openwolf?.memory?.max_sessions ?? 20);
    const SESSION_RE = /^##\s+Session:/i;

    const raw = fs.readFileSync(memPath, "utf8");
    const lines = raw.split("\n");
    const markers = lines
      .map((l, i) => (SESSION_RE.test(l) ? i : -1))
      .filter((i) => i >= 0);
    if (markers.length <= keep) return;

    const preamble = lines.slice(0, markers[0]);
    const blocks: string[][] = [];
    for (let i = 0; i < markers.length; i++) {
      const s = markers[i];
      const e = i + 1 < markers.length ? markers[i + 1] : lines.length;
      blocks.push(lines.slice(s, e));
    }
    // memory.md is oldest-first: keep the LAST N blocks, archive the earlier ones.
    const keepBlocks = blocks.slice(blocks.length - keep);
    const olderBlocks = blocks.slice(0, blocks.length - keep);

    const newMemory = [...preamble, ...keepBlocks.flat()];
    while (newMemory.length && newMemory[newMemory.length - 1].trim() === "") newMemory.pop();

    // Reverse so the most recent of the evicted blocks lands on top (newest first).
    const moved = olderBlocks.reverse().map((b) => b.join("\n")).join("\n");
    archiveToHistory(wolfDir, "Action Log", moved);
    atomicWrite(memPath, newMemory.join("\n") + "\n");
  } catch {
    // Never break the Stop hook over housekeeping.
  }
}

/**
 * Cap the live buglog.json at the newest N bugs (openwolf.buglog.max_entries,
 * default 200); older bugs move to buglog-archive.json (chronological). Keeps
 * the generated buglog.md index small without ever deleting a logged fix. Bugs
 * are stored append-order (oldest first), so the newest are at the tail.
 */
function trimBuglog(wolfDir: string): void {
  try {
    const jsonPath = path.join(wolfDir, "buglog.json");
    if (!fs.existsSync(jsonPath)) return;

    const cfg = readJSON<{ openwolf?: { buglog?: { max_entries?: number } } }>(
      path.join(wolfDir, "config.json"),
      {}
    );
    const keep = Math.max(20, cfg.openwolf?.buglog?.max_entries ?? 200);

    const data = readJSON<{ version?: number; bugs?: unknown[] }>(jsonPath, { bugs: [] });
    const bugs = Array.isArray(data.bugs) ? data.bugs : [];
    if (bugs.length <= keep) return;

    const kept = bugs.slice(bugs.length - keep);
    const older = bugs.slice(0, bugs.length - keep);

    const archPath = path.join(wolfDir, "buglog-archive.json");
    const arch = readJSON<{ version?: number; bugs?: unknown[] }>(archPath, { version: 1, bugs: [] });
    const archBugs = Array.isArray(arch.bugs) ? arch.bugs : [];
    // Archive first so a crash can only duplicate, never lose, a bug.
    atomicWrite(archPath, JSON.stringify({ version: arch.version ?? 1, bugs: [...archBugs, ...older] }, null, 2) + "\n");
    atomicWrite(jsonPath, JSON.stringify({ version: data.version ?? 1, bugs: kept }, null, 2) + "\n");
  } catch {
    // Best-effort — never break the Stop hook.
  }
}

/**
 * Render a compact buglog.md index from buglog.json so Claude reads a small
 * index (id · tags · file · truncated message) before a fix, and only opens the
 * full entry in buglog.json when a candidate matches. Regenerated only when the
 * source is newer than the index. Non-destructive: buglog.json is untouched.
 */
function generateBuglogIndex(wolfDir: string): void {
  try {
    const jsonPath = path.join(wolfDir, "buglog.json");
    const mdPath = path.join(wolfDir, "buglog.md");
    if (!fs.existsSync(jsonPath)) return;
    if (fs.existsSync(mdPath) && fs.statSync(mdPath).mtimeMs >= fs.statSync(jsonPath).mtimeMs) return;

    const data = readJSON<{ bugs?: Array<Record<string, unknown>> }>(jsonPath, { bugs: [] });
    const bugs = Array.isArray(data.bugs) ? data.bugs : [];
    const esc = (s: string) => s.replace(/\s+/g, " ").replace(/\|/g, "\\|");
    const rows = bugs.map((b) => {
      const id = esc(String(b.id ?? ""));
      const tags = Array.isArray(b.tags) ? esc((b.tags as string[]).join(",")) : "";
      const file = esc(String(b.file ?? ""));
      const msg = esc(String(b.error_message ?? "")).slice(0, 80);
      return `| ${id} | ${tags} | ${file} | ${msg} |`;
    });
    const md =
      `# Buglog Index\n\n> Compact index of .wolf/buglog.json (${bugs.length} bugs). Auto-generated by the stop hook — do not edit.\n` +
      `> BEFORE fixing a bug, scan this index by tag / file / message, then open ONLY the matching entry in buglog.json. Never read the whole JSON.\n\n` +
      `| id | tags | file | error (truncated) |\n|---|---|---|---|\n` +
      rows.join("\n") + "\n";
    atomicWrite(mdPath, md);
  } catch {
    // Index generation is best-effort.
  }
}

/**
 * Warn when cerebrum.md has grown well past its token budget. cerebrum.md is
 * curated knowledge read before every code-gen, so it is NOT auto-trimmed
 * (that would risk dropping real learnings); instead Claude is nudged to
 * consolidate it by hand. Returns a reminder or null.
 */
function checkCerebrumBudget(wolfDir: string): string | null {
  try {
    const cfg = readJSON<{ openwolf?: { cerebrum?: { max_tokens?: number } } }>(
      path.join(wolfDir, "config.json"),
      {}
    );
    const budget = cfg.openwolf?.cerebrum?.max_tokens ?? 2000;
    const bytes = fs.statSync(path.join(wolfDir, "cerebrum.md")).size;
    const estTokens = Math.round(bytes / 4);
    if (estTokens > budget * 2) {
      return `ACTION REQUIRED: cerebrum.md is ~${estTokens} tokens, well over its ${budget}-token budget, and it's read before every code-gen. Consolidate it: merge duplicate learnings, drop stale/one-off entries, and move dated Decision Log items into history. Keep all active User Preferences and Do-Not-Repeat rules.`;
    }
  } catch {
    // no cerebrum.md — fine
  }
  return null;
}

/**
 * Check if cerebrum.md was updated recently. If it hasn't been updated in
 * a while and there was significant activity, return a reminder.
 */
function checkCerebrumFreshness(wolfDir: string, session: SessionData): string | null {
  const cerebrumPath = path.join(wolfDir, "cerebrum.md");
  try {
    const stat = fs.statSync(cerebrumPath);
    const hoursSinceUpdate = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60);

    if (hoursSinceUpdate > 24 && session.files_written.length >= 3) {
      return `ACTION REQUIRED: cerebrum.md hasn't been updated in ${Math.floor(hoursSinceUpdate)}h and ${session.files_written.length} files were modified. Update .wolf/cerebrum.md with any new user preferences, conventions, or gotchas discovered this session.`;
    }
  } catch {
    // cerebrum.md doesn't exist, that's ok
  }
  return null;
}

/**
 * Check if a semantic summary was written to memory.md this session.
 * Returns a reminder string if action is needed, otherwise null.
 */
function checkSemanticSummaries(wolfDir: string, session: SessionData): string | null {
  const writeCount = session.files_written.length;
  if (writeCount < 2) return null;

  const semanticCount = countSemanticEntries(wolfDir);
  if (semanticCount === 0) {
    return `ACTION REQUIRED: ${writeCount} files were modified this session but no semantic summary was written to memory.md. Append a one-line summary: | HH:MM | description | file(s) | outcome | ~tokens |`;
  }
  return null;
}

// Run only when executed as a hook script — never on import (tests import
// readTranscriptUsage, and main() exits the process).
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => process.exit(0));
}
