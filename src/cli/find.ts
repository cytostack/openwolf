import * as path from "node:path";
import { findProjectRoot } from "../scanner/project-root.js";
import { loadStore } from "../hooks/anatomy-store.js";

// ─────────────────────────────────────────────────────────────────────────────
// `openwolf find <symbol|path>` (Workstream J2): anatomy-as-tool. Answers
// "where is X" from the durable index alone — no scan, no file reads — with a
// shortlist ranked by match quality then import-graph importance, hard-capped
// at ~1000 estimated tokens so an agent can run it instead of grepping the
// world or reading anatomy.md whole.
// ─────────────────────────────────────────────────────────────────────────────

interface Hit {
  relPath: string;
  line: string;
  /** 3 exact, 2 prefix, 1 substring. */
  quality: number;
  importance: number;
}

const OUTPUT_TOKEN_CAP = 1000;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function findCommand(query: string, opts: { file?: boolean } = {}): void {
  const projectRoot = findProjectRoot();
  const store = loadStore(path.join(projectRoot, ".wolf"));
  if (!store || Object.keys(store.files).length === 0) {
    console.log("No anatomy index found. Run: openwolf scan");
    process.exitCode = 1;
    return;
  }

  // --file: full detail for one indexed path (description, size, symbols) —
  // the cheap replacement for reading anatomy.md or the file itself (2.4).
  if (opts.file) {
    const q = query.trim().replace(/^\.\//, "");
    const entry = store.files[q] ?? Object.entries(store.files).find(([p]) => p.endsWith("/" + q) || p === q)?.[1];
    const relPath = store.files[q] ? q : Object.keys(store.files).find((p) => p.endsWith("/" + q) || p === q);
    if (!entry || !relPath) {
      console.log(`Not in the index: ${q}. Run openwolf scan, or Grep the tree.`);
      process.exitCode = 1;
      return;
    }
    console.log(`${relPath} ~${entry.tokens} tok${entry.importance !== undefined ? ` imp ${entry.importance}` : ""}`);
    if (entry.description) console.log(`  ${entry.description}`);
    for (const s of entry.symbols ?? []) {
      console.log(`  ${s.kind} ${s.name} L${s.startLine}-${s.endLine} ~${s.tokens} tok`);
    }
    return;
  }

  const q = query.trim();
  const qLower = q.toLowerCase();
  const hits: Hit[] = [];

  const quality = (name: string): number => {
    const n = name.toLowerCase();
    if (n === qLower) return 3;
    if (n.startsWith(qLower)) return 2;
    if (n.includes(qLower)) return 1;
    return 0;
  };

  for (const [relPath, entry] of Object.entries(store.files)) {
    const importance = entry.importance ?? 0;

    // Symbol matches: one line per matching symbol with its exact range.
    for (const s of entry.symbols ?? []) {
      // Qualified names (Class.method) match on either part.
      const nameQuality = Math.max(quality(s.name), quality(s.name.split(".").pop() ?? ""));
      if (nameQuality > 0) {
        hits.push({
          relPath,
          quality: nameQuality,
          importance,
          line: `${relPath}:${s.startLine}-${s.endLine} ${s.kind} ${s.name} ~${s.tokens} tok`,
        });
      }
    }

    // Path matches: the file itself.
    const base = relPath.slice(relPath.lastIndexOf("/") + 1);
    const pathQuality = Math.max(quality(base), relPath.toLowerCase().includes(qLower) ? 1 : 0);
    if (pathQuality > 0) {
      const desc = entry.description ? ` ${entry.description}` : "";
      hits.push({
        relPath,
        quality: pathQuality,
        importance,
        line: `${relPath} file ~${entry.tokens} tok${desc}`,
      });
    }
  }

  if (hits.length === 0) {
    console.log(`No matches for "${q}" in the anatomy index (${Object.keys(store.files).length} files). Try openwolf scan to refresh, or Grep for exotic names.`);
    return;
  }

  hits.sort((a, b) => b.quality - a.quality || b.importance - a.importance || a.relPath.localeCompare(b.relPath));

  let used = 0;
  let shown = 0;
  for (const hit of hits) {
    const cost = estimateTokens(hit.line);
    if (used + cost > OUTPUT_TOKEN_CAP) break;
    console.log(hit.line);
    used += cost;
    shown++;
  }
  if (shown < hits.length) {
    console.log(`(+${hits.length - shown} more matches truncated at ~${OUTPUT_TOKEN_CAP} tok; narrow the query)`);
  }
}
