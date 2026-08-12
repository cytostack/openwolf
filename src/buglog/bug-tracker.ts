import * as path from "node:path";
import { readJSON, writeJSON } from "../utils/fs-safe.js";

interface BugEntry {
  id: string;
  timestamp: string;
  error_message: string;
  file?: string;
  files?: string[];
  line?: number;
  root_cause: string;
  fix: string;
  tags: string[];
  related_bugs: string[];
  occurrences: number;
  last_seen: string;
}

interface BugLog {
  version: number;
  bugs: BugEntry[];
}

export function getBugLogPath(wolfDir: string): string {
  return path.join(wolfDir, "buglog.json");
}

export function readBugLog(wolfDir: string): BugLog {
  return readJSON<BugLog>(getBugLogPath(wolfDir), { version: 1, bugs: [] });
}

export function logBug(
  wolfDir: string,
  bug: {
    error_message: string;
    file: string;
    line?: number;
    root_cause: string;
    fix: string;
    tags: string[];
  }
): void {
  const bugLog = readBugLog(wolfDir);
  const now = new Date().toISOString();

  // Check for near-duplicate (score > 0.8)
  const similar = findSimilarBugs(wolfDir, bug.error_message);
  if (similar.length > 0 && similar[0].score > 0.8) {
    const existing = bugLog.bugs.find((b) => b.id === similar[0].bug.id);
    if (existing) {
      existing.occurrences++;
      existing.last_seen = now;
      writeJSON(getBugLogPath(wolfDir), bugLog);
      return;
    }
  }

  const id = `bug-${String(bugLog.bugs.length + 1).padStart(3, "0")}`;
  bugLog.bugs.push({
    id,
    timestamp: now,
    error_message: bug.error_message,
    file: bug.file,
    line: bug.line,
    root_cause: bug.root_cause,
    fix: bug.fix,
    tags: bug.tags,
    related_bugs: [],
    occurrences: 1,
    last_seen: now,
  });

  writeJSON(getBugLogPath(wolfDir), bugLog);
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\d+/g, "N").replace(/[^\w\s]/g, " ").trim();
}

function tokenize(text: string): Set<string> {
  return new Set(normalize(text).split(/\s+/).filter((w) => w.length > 2));
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  const intersection = new Set([...a].filter((x) => b.has(x)));
  const union = new Set([...a, ...b]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

interface ScoredBug {
  bug: BugEntry;
  score: number;
}

export function findSimilarBugs(wolfDir: string, errorMessage: string): ScoredBug[] {
  const bugLog = readBugLog(wolfDir);
  const normalizedInput = normalize(errorMessage);
  const inputTokens = tokenize(errorMessage);
  const results: ScoredBug[] = [];

  for (const bug of bugLog.bugs) {
    let score = 0;

    // Exact substring match
    if (
      normalize(bug.error_message).includes(normalizedInput) ||
      normalizedInput.includes(normalize(bug.error_message))
    ) {
      score += 1.0;
    }

    // Word overlap (jaccard)
    const bugTokens = tokenize(bug.error_message);
    score += jaccardSimilarity(inputTokens, bugTokens) * 0.5;

    if (score > 0.3) {
      results.push({ bug, score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

export function searchBugs(wolfDir: string, term: string): BugEntry[] {
  const bugLog = readBugLog(wolfDir);
  const lower = term.toLowerCase();
  // Null-safe across schema drift: older entries omit `file`/`tags`, newer
  // ones use a `files` array instead of a singular `file`. A missing field on
  // any one entry must skip that entry, not throw and abort the whole search.
  const has = (s: unknown): boolean =>
    typeof s === "string" && s.toLowerCase().includes(lower);
  const hasAny = (a: unknown): boolean => Array.isArray(a) && a.some(has);
  return bugLog.bugs.filter(
    (b) =>
      has(b.error_message) ||
      has(b.root_cause) ||
      has(b.fix) ||
      hasAny(b.tags) ||
      has(b.file) ||
      hasAny(b.files)
  );
}
