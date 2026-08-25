import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { extractDescription, capDescription } from "./description-extractor.js";
import {
  newStore, renderStore, renderToFile, saveStore, loadStoreReconciled, sha256,
  type AnatomyStoreData, type StoreFileEntry,
} from "../hooks/anatomy-store.js";
import { withAnatomyLock, CLI_LOCK_BUDGET_MS } from "../hooks/anatomy-lock.js";
import { extractSymbols, symbolsSupported, SYMBOL_MIN_TOKENS } from "../hooks/symbol-extractor.js";
import { analyzeFileTS, tsSymbolsSupported } from "../anatomy/ts-symbol-extractor.js";
import { computeImportance, extractEdges } from "../anatomy/importance.js";
import { readJSON, writeJSON, writeText } from "../utils/fs-safe.js";
import { normalizePath } from "../utils/paths.js";

interface WolfConfig {
  version: number;
  openwolf: {
    anatomy: {
      max_description_length: number;
      max_files: number;
      exclude_patterns: string[];
    };
    token_audit: {
      chars_per_token_code: number;
      chars_per_token_prose: number;
    };
  };
}

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".svg",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar",
  ".exe", ".dll", ".so", ".dylib", ".bin",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".mp3", ".mp4", ".avi", ".mov", ".webm", ".ogg",
  ".sqlite", ".db",
  ".wasm",
  ".lock",
]);

const CODE_EXTENSIONS = new Set([
  ".ts", ".js", ".tsx", ".jsx", ".py", ".rs", ".go", ".java",
  ".c", ".cpp", ".h", ".css", ".scss", ".sql", ".sh", ".yaml",
  ".yml", ".json", ".toml", ".xml", ".dart",
]);

const PROSE_EXTENSIONS = new Set([".md", ".txt", ".rst", ".adoc"]);

// 2.4 index hygiene: generated/derived files no agent should be steered
// toward. Empirical audit: a project's anatomy indexed package-lock.json
// (~92k tok), .DS_Store, and a phpunit cache — ~105k tokens of noise in one
// index. Built in (not config) so existing installs are fixed without an
// array-merge migration; users can still index nothing here worth indexing.
const NOISE_BASENAMES = new Set([
  "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "composer.lock",
  "cargo.lock", "gemfile.lock", "poetry.lock", "uv.lock", "bun.lockb", "bun.lock",
  ".ds_store", "thumbs.db", ".phpunit.result.cache", ".eslintcache", ".tsbuildinfo",
]);
const NOISE_SUFFIXES = [".min.js", ".min.css", ".map", ".cache", ".tsbuildinfo", ".pyc", ".snap"];
const NOISE_DIRS = new Set([
  "coverage", ".nyc_output", "__snapshots__", ".pytest_cache", ".mypy_cache", ".ruff_cache",
  // Agent config surfaces: steering the model toward its own harness config
  // via the index is noise (audit: .claude/*.md topped a project's importance
  // ranking), and the agent already knows these files natively.
  ".claude", ".codex", ".opencode", ".gemini", ".cursor", ".agents",
]);

function isNoiseFile(relPath: string): boolean {
  const parts = relPath.split("/");
  const basename = parts[parts.length - 1].toLowerCase();
  if (NOISE_BASENAMES.has(basename)) return true;
  if (NOISE_SUFFIXES.some((s) => basename.endsWith(s))) return true;
  if (parts.some((p) => NOISE_DIRS.has(p.toLowerCase()))) return true;
  return false;
}

function estimateTokens(text: string, filePath: string): number {
  const ext = path.extname(filePath).toLowerCase();
  let ratio = 3.75;
  if (CODE_EXTENSIONS.has(ext)) ratio = 3.5;
  if (PROSE_EXTENSIONS.has(ext)) ratio = 4.0;
  return Math.ceil(text.length / ratio);
}

// Files that should never appear in anatomy (secrets, env files, keys).
// Kept in sync with isSensitiveFile in src/hooks/shared.ts — hooks are
// standalone scripts and cannot import from the scanner build (issue #54).
const SENSITIVE_EXTENSIONS = new Set([
  ".pem", ".key", ".p8", ".p12", ".pfx", ".keystore", ".jks", ".ppk", ".kdbx", ".tfstate",
]);
const SENSITIVE_BASENAMES = new Set([".npmrc", ".netrc", ".htpasswd", ".pgpass"]);

