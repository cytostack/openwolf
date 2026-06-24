import * as fs from "node:fs";
import * as path from "node:path";
import { getWolfDir, ensureWolfDir, writeJSON, appendMarkdown, readJSON, timestamp, timeShort } from "./shared.js";

async function main(): Promise<void> {
  ensureWolfDir();
  const wolfDir = getWolfDir();
  const notices: string[] = [];

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

  // Create fresh session state
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
      notices.push(`OpenWolf: cerebrum.md has only ${entryLines.length} entries. Learn from this session and record preferences, conventions, and mistakes to .wolf/cerebrum.md.`);
    } else if (daysSinceUpdate > 3) {
      notices.push(`OpenWolf: cerebrum.md hasn't been updated in ${Math.floor(daysSinceUpdate)} days. Look for opportunities to add learnings this session.`);
    }
  } catch {}

  // Check buglog — remind if empty
  try {
    const buglogPath = path.join(wolfDir, "buglog.json");
    const buglog = readJSON<{ bugs: unknown[] }>(buglogPath, { bugs: [] });
    if (buglog.bugs.length === 0) {
      notices.push("OpenWolf: buglog.json is empty. If you encounter or fix bugs, errors, or failed tests this session, log them to .wolf/buglog.json.");
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

  if (notices.length > 0) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: notices.join("\n"),
      },
    }));
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
