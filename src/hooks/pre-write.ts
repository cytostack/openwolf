import * as fs from "node:fs";
import * as path from "node:path";
import { getWolfDir, ensureWolfDir, readJSON, readBugLogFile, readMarkdown, readStdin, emitHookJSON, recordInjectionToSessionFile, hookMain, getSessionFilePath } from "./shared.js";
import { mutateJSON } from "./anatomy-lock.js";
import { searchBugsFTS } from "./bug-index.js";

interface BugEntry {
  id: string;
  error_message: string;
  root_cause: string;
  fix: string;
  file: string;
  tags: string[];
}

interface BugLog {
  version: number;
  bugs: BugEntry[];
}

async function main(): Promise<void> {
  ensureWolfDir();
  const wolfDir = getWolfDir();

  const raw = await readStdin();
  let input: { tool_input?: { content?: string; old_string?: string; new_string?: string; file_path?: string; path?: string }; session_id?: string };
  try {
    input = JSON.parse(raw);
  } catch {
    return;
  }

  // For Edit tool, the meaningful content is old_string + new_string
  const content = input.tool_input?.content ?? "";
  const oldStr = input.tool_input?.old_string ?? "";
  const newStr = input.tool_input?.new_string ?? "";
  const filePath = input.tool_input?.file_path ?? input.tool_input?.path ?? "";
  const allContent = [content, oldStr, newStr].join("\n");

  if (!allContent.trim()) { return; }

  // Model-visible notes — flushed as ONE additionalContext at exit.
  const notes: string[] = [];

  // 1. Cerebrum Do-Not-Repeat check
  notes.push(...checkCerebrum(wolfDir, allContent));

  // 2. Bug log: search for similar past bugs when editing code
  // This fires when Claude is about to edit a file — if the edit looks like a fix
  // (changing error handling, modifying catch blocks, etc.), check the bug log
  if (filePath && (oldStr || content)) {
    notes.push(...checkBugLog(wolfDir, filePath, oldStr, newStr, content));
  }

  if (notes.length > 0) {
    recordInjectionToSessionFile(getSessionFilePath(input), "cerebrum_buglog", notes.join("\n"), mutateJSON);
    emitHookJSON("PreToolUse", { additionalContext: notes.join("\n") });
  }
}

function checkCerebrum(wolfDir: string, content: string): string[] {
  const cerebrumContent = readMarkdown(path.join(wolfDir, "cerebrum.md"));
  const doNotRepeatSection = cerebrumContent.split("## Do-Not-Repeat")[1];
  if (!doNotRepeatSection) return [];

  const entries = doNotRepeatSection.split("## ")[0];
  const lines = entries.split("\n").filter((l) => l.trim().startsWith("[") || l.trim().startsWith("-"));
  const warnings: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim().replace(/^[-*]\s*/, "").replace(/^\[[\d-]+\]\s*/, "");
    if (!trimmed) continue;

    const patterns: string[] = [];

    const quotedMatches = trimmed.match(/"([^"]+)"/g) || trimmed.match(/'([^']+)'/g) || trimmed.match(/`([^`]+)`/g);
    if (quotedMatches) {
      for (const qm of quotedMatches) {
        patterns.push(qm.replace(/["'`]/g, ""));
      }
    }

    const neverMatch = trimmed.match(/(?:never use|avoid|don't use|do not use)\s+(\w+)/i);
    if (neverMatch) patterns.push(neverMatch[1]);

    for (const pattern of patterns) {
      try {
        const regex = new RegExp(`\\b${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
        if (regex.test(content)) {
          warnings.push(`OpenWolf cerebrum warning: "${trimmed}". Check this edit against that rule before proceeding.`);
          break;
        }
      } catch {}
    }
  }
  return warnings.slice(0, 3);
}

// Common words that appear in most code — must be excluded from similarity matching
const STOP_WORDS = new Set([
  "error", "function", "return", "const", "this", "that", "with", "from",
  "import", "export", "class", "interface", "type", "undefined", "null",
  "true", "false", "string", "number", "object", "array", "value",
  "file", "path", "name", "data", "response", "request", "result",
  "should", "must", "does", "have", "been", "will", "would", "could",
  "when", "then", "else", "each", "some", "every", "only",
]);

function checkBugLog(wolfDir: string, filePath: string, oldStr: string, newStr: string, content: string): string[] {
  const bugLogPath = path.join(wolfDir, "buglog.json");
  if (!fs.existsSync(bugLogPath)) return [];

  const bugLog = readBugLogFile(wolfDir) as BugLog;
  if (bugLog.bugs.length === 0) return [];

  const basename = path.basename(filePath);
  const editText = (oldStr + " " + newStr + " " + content).toLowerCase();

  // J4: signature-keyed FTS retrieval first — finds relevant fixes across
  // files, ranked by relevance, not just same-basename matches. Falls back to
  // the legacy basename + overlap filter when node:sqlite is unavailable.
  let relevant: BugEntry[] | null = null;
  const ftsHits = searchBugsFTS(wolfDir, `${basename} ${editText.slice(0, 600)}`, 4);
  if (ftsHits !== null) {
    // Precision gate on the recall-oriented OR-query: keep same-file hits, and
    // cross-file hits only with a tag or 3-word overlap with the edit.
    const editTokens = tokenize(editText);
    relevant = (ftsHits as unknown as BugEntry[]).filter((bug) => {
      if (path.basename(bug.file ?? "") === basename) return true;
      const tagHit = (bug.tags ?? []).some((t) => editText.includes(t.toLowerCase()));
      if (tagHit) return true;
      const bugTokens = tokenize(bug.error_message + " " + bug.root_cause);
      return [...editTokens].filter((t) => bugTokens.has(t)).length >= 3;
    });
  }

  if (relevant === null) {
    // Legacy path: ONLY surface bugs recorded against the SAME file.
    const fileMatches = bugLog.bugs.filter(b => {
      const bugBasename = path.basename(b.file ?? "");
      return bugBasename === basename;
    });
    if (fileMatches.length === 0) return [];

    const editTokens = tokenize(editText);
    relevant = fileMatches.filter(bug => {
      const tagHit = bug.tags.some(t => editText.includes(t.toLowerCase()));
      if (tagHit) return true;
      const bugTokens = tokenize(bug.error_message + " " + bug.root_cause);
      const overlap = [...editTokens].filter(t => bugTokens.has(t));
      return overlap.length >= 3;
    });
  }

  if (relevant.length === 0) return [];

  // Surface as a FYI, not a directive — Claude should evaluate, not blindly apply
  const lines = [
    `OpenWolf buglog: ${relevant.length} past bug(s) recorded for ${basename}. Review for context; do NOT apply blindly:`,
  ];
  for (const bug of relevant.slice(0, 2)) {
    lines.push(
      `[${bug.id}] "${bug.error_message.slice(0, 70)}" | Cause: ${bug.root_cause.slice(0, 80)} | Fix: ${bug.fix.slice(0, 80)}`
    );
  }
  return lines;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text.replace(/[^\w\s]/g, " ").split(/\s+/)
      .filter(w => w.length > 3 && !STOP_WORDS.has(w.toLowerCase()))
      .map(w => w.toLowerCase())
  );
}

hookMain("pre-write", main);