function isSensitiveFile(basename: string): boolean {
  const lower = basename.toLowerCase();
  if (lower === ".env" || lower.startsWith(".env.")) return true;
  if (SENSITIVE_BASENAMES.has(lower)) return true;
  const dot = lower.lastIndexOf(".");
  if (dot >= 0 && SENSITIVE_EXTENSIONS.has(lower.slice(dot))) return true;
  if (/^id_(rsa|dsa|ecdsa|ed25519)/.test(lower)) return true;
  if (lower.includes("credential") || /^secrets\.(json|ya?ml|toml)$/.test(lower)) return true;
  return false;
}

function shouldExclude(
  relPath: string,
  excludePatterns: string[]
): boolean {
  const parts = relPath.split("/");
  const basename = parts[parts.length - 1];

  // Always exclude sensitive files regardless of config
  if (isSensitiveFile(basename)) return true;

  // Always exclude generated/derived noise (lockfiles, caches, minified).
  if (isNoiseFile(relPath)) return true;

  for (const pattern of excludePatterns) {
    // Simple glob: check if any path segment matches
    if (pattern.startsWith("*.")) {
      const ext = pattern.slice(1);
      if (relPath.endsWith(ext)) return true;
    } else {
      if (parts.includes(pattern)) return true;
    }
  }
  return false;
}

function walkDir(
  dir: string,
  rootDir: string,
  excludePatterns: string[],
  maxFiles: number,
  files: Record<string, StoreFileEntry>,
  contents?: Record<string, string>
): void {
  let totalFiles = Object.keys(files).length;
  if (totalFiles >= maxFiles) return;

  let items: fs.Dirent[];
  try {
    items = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  items.sort((a, b) => a.name.localeCompare(b.name));

  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    const relPath = normalizePath(path.relative(rootDir, fullPath));

    if (shouldExclude(relPath, excludePatterns)) continue;

    if (item.isDirectory()) {
      walkDir(fullPath, rootDir, excludePatterns, maxFiles, files, contents);
    } else if (item.isFile()) {
      const ext = path.extname(item.name).toLowerCase();
      if (BINARY_EXTENSIONS.has(ext)) continue;

      // Skip files > 1MB
      let stat: fs.Stats;
      try {
        stat = fs.statSync(fullPath);
        if (stat.size > 1024 * 1024) continue;
      } catch {
        continue;
      }

      // Read file for token estimation
      let content: string;
      try {
        content = fs.readFileSync(fullPath, "utf-8");
      } catch {
        continue;
      }

      const desc = capDescription(extractDescription(fullPath));
      const tokens = estimateTokens(content, fullPath);
      const symbols =
        tokens >= SYMBOL_MIN_TOKENS && symbolsSupported(ext)
          ? extractSymbols(content, ext)
          : undefined;

      files[relPath] = {
        description: desc,
        tokens,
        hash: sha256(content).slice(0, 16),
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        updatedAt: new Date().toISOString(),
        source: "scan",
        symbols: symbols && symbols.length > 0 ? symbols : undefined,
        symbolSource: symbols && symbols.length > 0 ? "regex" : undefined,
      };
      if (contents) contents[relPath] = content;

      totalFiles++;
      if (totalFiles >= maxFiles) return;
    }
  }
}


/**
 * Scan the project and return the anatomy content and file count WITHOUT writing to disk.
 */
