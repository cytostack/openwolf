import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Anatomy durable store (OPENWOLF-2.0 §F2b, Phase A).
//
// Source of truth: .wolf/anatomy-index.json. anatomy.md is a RENDERED artifact
// produced by renderStore() — byte-identical to the legacy serializeAnatomy
// format so every existing parser keeps working. Writers hold the anatomy lock
// (see anatomy-lock.ts) around load → mutate → save → render.
//
// This module is deliberately SELF-CONTAINED (no relative imports): it is the
// single canonical home of the anatomy format, it compiles standalone into the
// hooks bundle, and tests import it directly.
// ─────────────────────────────────────────────────────────────────────────────

export interface AnatomyEntry {
  file: string;
  description: string;
  tokens: number;
}

export interface SymbolEntry {
  name: string;
  kind: "fn" | "class" | "method" | "section";
  startLine: number;
  endLine: number;
  tokens: number;
}

export interface StoreFileEntry {
  description: string;
  tokens: number;
  /** sha256 (first 16 hex chars) of file content when last indexed. */
  hash?: string;
  size?: number;
  mtimeMs?: number;
  updatedAt: string;
  source: "hook" | "scan" | "md-import";
  symbols?: SymbolEntry[];
}

export interface AnatomyStoreData {
  version: 1;
  meta: {
    lastScanned: string;
    fileCount: number;
    hits: number;
    misses: number;
    /** sha256 of the markdown this store last rendered — skew detection key. */
    renderedHash: string;
    storeUpdatedAt: string;
  };
  /** Keyed by full normalized relative path, e.g. "src/hooks/shared.ts". */
  files: Record<string, StoreFileEntry>;
}

export const STORE_FILE = "anatomy-index.json";

export function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export function newStore(): AnatomyStoreData {
  return {
    version: 1,
    meta: {
      lastScanned: new Date().toISOString(),
      fileCount: 0,
      hits: 0,
      misses: 0,
      renderedHash: "",
      storeUpdatedAt: new Date().toISOString(),
    },
    files: {},
  };
}

export function loadStore(wolfDir: string): AnatomyStoreData | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(wolfDir, STORE_FILE), "utf-8"));
    if (parsed && parsed.version === 1 && parsed.files && parsed.meta) return parsed as AnatomyStoreData;
    return null; // unknown shape — caller falls back to md import / rescan
  } catch {
    return null;
  }
}

export function saveStore(wolfDir: string, store: AnatomyStoreData): void {
  store.meta.fileCount = Object.keys(store.files).length;
  store.meta.storeUpdatedAt = new Date().toISOString();
  const filePath = path.join(wolfDir, STORE_FILE);
  const tmp = filePath + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
  const body = JSON.stringify(store, null, 2);
  try {
    fs.writeFileSync(tmp, body, "utf-8");
    fs.renameSync(tmp, filePath);
  } catch {
    try { fs.writeFileSync(filePath, body, "utf-8"); } catch {}
    try { fs.unlinkSync(tmp); } catch {}
  }
}

// ── Markdown format (canonical — the legacy contract, unchanged) ────────────

