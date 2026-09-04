import * as fs from "node:fs";
import * as path from "node:path";
import { findProjectRoot } from "../scanner/project-root.js";
import { loadStore, type AnatomyStoreData } from "../hooks/anatomy-store.js";
import { rankFromEdges } from "../anatomy/importance.js";

// ─────────────────────────────────────────────────────────────────────────────
// `openwolf map` (2.5): a token-budgeted, personalized overview of the most
// important files, straight from the index (no file reads). Ranking is
// personalized PageRank over the persisted import graph, with the restart
// vector biased toward (a) files read in recent sessions and (b) --focus
// terms matched against paths and symbol names — aider's repo-map algorithm,
// adapted to the durable store. Output size is fitted to the budget by
// binary search over the ranked entry count (accept within 15%).
// ─────────────────────────────────────────────────────────────────────────────

interface MapOptions {
  budget?: string;
  focus?: string;
}

const DEFAULT_BUDGET = 1000;
/** With no session/focus seeds, expand the budget aider-style (map_mul). */
const NO_SEED_MULTIPLIER = 2;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Files read in recent session state files (last 48h), as seed weights. */
function sessionSeeds(wolfDir: string, projectRoot: string, known: Set<string>): Record<string, number> {
  const seeds: Record<string, number> = {};
  const dir = path.join(wolfDir, "hooks", "sessions");
  const cutoff = Date.now() - 48 * 3600 * 1000;
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return seeds;
  }
  for (const f of files) {
    const p = path.join(dir, f);
    try {
      if (fs.statSync(p).mtimeMs < cutoff) continue;
      const session = JSON.parse(fs.readFileSync(p, "utf-8"));
      for (const abs of Object.keys(session.files_read ?? {})) {
        const rel = path.isAbsolute(abs) ? path.relative(projectRoot, abs).split(path.sep).join("/") : abs;
        if (known.has(rel)) seeds[rel] = (seeds[rel] ?? 0) + 1;
      }
    } catch {}
  }
  return seeds;
}

/** Seed weights from --focus terms matched against paths and symbol names. */
function focusSeeds(store: AnatomyStoreData, terms: string[]): Record<string, number> {
  const seeds: Record<string, number> = {};
  const lower = terms.map((t) => t.toLowerCase()).filter(Boolean);
  if (lower.length === 0) return seeds;
  for (const [relPath, entry] of Object.entries(store.files)) {
    let w = 0;
    const pathLower = relPath.toLowerCase();
    for (const t of lower) {
      if (pathLower.includes(t)) w += 2;
      for (const s of entry.symbols ?? []) {
        if (s.name.toLowerCase().includes(t)) w += 3;
      }
    }
    if (w > 0) seeds[relPath] = w;
  }
  return seeds;
}

function renderEntries(store: AnatomyStoreData, ranked: string[], count: number): string {
  const lines: string[] = [];
  for (const relPath of ranked.slice(0, count)) {
    const e = store.files[relPath];
    const desc = e.description ? ` ${e.description}` : "";
    lines.push(`${relPath} ~${e.tokens} tok${desc}`);
    const top = [...(e.symbols ?? [])].sort((a, b) => b.tokens - a.tokens).slice(0, 3);
    for (const s of top) {
      lines.push(`  ${s.kind} ${s.name} L${s.startLine}-${s.endLine}`);
    }
  }
  return lines.join("\n");
}

export function mapCommand(opts: MapOptions = {}): void {
  const projectRoot = findProjectRoot();
  const wolfDir = path.join(projectRoot, ".wolf");
  const store = loadStore(wolfDir);
  if (!store || Object.keys(store.files).length === 0) {
    console.log("No anatomy index found. Run: openwolf scan");
    process.exitCode = 1;
    return;
  }

  const nodes = Object.keys(store.files);
  const known = new Set(nodes);
  const edges = new Map<string, string[]>();
  for (const [relPath, entry] of Object.entries(store.files)) {
    if (entry.imports && entry.imports.length > 0) {
      edges.set(relPath, entry.imports.filter((t) => known.has(t)));
    }
  }

  const focusTerms = (opts.focus ?? "").split(/[,\s]+/).filter(Boolean);
  const seeds = { ...sessionSeeds(wolfDir, projectRoot, known), ...focusSeeds(store, focusTerms) };
  const seeded = Object.keys(seeds).length > 0;

  let budget = parseInt(opts.budget ?? "", 10);
  if (!Number.isFinite(budget) || budget <= 0) budget = DEFAULT_BUDGET * (seeded ? 1 : NO_SEED_MULTIPLIER);

  let ranked: string[];
  if (edges.size > 0) {
    const scores = rankFromEdges(nodes, edges, seeded ? seeds : undefined);
    ranked = nodes.sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0) || (store.files[b].tokens - store.files[a].tokens));
  } else {
    // No import graph (unsupported languages): seeds first, then size.
    ranked = nodes.sort((a, b) => (seeds[b] ?? 0) - (seeds[a] ?? 0) || store.files[b].tokens - store.files[a].tokens);
  }

  // Binary-search the entry count to the token budget (aider: accept ±15%).
  let lower = 1;
  let upper = ranked.length;
  let middle = Math.min(Math.max(1, Math.floor(budget / 25)), upper);
  let best = renderEntries(store, ranked, middle);
  for (let i = 0; i < 12 && lower <= upper; i++) {
    const rendered = renderEntries(store, ranked, middle);
    const tokens = estimateTokens(rendered);
    if (Math.abs(tokens - budget) / budget <= 0.15) {
      best = rendered;
      break;
    }
    if (tokens < budget) {
      best = rendered;
      lower = middle + 1;
    } else {
      upper = middle - 1;
    }
    if (lower > upper) break;
    middle = Math.floor((lower + upper) / 2);
    if (middle < 1) break;
  }

  console.log(`# Project map (${Object.keys(store.files).length} indexed files, ranked by ${seeded ? "session + focus personalized" : "global"} importance, ~${estimateTokens(best)} tok)`);
  if (focusTerms.length > 0) console.log(`# focus: ${focusTerms.join(", ")}`);
  console.log(best);
}
