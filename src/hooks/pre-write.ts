import * as fs from "node:fs";
import * as path from "node:path";
import { getWolfDir, ensureWolfDir, readJSON, readMarkdown, readStdin, resolveProjectPath } from "./shared.js";
import { Hippocampus } from "../hippocampus/index.js";
import { loadSpecState } from "../specs/spec-store.js";
import { buildTddReminder } from "../specs/inject.js";

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
  let input: { tool_input?: { content?: string; old_string?: string; new_string?: string; file_path?: string; path?: string } };
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0);
    return;
  }

  // For Edit tool, the meaningful content is old_string + new_string
  const content = input.tool_input?.content ?? "";
  const oldStr = input.tool_input?.old_string ?? "";
  const newStr = input.tool_input?.new_string ?? "";
  const filePath = input.tool_input?.file_path ?? input.tool_input?.path ?? "";
  const allContent = [content, oldStr, newStr].join("\n");

  if (!allContent.trim()) { process.exit(0); return; }

  // 1. Cerebrum Do-Not-Repeat check
  checkCerebrum(wolfDir, allContent);

  // 1b. SDD: test-first reminder while the active spec is in tasks/implement.
  try {
    const reminder = buildTddReminder(loadSpecState(wolfDir));
    if (reminder) process.stderr.write(`\n${reminder}`);
  } catch {
    // fail open
  }

  // 2. Hippocampus trauma check - warn about high-intensity trauma in the file
  if (filePath) {
    checkHippocampus(wolfDir, filePath);
  }

  // 3. Bug log: search for similar past bugs when editing code
  // This fires when Claude is about to edit a file — if the edit looks like a fix
  // (changing error handling, modifying catch blocks, etc.), check the bug log
  if (filePath && (oldStr || content)) {
    checkBugLog(wolfDir, filePath, oldStr, newStr, content);
  }

  process.exit(0);
}

function checkCerebrum(wolfDir: string, content: string): void {
  const cerebrumContent = readMarkdown(path.join(wolfDir, "cerebrum.md"));
  const doNotRepeatSection = cerebrumContent.split("## Do-Not-Repeat")[1];
  if (!doNotRepeatSection) return;

  const entries = doNotRepeatSection.split("## ")[0];
  const lines = entries.split("\n").filter((l) => l.trim().startsWith("[") || l.trim().startsWith("-"));

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
          process.stderr.write(
            `⚠️ OpenWolf cerebrum warning: "${trimmed}" — check your code before proceeding.\n`
          );
        }
      } catch {}
    }
  }
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

function checkBugLog(wolfDir: string, filePath: string, oldStr: string, newStr: string, content: string): void {
  const bugLogPath = path.join(wolfDir, "buglog.json");
  if (!fs.existsSync(bugLogPath)) return;

  const bugLog = readJSON<BugLog>(bugLogPath, { version: 1, bugs: [] });
  if (bugLog.bugs.length === 0) return;

  const basename = path.basename(filePath);

  // ONLY surface bugs that match the SAME file being edited.
  // Cross-file matching is too noisy and risks misdirecting Claude.
  const fileMatches = bugLog.bugs.filter(b => {
    const bugBasename = path.basename(b.file);
    return bugBasename === basename;
  });

  if (fileMatches.length === 0) return;

  // Further filter: require tag or error_message overlap with the edit content
  const editText = (oldStr + " " + newStr + " " + content).toLowerCase();
  const editTokens = tokenize(editText);

  const relevant = fileMatches.filter(bug => {
    // Check if any bug tag appears in the edit content
    const tagHit = bug.tags.some(t => editText.includes(t.toLowerCase()));
    if (tagHit) return true;

    // Check meaningful word overlap (excluding stop words)
    const bugTokens = tokenize(bug.error_message + " " + bug.root_cause);
    const overlap = [...editTokens].filter(t => bugTokens.has(t));
    // Require at least 3 meaningful overlapping words
    return overlap.length >= 3;
  });

  if (relevant.length === 0) return;

  // Surface as a FYI, not a directive — Claude should evaluate, not blindly apply
  process.stderr.write(
    `📋 OpenWolf buglog: ${relevant.length} past bug(s) found for ${basename} — review for context, do NOT apply blindly:\n`
  );
  for (const bug of relevant.slice(0, 2)) {
    process.stderr.write(
      `   [${bug.id}] "${bug.error_message.slice(0, 70)}"\n   Cause: ${bug.root_cause.slice(0, 80)}\n   Fix: ${bug.fix.slice(0, 80)}\n`
    );
  }
}

