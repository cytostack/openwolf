import * as fs from "node:fs";
import * as path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// Instruction-decay countermeasure (2.4). The only structural effect a real
// factorial study found (arXiv 2605.10039, 1,650 sessions) is WITHIN-SESSION
// decay: ~5.6% lower compliance odds per generated function; file size showed
// affirmative-null effects. The fix shape is therefore cadence, not shorter
// files: periodically re-surface the few rules that matter most, as short
// factual statements. Additionally, the platform documents that paths-scoped
// rules and nested CLAUDE.md are LOST at compaction until a matching file is
// read again — restoring them for files already touched this session plugs a
// documented gap nobody else covers.
// Dependency-free (node builtins) so tests load it from source.
// ─────────────────────────────────────────────────────────────────────────────

/** Top-K Do-Not-Repeat rules from cerebrum, newest last (most recent kept). */
export function topRules(cerebrumContent: string, k = 3): string[] {
  const section = cerebrumContent.split(/^## Do-Not-Repeat/m)[1];
  if (!section) return [];
  const body = section.split(/^## /m)[0];
  return body
    .split("\n")
    .filter((l) => l.trim().startsWith("- ") && !/_<[^>]*>_/.test(l))
    .slice(-k)
    .map((l) => l.trim());
}

/** Convert a rules-file `paths:` glob to a RegExp (supports **, *, {a,b}). */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i += glob[i + 2] === "/" ? 3 : 2;
      } else {
        re += "[^/]*";
        i++;
      }
    } else if (c === "{") {
      const end = glob.indexOf("}", i);
      if (end === -1) { re += "\\{"; i++; continue; }
      re += "(" + glob.slice(i + 1, end).split(",").map((s) => s.replace(/[.+^${}()|[\]\\]/g, "\\$&")).join("|") + ")";
      i = end + 1;
    } else if (c === "?") {
      re += "[^/]";
      i++;
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      i++;
    }
  }
  return new RegExp(`^${re}$`);
}

interface ScopedRule {
  file: string;
  paths: string[];
  body: string;
}

/** Read .claude/rules/*.md files that carry a `paths:` frontmatter list. */
export function readScopedRules(projectRoot: string): ScopedRule[] {
  const rulesDir = path.join(projectRoot, ".claude", "rules");
  const out: ScopedRule[] = [];
  let files: string[];
  try {
    files = fs.readdirSync(rulesDir).filter((f) => f.endsWith(".md"));
  } catch {
    return out;
  }
  for (const f of files) {
    let raw = "";
    try {
      raw = fs.readFileSync(path.join(rulesDir, f), "utf-8");
    } catch {
      continue;
    }
    if (!raw.startsWith("---\n")) continue;
    const end = raw.indexOf("\n---", 4);
    if (end === -1) continue;
    const fm = raw.slice(4, end);
    if (!/^paths:/m.test(fm)) continue;
    const paths = [...fm.matchAll(/^\s*-\s*["']?([^"'\n]+)["']?\s*$/gm)].map((m) => m[1].trim());
    if (paths.length === 0) continue;
    const body = raw.slice(raw.indexOf("\n", end + 1) + 1).trim();
    if (body) out.push({ file: f, paths, body });
  }
  return out;
}

/**
 * Rules whose path scope matches any file read this session — the exact set
 * the platform documents as silently dropped by compaction until re-read.
 */
export function scopedRulesForFiles(projectRoot: string, relFiles: string[], maxTokens = 800): string[] {
  const rules = readScopedRules(projectRoot);
  const out: string[] = [];
  let usedChars = 0;
  for (const rule of rules) {
    const regexes = rule.paths.map(globToRegExp);
    if (relFiles.some((f) => regexes.some((re) => re.test(f)))) {
      const snippet = `From .claude/rules/${rule.file} (path-scoped, re-applies to files touched this session):\n${rule.body}`;
      if ((usedChars + snippet.length) / 3.5 > maxTokens) break;
      usedChars += snippet.length;
      out.push(snippet);
    }
  }
  return out;
}
