import type { SymbolEntry } from "./anatomy-store.js";

// ─────────────────────────────────────────────────────────────────────────────
// Symbol-level anatomy (OPENWOLF-2.0 §F2b, Phase B).
//
// Extracts top-level symbols (name, kind, line range, token estimate) so the
// pre-read hint can point agents at a slice of a big file instead of the whole
// thing. Deliberately heuristic: line-anchored regexes for top-level
// declarations only; a symbol's end is the line before the next symbol.
// Crude ranges are fine for offset/limit reads.
//
// Self-contained (no relative imports) so it compiles standalone into the
// hooks bundle and tests can import it directly.
// ─────────────────────────────────────────────────────────────────────────────

/** Only extract for files at least this many estimated tokens. */
export const SYMBOL_MIN_TOKENS = 500;
/** Never extract from more than this much content. */
export const SYMBOL_MAX_BYTES = 256 * 1024;
/** Cap symbols per file (in declaration order). */
export const SYMBOL_MAX_COUNT = 30;

interface Pattern {
  re: RegExp;
  kind: SymbolEntry["kind"];
}

const TS_JS: Pattern[] = [
  { re: /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, kind: "fn" },
  { re: /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: "class" },
  { re: /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/, kind: "fn" },
  { re: /^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: "section" },
];

const LANG_PATTERNS: Record<string, Pattern[]> = {
  ".ts": TS_JS, ".tsx": TS_JS, ".js": TS_JS, ".jsx": TS_JS, ".mjs": TS_JS, ".cjs": TS_JS,
  ".py": [
    { re: /^(?:async\s+)?def\s+(\w+)/, kind: "fn" },
    { re: /^class\s+(\w+)/, kind: "class" },
  ],
  ".go": [
    { re: /^func\s+(?:\([^)]+\)\s+)?(\w+)/, kind: "fn" },
    { re: /^type\s+(\w+)\s+struct\b/, kind: "class" },
    { re: /^type\s+(\w+)\s+interface\b/, kind: "section" },
  ],
  ".rs": [
    { re: /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)/, kind: "fn" },
    { re: /^(?:pub(?:\([^)]*\))?\s+)?struct\s+(\w+)/, kind: "class" },
    { re: /^(?:pub(?:\([^)]*\))?\s+)?enum\s+(\w+)/, kind: "class" },
    { re: /^impl(?:<[^>]*>)?\s+(?:[\w:<>]+\s+for\s+)?([\w]+)/, kind: "section" },
  ],
};

export function symbolsSupported(ext: string): boolean {
  return ext.toLowerCase() in LANG_PATTERNS;
}

/**
 * Extract top-level symbols with 1-based line ranges. `ext` is the file
 * extension including the dot. Tokens are chars/3.5 over the symbol's slice.
 */
export function extractSymbols(content: string, ext: string): SymbolEntry[] {
  const patterns = LANG_PATTERNS[ext.toLowerCase()];
  if (!patterns || content.length > SYMBOL_MAX_BYTES) return [];

  const lines = content.split(/\r?\n/);
  const found: Array<{ name: string; kind: SymbolEntry["kind"]; startLine: number }> = [];

  for (let i = 0; i < lines.length && found.length < SYMBOL_MAX_COUNT; i++) {
    for (const { re, kind } of patterns) {
      const m = lines[i].match(re);
      if (m) {
        found.push({ name: m[1], kind, startLine: i + 1 });
        break;
      }
    }
  }
  if (found.length === 0) return [];

  const symbols: SymbolEntry[] = [];
  for (let i = 0; i < found.length; i++) {
    const startLine = found[i].startLine;
    const endLine = i + 1 < found.length ? found[i + 1].startLine - 1 : lines.length;
    const sliceChars = lines.slice(startLine - 1, endLine).join("\n").length;
    symbols.push({
      name: found[i].name,
      kind: found[i].kind,
      startLine,
      endLine,
      tokens: Math.ceil(sliceChars / 3.5),
    });
  }
  return symbols;
}
