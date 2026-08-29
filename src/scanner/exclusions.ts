import * as fs from "node:fs";
import * as path from "node:path";

/**
 * The default anatomy exclusion list, in ONE place.
 *
 * Issue #93 and PR #94 by @krsfer, which reported the pollution and supplied
 * the missing patterns.
 *
 * `openwolf init` wrote one list into config.json and the scanner carried a
 * shorter fallback for when config.json is missing or unreadable, so the two
 * disagreed about what a project even contains (#93). They are the
 * same list now.
 *
 * What belongs here: directories that are machine-generated, vendored, or
 * environment-local in essentially every project that has them. What does not:
 * names that are plausible source directories somewhere. A bare `env` is the
 * clearest example. It is a common Python virtualenv name, but `src/env/` is
 * also ordinary application code, and silently dropping real source is a worse
 * failure than indexing a virtualenv. Virtualenvs under any name are caught by
 * isVirtualenvDir() below, and by .gitignore.
 */
export const DEFAULT_EXCLUDE_PATTERNS: readonly string[] = [
  // Node / JS
  // Note: ".netlify" only. A bare "netlify" would exclude netlify/functions/,
  // which is application source in every Netlify project.
  "node_modules", "dist", "build", ".next", ".nuxt", ".turbo", ".vercel",
  ".netlify", ".output", "coverage",
  // Python
  "__pycache__", ".venv", "venv", "site-packages", ".pytest_cache",
  ".mypy_cache", ".ruff_cache", ".tox", "*.pyc",
  // JVM / Android
  ".gradle", "target", ".m2",
  // Rust / Go / other build output
  ".cargo",
  // Tooling and editors
  ".git", ".wolf", ".cache", ".vscode", ".idea",
  // OS and editor droppings
  ".DS_Store", "Thumbs.db",
  // Generated assets
  "*.min.js", "*.min.css", "*.map",
];

/**
 * Patterns added in 2.5.1 (#93).
 *
 * Existing projects keep their own exclude_patterns: config merging treats
 * arrays as leaves so a user who deliberately removed an entry does not get it
 * back. That also means a project created before this release never sees new
 * defaults, so these specific additions are appended on update. Only names
 * that did not exist as defaults before belong in this list, otherwise the
 * append would resurrect a deliberate removal.
 */
export const EXCLUDE_PATTERNS_ADDED_2_5_1: readonly string[] = [
  ".venv", "venv", "site-packages", ".gradle", ".DS_Store",
  ".pytest_cache", ".mypy_cache", ".ruff_cache", ".tox", "*.pyc",
  ".m2", ".cargo", "Thumbs.db", "*.map",
];

/**
 * A directory that is a Python virtualenv, whatever it is called.
 *
 * PEP 405 requires pyvenv.cfg at the root of every venv, so this catches
 * `env/`, `.env-py311/`, `my-venv/` and anything else without guessing from
 * names. One stat per directory, only while walking.
 */
export function isVirtualenvDir(dirPath: string): boolean {
  try {
    return fs.statSync(path.join(dirPath, "pyvenv.cfg")).isFile();
  } catch {
    return false;
  }
}

// ─── .gitignore ─────────────────────────────────────────────────────────────
//
// A project's .gitignore is the list its author already wrote of what is not
// source. Keeping exclude_patterns manually in sync with it is work nobody
// does, so a scan indexed 526 files of which ~513 were pip's vendored
// dependencies inside .venv (#93).
//
// This is a deliberate subset of gitignore semantics: comments, blank lines,
// negation, anchoring, directory-only patterns, and the *, ?, ** wildcards.
// Not supported: character ranges, and per-directory .gitignore files below
// the root. Anything this misses still falls through to exclude_patterns, so
// the failure mode is "indexes a file it could have skipped", never "skips a
// file it should have indexed".

interface IgnoreRule {
  regex: RegExp;
  negated: boolean;
  directoryOnly: boolean;
}

function patternToRegex(pattern: string, anchored: boolean): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        // `**/` matches zero or more directories; a bare `**` matches anything.
        if (pattern[i + 2] === "/") { re += "(?:.*/)?"; i += 2; } else { re += ".*"; i += 1; }
      } else {
        re += "[^/]*"; // a single * never crosses a directory boundary
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  // An unanchored pattern with no slash matches at any depth, the way
  // `.DS_Store` in a root .gitignore matches `a/b/.DS_Store`.
  return new RegExp(anchored ? `^${re}$` : `^(?:.*/)?${re}$`);
}

export function parseGitignore(text: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine;
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    // Trailing whitespace is stripped unless escaped; leading whitespace is not
    // significant in practice.
    line = line.replace(/(?<!\\)\s+$/, "").trim();
    if (!line) continue;

    const negated = line.startsWith("!");
    if (negated) line = line.slice(1);

    const directoryOnly = line.endsWith("/");
    if (directoryOnly) line = line.slice(0, -1);

    // A slash anywhere but the end anchors the pattern to the repo root.
    const anchored = line.startsWith("/") || line.slice(0, -1).includes("/");
    if (line.startsWith("/")) line = line.slice(1);
    if (!line) continue;

    rules.push({ regex: patternToRegex(line, anchored), negated, directoryOnly });
  }
  return rules;
}

/** Load the project root's .gitignore. Returns [] when there is none. */
export function loadGitignore(projectRoot: string): IgnoreRule[] {
  try {
    return parseGitignore(fs.readFileSync(path.join(projectRoot, ".gitignore"), "utf-8"));
  } catch {
    return [];
  }
}

/**
 * Is `relPath` ignored by these rules? Later rules win, which is how a `!`
 * negation re-includes something an earlier pattern excluded.
 */
export function isGitIgnored(rules: IgnoreRule[], relPath: string, isDirectory: boolean): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (rule.directoryOnly && !isDirectory) continue;
    if (!rule.regex.test(relPath)) continue;
    ignored = !rule.negated;
  }
  return ignored;
}
