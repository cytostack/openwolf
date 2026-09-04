import * as fs from "node:fs";
import * as path from "node:path";
import { findProjectRoot } from "../scanner/project-root.js";
import { searchBugs } from "../buglog/bug-tracker.js";
import { searchBugsFTS } from "../hooks/bug-index.js";

export function bugSearch(term: string): void {
  const projectRoot = findProjectRoot();
  const wolfDir = path.join(projectRoot, ".wolf");

  if (!fs.existsSync(wolfDir)) {
    console.log("OpenWolf not initialized. Run: openwolf init");
    return;
  }

  // J4: relevance-ranked FTS first (node:sqlite); substring fallback below.
  const ftsResults = searchBugsFTS(wolfDir, term, 10);
  const results = (ftsResults !== null && ftsResults.length > 0
    ? ftsResults
    : searchBugs(wolfDir, term)) as ReturnType<typeof searchBugs>;

  if (results.length === 0) {
    console.log(`No bugs found matching "${term}".`);
    return;
  }

  console.log(`Found ${results.length} matching bug(s)${ftsResults !== null && ftsResults.length > 0 ? " (relevance ranked)" : ""}:\n`);

  for (const bug of results) {
    console.log(`  [${bug.id}] ${bug.error_message.slice(0, 80)}`);
    console.log(`    File: ${bug.file}${bug.line ? `:${bug.line}` : ""}`);
    console.log(`    Root cause: ${bug.root_cause}`);
    console.log(`    Fix: ${bug.fix}`);
    console.log(`    Tags: ${(bug.tags ?? []).join(", ")}`);
    console.log(`    Occurrences: ${bug.occurrences ?? 1} | Last seen: ${bug.last_seen ?? "?"}`);
    console.log("");
  }
}