export function parseAnatomy(content: string): Map<string, AnatomyEntry[]> {
  const sections = new Map<string, AnatomyEntry[]>();
  let currentSection = "";
  for (const raw of content.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const sm = line.match(/^## (.+)/);
    if (sm) {
      currentSection = sm[1].trim();
      if (!sections.has(currentSection)) sections.set(currentSection, []);
      continue;
    }
    if (!currentSection) continue;
    const em = line.match(/^- `([^`]+)`(?:\s+—\s+(.+?))?\s*\(~(\d+)\s+tok\)$/);
    if (em) {
      sections.get(currentSection)!.push({
        file: em[1],
        description: em[2] || "",
        tokens: parseInt(em[3], 10),
      });
    }
  }
  return sections;
}

export function serializeAnatomy(
  sections: Map<string, AnatomyEntry[]>,
  metadata: { lastScanned: string; fileCount: number; hits: number; misses: number }
): string {
  const lines: string[] = [
    "# anatomy.md",
    "",
    `> Auto-maintained by OpenWolf. Last scanned: ${metadata.lastScanned}`,
    `> Files: ${metadata.fileCount} tracked | Anatomy hits: ${metadata.hits} | Misses: ${metadata.misses}`,
    "",
  ];
  const keys = [...sections.keys()].sort();
  for (const key of keys) {
    lines.push(`## ${key}`);
    lines.push("");
    const entries = sections.get(key)!.sort((a, b) => a.file.localeCompare(b.file));
    for (const e of entries) {
      const desc = e.description ? ` — ${e.description}` : "";
      lines.push(`- \`${e.file}\`${desc} (~${e.tokens} tok)`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** Section key for a relpath: "src/hooks/" or "./" for root files. */
export function sectionKeyOf(relPath: string): string {
  const dir = path.dirname(relPath).split(path.sep).join("/");
  return dir === "." ? "./" : dir + "/";
}

/**
 * Render the store to markdown. For entries without symbols the output is
 * byte-identical to the legacy serializeAnatomy format. Symbols render as
 * two-space-indented sub-bullets, which every legacy parser skips (they match
 * neither the section nor the entry regex):
 *
 *   - `shared.ts` — Shared hook utilities (~3200 tok)
 *     - fn `parseAnatomy` L82-104 (~180 tok)
 */
export function renderStore(store: AnatomyStoreData): string {
  const bySection = new Map<string, Array<{ file: string; entry: StoreFileEntry }>>();
  for (const [relPath, entry] of Object.entries(store.files)) {
    const key = sectionKeyOf(relPath);
    if (!bySection.has(key)) bySection.set(key, []);
    bySection.get(key)!.push({ file: relPath.slice(relPath.lastIndexOf("/") + 1), entry });
  }

  const lines: string[] = [
    "# anatomy.md",
    "",
    `> Auto-maintained by OpenWolf. Last scanned: ${store.meta.lastScanned}`,
    `> Files: ${Object.keys(store.files).length} tracked | Anatomy hits: ${store.meta.hits} | Misses: ${store.meta.misses}`,
    "",
  ];
  const keys = [...bySection.keys()].sort();
  for (const key of keys) {
    lines.push(`## ${key}`);
    lines.push("");
    const entries = bySection.get(key)!.sort((a, b) => a.file.localeCompare(b.file));
    for (const { file, entry } of entries) {
      const desc = entry.description ? ` — ${entry.description}` : "";
      lines.push(`- \`${file}\`${desc} (~${entry.tokens} tok)`);
      for (const sym of entry.symbols ?? []) {
        lines.push(`  - ${sym.kind} \`${sym.name}\` L${sym.startLine}-${sym.endLine} (~${sym.tokens} tok)`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** Write the rendered markdown atomically and pin its hash in the store. */
export function renderToFile(wolfDir: string, store: AnatomyStoreData): void {
  const content = renderStore(store);
  store.meta.renderedHash = sha256(content);
  const anatomyPath = path.join(wolfDir, "anatomy.md");
  const tmp = anatomyPath + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
  try {
    fs.writeFileSync(tmp, content, "utf-8");
    fs.renameSync(tmp, anatomyPath);
  } catch {
    try { fs.writeFileSync(anatomyPath, content, "utf-8"); } catch {}
    try { fs.unlinkSync(tmp); } catch {}
  }
}

/**
 * Absorb out-of-band edits to anatomy.md (old compiled hooks, agent/human
 * hand-edits) into the store. ADDITIVE-ONLY:
 *  - md entry differs → md wins description/tokens (newer intent)
 *  - md entry absent from store → added (source "md-import")
 *  - store entry absent from md → KEPT unless the file is gone from disk
 *    (deletions are exclusively the full scanner's job)
 * Symbols always survive (they only flow store → render).
 */
export function importFromMarkdown(
  store: AnatomyStoreData,
  mdContent: string,
  projectRoot: string
): void {
  const sections = parseAnatomy(mdContent);
  const seen = new Set<string>();
  for (const [sectionKey, entries] of sections) {
    const dir = sectionKey === "./" ? "" : sectionKey;
    for (const e of entries) {
      const relPath = (dir + e.file).split("\\").join("/");
      seen.add(relPath);
      const existing = store.files[relPath];
      if (!existing) {
        store.files[relPath] = {
          description: e.description,
          tokens: e.tokens,
          updatedAt: new Date().toISOString(),
          source: "md-import",
        };
      } else if (existing.description !== e.description || existing.tokens !== e.tokens) {
        existing.description = e.description;
        existing.tokens = e.tokens;
        existing.updatedAt = new Date().toISOString();
        existing.source = "md-import";
      }
    }
  }
  // Entries the md no longer lists: keep unless the file is really gone.
  for (const relPath of Object.keys(store.files)) {
    if (seen.has(relPath)) continue;
    if (!fs.existsSync(path.join(projectRoot, relPath))) {
      delete store.files[relPath];
    }
  }
}

/**
 * Read-side lookup: resolve a file to its anatomy entry. Store-first with an
 * O(1) relpath key; falls back to a suffix scan (paths outside the root) and
 * finally to parsing anatomy.md for projects that predate the store.
 * `normalizedFile` and `projectDir` use forward slashes.
 */
export function lookupEntry(
  wolfDir: string,
  projectDir: string,
  normalizedFile: string
): { file: string; description: string; tokens: number; symbols?: SymbolEntry[]; size?: number; mtimeMs?: number } | null {
  const rel = normalizedFile.startsWith(projectDir + "/")
    ? normalizedFile.slice(projectDir.length + 1)
    : normalizedFile.startsWith("/") ? null : normalizedFile;

  const store = loadStore(wolfDir);
  if (store) {
    const toResult = (rp: string, e: StoreFileEntry) => ({
      file: rp.slice(rp.lastIndexOf("/") + 1),
      description: e.description,
      tokens: e.tokens,
      symbols: e.symbols,
      size: e.size,
      mtimeMs: e.mtimeMs,
    });
    const hit = rel ? store.files[rel] : undefined;
    if (hit) return toResult(rel!, hit);
    for (const [rp, e] of Object.entries(store.files)) {
      if (normalizedFile === rp || normalizedFile.endsWith("/" + rp)) {
        return toResult(rp, e);
      }
    }
    return null;
  }

  // Pre-store project: legacy markdown scan.
  let md: string;
  try {
    md = fs.readFileSync(path.join(wolfDir, "anatomy.md"), "utf-8");
  } catch {
    return null;
  }
  for (const [sectionKey, entries] of parseAnatomy(md)) {
    const dir = sectionKey === "./" ? "" : sectionKey;
    for (const entry of entries) {
      const entryRelPath = (dir + entry.file).split("\\").join("/");
      if (normalizedFile === entryRelPath || normalizedFile.endsWith("/" + entryRelPath)) {
        return entry;
      }
    }
  }
  return null;
}

/**
 * Standard writer entry point: load the store (bootstrapping from anatomy.md
 * on first contact), and absorb any md-side divergence before the caller
 * mutates. Call ONLY while holding the anatomy lock.
 */
export function loadStoreReconciled(wolfDir: string, projectRoot: string): AnatomyStoreData {
  let store = loadStore(wolfDir);
  let md: string | null = null;
  try {
    md = fs.readFileSync(path.join(wolfDir, "anatomy.md"), "utf-8");
  } catch {}
  if (!store) {
    store = newStore();
    if (md) importFromMarkdown(store, md, projectRoot);
    return store;
  }
  if (md !== null && sha256(md) !== store.meta.renderedHash) {
    importFromMarkdown(store, md, projectRoot);
  }
  return store;
}