function tokenize(text: string): Set<string> {
  return new Set(
    text.replace(/[^\w\s]/g, " ").split(/\s+/)
      .filter(w => w.length > 3 && !STOP_WORDS.has(w.toLowerCase()))
      .map(w => w.toLowerCase())
  );
}

function checkHippocampus(wolfDir: string, filePath: string): void {
  // Skip if hippocampus.json doesn't exist yet
  const hippocampusPath = path.join(wolfDir, "hippocampus.json");
  if (!fs.existsSync(hippocampusPath)) return;

  try {
    const projectRoot = path.dirname(wolfDir);
    const resolvedPath = resolveProjectPath(projectRoot, filePath);
    if (!resolvedPath) return;
    const { absolutePath, relativePath: relativeFile } = resolvedPath;
    const hippocampus = new Hippocampus(projectRoot);

    if (!hippocampus.exists()) return;

    // Get exact file traumas using the canonical project-relative path.
    const exactTraumas = hippocampus.getTraumas(relativeFile);
    const highIntensityExact = exactTraumas.filter(t => t.outcome.intensity >= 0.6);

    // Also recall related traumas using parent directory matching
    const relatedResponse = hippocampus.recall({
      cue: {
        type: "location",
        path: relativeFile,
        match_mode: "parent",
      },
      filters: {
        valence: ["trauma"],
        min_intensity: 0.5,
      },
      limit: 5,
    });

    // Combine exact + related, dedupe
    const allTraumas = [...exactTraumas];
    for (const event of relatedResponse.events) {
      if (!allTraumas.some((t) => t.id === event.id)) {
        allTraumas.push(event);
      }
    }

    const highIntensity = allTraumas.filter(t => t.outcome.intensity >= 0.6);

    const activeClaims = hippocampus.recallClaims({
      paths: [relativeFile],
      statuses: ["active"],
      limit: 3,
    }).claims;
    if (activeClaims.length > 0) {
      process.stderr.write(`\n📚 OpenWolf current knowledge for ${relativeFile}:\n`);
      for (const claim of activeClaims) {
        const source = claim.provenance.label
          ? `${claim.provenance.source} (${claim.provenance.label})`
          : claim.provenance.source;
        process.stderr.write(
          `   ✓ [${Math.round(claim.confidence * 100)}%] ${claim.statement}\n` +
          `     provenance: ${source}; evidence: ${claim.evidence_event_ids.join(", ") || "none"}\n`
        );
      }
    }

    if (highIntensity.length > 0) {
      const fileLabel = highIntensityExact.length > 0 ? path.basename(filePath) : `related in ${path.dirname(absolutePath).split("/").pop()}`;
      process.stderr.write(
        `\n🧠 OpenWolf hippocampus: ${highIntensity.length} trauma(s) for ${fileLabel}\n`
      );
      for (const trauma of highIntensity.slice(0, 3)) {
        const isExact = highIntensityExact.some((e) => e.id === trauma.id);
        const prefix = isExact ? "⚠️" : "📌";
        process.stderr.write(
          `   ${prefix} [${trauma.outcome.intensity.toFixed(1)}] "${trauma.outcome.reflection}"\n`
        );
      }
    }
  } catch {
    // Hippocampus errors should be silent
  }
}

main().catch(() => process.exit(0));
