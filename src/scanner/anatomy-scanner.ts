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
  files: Record<string, StoreFileEntry>
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
      walkDir(fullPath, rootDir, excludePatterns, maxFiles, files);
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
      };

      totalFiles++;
      if (totalFiles >= maxFiles) return;
    }
  }
}


/**
 * Scan the project and return the anatomy content and file count WITHOUT writing to disk.
 */
export function buildAnatomy(wolfDir: string, projectRoot: string): { content: string; fileCount: number; store: AnatomyStoreData } {
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
  walkDir(
    projectRoot,
    projectRoot,
    config.openwolf.anatomy.exclude_patterns,
    config.openwolf.anatomy.max_files,
    store.files
  );

  return { content: renderStore(store), fileCount: Object.keys(store.files).length, store };
}

export function scanProject(wolfDir: string, projectRoot: string): number {
  const { fileCount, store: fresh } = buildAnatomy(wolfDir, projectRoot);

  const result = withAnatomyLock(wolfDir, CLI_LOCK_BUDGET_MS, () => {
    // Absorb md-side edits, then full-replace: the fresh disk walk defines
    // the file set (this is the only code path allowed to delete entries).
    const existing = loadStoreReconciled(wolfDir, projectRoot);
    for (const [relPath, entry] of Object.entries(fresh.files)) {
      const prev = existing.files[relPath];
      if (prev && ((prev.hash && prev.hash === entry.hash) || prev.source === "md-import")) {
        // Content unchanged or human-edited: keep the curated description.
        if (prev.description) entry.description = prev.description;
        if (prev.hash === entry.hash && prev.symbols) entry.symbols = prev.symbols;
      }
    }
    existing.files = fresh.files;
    existing.meta.lastScanned = new Date().toISOString();
    renderToFile(wolfDir, existing);
    saveStore(wolfDir, existing);
    return true;
  });
  if (result === null) {
    // Lock contention: fall back to writing the render directly (rare; the
    // next locked writer reconciles via the md import path).
    writeText(path.join(wolfDir, "anatomy.md"), renderStore(fresh));
  }

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

  return fileCount;
}

