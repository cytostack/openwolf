import * as path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// File importance (Workstream J2): PageRank over the project's import graph.
// A file imported by many important files is itself important; digests, hint
// ordering, and `openwolf find` lead with high scores. Hand-rolled power
// method (~no dependency); import-edge extraction is regex-based per language
// — crude edges are fine, the ranking only needs to be roughly right.
// ─────────────────────────────────────────────────────────────────────────────

const DAMPING = 0.85;
const ITERATIONS = 20;

/** Regexes that capture a module specifier from a source line. */
const IMPORT_PATTERNS: Record<string, RegExp[]> = {
  ts: [
    /(?:^|\s)import\s+(?:[^'"]*?from\s+)?["']([^"']+)["']/,
    /(?:^|\s)export\s+[^'"]*?from\s+["']([^"']+)["']/,
    /require\(\s*["']([^"']+)["']\s*\)/,
    /import\(\s*["']([^"']+)["']\s*\)/,
  ],
  py: [
    /^\s*from\s+([\w.]+)\s+import\b/,
    /^\s*import\s+([\w.]+)/,
  ],
  go: [/^\s*(?:[\w.]+\s+)?"([^"]+)"/],
  rs: [/^\s*(?:pub\s+)?mod\s+(\w+)\s*;/, /^\s*use\s+crate::([\w:]+)/],
  php: [/^\s*use\s+([\w\\]+)\s*;/, /(?:require|include)(?:_once)?\s*\(?\s*__DIR__\s*\.\s*["']\/([^"']+)["']/],
};

function familyOf(ext: string): string | null {
  if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"].includes(ext)) return "ts";
  if (ext === ".py") return "py";
  if (ext === ".go") return "go";
  if (ext === ".rs") return "rs";
  if (ext === ".php") return "php";
  return null;
}

/**
 * Resolve a specifier to a project-relative file among `known` paths.
 * Handles TS/JS relative paths (with implied extensions/index files), Python
 * dotted modules, and Rust mod/use names. Unresolvable (external packages)
 * returns null.
 */
function resolveSpecifier(fromFile: string, spec: string, family: string, known: Set<string>): string | null {
  if (family === "ts") {
    if (!spec.startsWith(".")) return null; // external package
    const baseDir = path.posix.dirname(fromFile);
    const raw = path.posix.normalize(path.posix.join(baseDir, spec));
    const candidates = [raw];
    // ".js" import specifiers compiled from TS sources:
    if (/\.(js|mjs|cjs)$/.test(raw)) {
      candidates.push(raw.replace(/\.(js|mjs|cjs)$/, ".ts"), raw.replace(/\.(js|mjs|cjs)$/, ".tsx"));
    }
    for (const e of [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]) candidates.push(raw + e);
    for (const e of [".ts", ".tsx", ".js", ".jsx"]) candidates.push(raw + "/index" + e);
    for (const c of candidates) if (known.has(c)) return c;
    return null;
  }
  if (family === "py") {
    const mod = spec.replace(/\./g, "/");
    for (const c of [mod + ".py", mod + "/__init__.py"]) if (known.has(c)) return c;
    // relative to the importing file's package
    const baseDir = path.posix.dirname(fromFile);
    for (const c of [path.posix.join(baseDir, mod + ".py"), path.posix.join(baseDir, mod, "__init__.py")]) {
      if (known.has(c)) return c;
    }
    return null;
  }
  if (family === "rs") {
    const baseDir = path.posix.dirname(fromFile);
    const first = spec.split("::")[0];
    for (const c of [path.posix.join(baseDir, first + ".rs"), path.posix.join(baseDir, first, "mod.rs"), "src/" + first + ".rs"]) {
      if (known.has(c)) return c;
    }
    return null;
  }
  if (family === "php") {
    if (spec.includes("\\")) {
      // PSR-4: App\Models\Question -> app/Models/Question.php (first segment
      // is conventionally lowercased on disk in Laravel-style projects).
      const parts = spec.split("\\").filter(Boolean);
      if (parts.length === 0) return null;
      const asIs = parts.join("/") + ".php";
      const lowerFirst = [parts[0].toLowerCase(), ...parts.slice(1)].join("/") + ".php";
      for (const c of [asIs, lowerFirst]) if (known.has(c)) return c;
      return null;
    }
    // __DIR__ . '/relative/path.php'
    const baseDir = path.posix.dirname(fromFile);
    const c = path.posix.normalize(path.posix.join(baseDir, spec));
    return known.has(c) ? c : null;
  }
  if (family === "go") {
    // Go imports are package dirs; map the last path segment to any known
    // file inside a same-named directory.
    const seg = spec.split("/").pop();
    if (!seg) return null;
    for (const k of known) {
      if (k.includes(`/${seg}/`) || k.startsWith(`${seg}/`)) return k;
    }
    return null;
  }
  return null;
}

/** Extract project-internal import edges: fromFile -> [resolved relPaths]. */
export function extractEdges(files: Record<string, string>): Map<string, string[]> {
  const known = new Set(Object.keys(files));
  const edges = new Map<string, string[]>();
  for (const [relPath, content] of Object.entries(files)) {
    const family = familyOf(path.posix.extname(relPath).toLowerCase());
    if (!family) continue;
    const patterns = IMPORT_PATTERNS[family];
    const targets = new Set<string>();
    // Only scan the head of the file: imports live at the top, and scanning
    // whole large files for require() costs more than the edges are worth.
    for (const line of content.split("\n").slice(0, 120)) {
      for (const re of patterns) {
        const m = line.match(re);
        if (m?.[1]) {
          const resolved = resolveSpecifier(relPath, m[1], family, known);
          if (resolved && resolved !== relPath) targets.add(resolved);
        }
      }
    }
    if (targets.size > 0) edges.set(relPath, [...targets]);
  }
  return edges;
}

/**
 * PageRank over an import-edge map, normalized to [0, 1] (max score = 1).
 * With `seeds`, the restart vector is biased toward those nodes (aider's
 * personalized repo-map trick, 2.5): files touched this session or matching
 * the user's focus terms pull their neighborhoods up the ranking.
 */
export function rankFromEdges(
  nodes: string[],
  edges: Map<string, string[]>,
  seeds?: Record<string, number>
): Record<string, number> {
  if (nodes.length === 0 || edges.size === 0) return {};
  const n = nodes.length;
  const index = new Map(nodes.map((f, i) => [f, i]));

  // Restart (teleport) distribution: uniform, or biased toward seeds.
  const restart = new Array(n).fill(1 / n);
  if (seeds && Object.keys(seeds).length > 0) {
    let total = 0;
    const weights = new Array(n).fill(1); // every node keeps a floor
    for (const [node, w] of Object.entries(seeds)) {
      const i = index.get(node);
      if (i !== undefined && w > 0) weights[i] += w * n * 0.5;
    }
    for (const w of weights) total += w;
    for (let i = 0; i < n; i++) restart[i] = weights[i] / total;
  }

  // Incoming edge lists per node (PageRank flows along "imported by").
  const incoming: number[][] = nodes.map(() => []);
  const outDegree = new Array(n).fill(0);
  for (const [from, targets] of edges) {
    const fi = index.get(from);
    if (fi === undefined) continue;
    const valid = targets.filter((t) => index.has(t));
    outDegree[fi] = valid.length;
    for (const t of valid) {
      incoming[index.get(t)!].push(fi);
    }
  }

  let rank = [...restart];
  for (let iter = 0; iter < ITERATIONS; iter++) {
    const next = restart.map((r) => (1 - DAMPING) * r);
    // Dangling mass (files with no outgoing edges) follows the restart vector.
    let dangling = 0;
    for (let i = 0; i < n; i++) if (outDegree[i] === 0) dangling += rank[i];
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (const j of incoming[i]) sum += rank[j] / outDegree[j];
      next[i] += DAMPING * (sum + dangling * restart[i]);
    }
    rank = next;
  }

  const max = Math.max(...rank);
  const out: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    out[nodes[i]] = max > 0 ? Number((rank[i] / max).toFixed(4)) : 0;
  }
  return out;
}

/**
 * Unpersonalized importance over file contents, normalized to [0, 1].
 * No resolvable edges (unsupported language, flat project): every score
 * would normalize to 1, which reads as "everything maximally important" —
 * no signal beats a false one, so return {}.
 */
export function computeImportance(files: Record<string, string>): Record<string, number> {
  const nodes = Object.keys(files);
  if (nodes.length === 0) return {};
  const edges = extractEdges(files);
  if (edges.size === 0) return {};
  return rankFromEdges(nodes, edges);
}