export async function buildAnatomy(wolfDir: string, projectRoot: string): Promise<{ content: string; fileCount: number; store: AnatomyStoreData }> {
  const configPath = path.join(wolfDir, "config.json");
  const config = readJSON<WolfConfig>(configPath, {
    version: 1,
    openwolf: {
      anatomy: {
        max_description_length: 100,
        max_files: 500,
        exclude_patterns: ["node_modules", ".git", "dist", "build", ".wolf"],
      },
      token_audit: { chars_per_token_code: 3.5, chars_per_token_prose: 4.0 },
    },
  });

  const store = newStore();
  const contents: Record<string, string> = {};
  walkDir(
    projectRoot,
    projectRoot,
    config.openwolf.anatomy.exclude_patterns,
    config.openwolf.anatomy.max_files,
    store.files,
    contents
  );

  // J2: upgrade regex symbols to exact tree-sitter results where a grammar is
  // available, and emit a signature skeleton for large files. Failure of the
  // wasm runtime leaves the regex symbols in place — never a hard error.
  for (const [relPath, entry] of Object.entries(store.files)) {
    const ext = path.extname(relPath).toLowerCase();
    if (entry.tokens < SYMBOL_MIN_TOKENS || !tsSymbolsSupported(ext)) continue;
    try {
      const analysis = await analyzeFileTS(contents[relPath] ?? "", ext);
      if (analysis && analysis.symbols.length > 0) {
        entry.symbols = analysis.symbols;
        entry.symbolSource = "ts";
        if (entry.tokens >= 2000 && analysis.skeleton) entry.skeleton = analysis.skeleton;
      }
    } catch {}
  }

  // J2: PageRank importance over the import graph (0..1, max = 1).
  // 2.5: the resolved edges are also persisted per entry so `openwolf map`
  // can run personalized PageRank straight from the index, no file reads.
  try {
    const edges = extractEdges(contents);
    for (const [relPath, targets] of edges) {
      if (store.files[relPath]) store.files[relPath].imports = targets;
    }
    const importance = computeImportance(contents);
    for (const [relPath, score] of Object.entries(importance)) {
      if (store.files[relPath]) store.files[relPath].importance = score;
    }
  } catch {}

  return { content: renderStore(store), fileCount: Object.keys(store.files).length, store };
}

/**
 * Merge a fresh disk walk into the reconciled store WITHOUT writing anything:
 * the fresh file set wins (only code path allowed to delete entries), but
 * curated descriptions, symbols, preamble, and raw lines survive. Shared by
 * scanProject (which writes under the lock) and `scan --check` (which must
 * compare against exactly what a scan would write).
 */
export function buildMergedStore(
  wolfDir: string,
  projectRoot: string,
  fresh: AnatomyStoreData
): AnatomyStoreData {
  const existing = loadStoreReconciled(wolfDir, projectRoot);
  for (const [relPath, entry] of Object.entries(fresh.files)) {
    const prev = existing.files[relPath];
    if (prev && ((prev.hash && prev.hash === entry.hash) || prev.source === "md-import")) {
      // Content unchanged or human-edited: keep the curated description.
      if (prev.description) entry.description = prev.description;
      // Symbols: never downgrade quality. A fresh tree-sitter result wins;
      // otherwise keep whatever the store already has for unchanged content
      // (which may itself be tree-sitter from an earlier scan).
      if (prev.hash === entry.hash && prev.symbols && entry.symbolSource !== "ts") {
        entry.symbols = prev.symbols;
        entry.symbolSource = prev.symbolSource;
        if (prev.skeleton && !entry.skeleton) entry.skeleton = prev.skeleton;
      }
    }
  }
  existing.files = fresh.files;
  return existing;
}

export async function scanProject(wolfDir: string, projectRoot: string): Promise<number> {
  const { fileCount, store: fresh } = await buildAnatomy(wolfDir, projectRoot);

  const result = withAnatomyLock(wolfDir, CLI_LOCK_BUDGET_MS, () => {
    const existing = buildMergedStore(wolfDir, projectRoot, fresh);
    existing.meta.lastScanned = new Date().toISOString();
    renderToFile(wolfDir, existing);
    saveStore(wolfDir, existing);
    // Record scan state so hooks can detect staleness (git switches, editor
    // edits outside an agent) without rescanning — Workstream F2b.
    try {
      let gitHead: string | null = null;
      try {
        gitHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      } catch {}
      writeJSON(path.join(wolfDir, "_scan-state.json"), {
        last_scanned: new Date().toISOString(),
        git_head: gitHead,
        file_count: fileCount,
      });
    } catch {}
    return true;
  });
  if (result === null) {
    // Lock contention: skip the write entirely. The old fallback wrote the
    // fresh render straight to anatomy.md, and the next locked writer's
    // "md wins" reconcile then permanently overwrote curated descriptions.
    console.warn("  ! anatomy is being updated by another process; scan results not written (re-run to converge)");
  }

  return fileCount;
}
