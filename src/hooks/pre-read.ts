import * as fs from "node:fs";
import * as path from "node:path";
import {
  getWolfDir, ensureWolfDir, readJSON, writeJSON,
  estimateTokens, readStdin, normalizePath, getProjectDir
} from "./shared.js";
import { lookupEntry } from "./anatomy-store.js";

interface SessionData {
  session_id: string;
  files_read: Record<string, { count: number; tokens: number; first_read: string; read_mtime?: number }>;
  anatomy_hits: number;
  anatomy_misses: number;
  repeated_reads_warned: number;
  [key: string]: unknown;
}

async function main(): Promise<void> {
  ensureWolfDir();
  const wolfDir = getWolfDir();
  const hooksDir = path.join(wolfDir, "hooks");
  const sessionFile = path.join(hooksDir, "_session.json");

  const raw = await readStdin();
  let input: { tool_input?: { file_path?: string; path?: string } };
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0);
    return;
  }

  const filePath = input.tool_input?.file_path ?? input.tool_input?.path ?? "";
  if (!filePath) { process.exit(0); return; }

  const normalizedFile = normalizePath(filePath);

  // Skip tracking for .wolf/ internal files — they're infrastructure, not project files.
  // Counting them inflates anatomy miss rates since .wolf/ is excluded from anatomy scanning.
  const projectDir = normalizePath(getProjectDir());
  const relToProject = normalizedFile.startsWith(projectDir)
    ? normalizedFile.slice(projectDir.length).replace(/^\//, "")
    : "";
  if (relToProject.startsWith(".wolf/") || relToProject.startsWith(".wolf\\")) {
    process.exit(0);
    return;
  }

  const session = readJSON<SessionData>(sessionFile, {
    session_id: "", files_read: {}, anatomy_hits: 0, anatomy_misses: 0,
    repeated_reads_warned: 0,
  });

  // Check if already read this session
  if (session.files_read[normalizedFile]) {
    const prev = session.files_read[normalizedFile];

    // Compare current mtime against stored read_mtime — if the file was
    // modified since the last read (by Claude or the user externally),
    // the re-read is legitimate: clear the stale entry and fall through.
    let fileChanged = false;
    if (prev.read_mtime !== undefined) {
      try {
        const currentMtime = fs.statSync(normalizedFile).mtimeMs;
        if (currentMtime > prev.read_mtime) {
          fileChanged = true;
        }
      } catch {
        // statSync failed (file deleted, permission error, etc.);
        // treat as unchanged so we keep the existing warning behaviour.
      }
    }

    if (!fileChanged) {
      process.stderr.write(
        `⚡ OpenWolf: ${path.basename(normalizedFile)} was already read this session (~${prev.tokens} tokens). Consider using your existing knowledge of this file.\n`
      );
      session.files_read[normalizedFile].count++;
      session.repeated_reads_warned++;
      writeJSON(sessionFile, session);
      process.exit(0);
      return;
    }

    // File was modified — reset entry so this read is treated as fresh.
    delete session.files_read[normalizedFile];
  }

  // Anatomy lookup: O(1) against the durable store, legacy md scan fallback.
  const entry = lookupEntry(wolfDir, projectDir, normalizedFile);
  const found = entry !== null;
  if (entry) {
    process.stderr.write(
      `📋 OpenWolf anatomy: ${entry.file} — ${entry.description} (~${entry.tokens} tok)\n`
    );

    // Symbol hint (F2b Phase B): point at slices of big files. Suppressed if
    // the on-disk file no longer matches what was indexed — a stale line
    // range that misdirects an offset read is worse than no hint at all.
    if (entry.symbols && entry.symbols.length > 0) {
      let fresh = false;
      try {
        const st = fs.statSync(filePath);
        fresh = (entry.size === undefined || st.size === entry.size) &&
                (entry.mtimeMs === undefined || Math.abs(st.mtimeMs - entry.mtimeMs) < 1);
      } catch {}
      if (fresh) {
        const top = [...entry.symbols].sort((a, b) => b.tokens - a.tokens).slice(0, 5);
        const list = top.map((s) => `${s.kind} ${s.name} L${s.startLine}-${s.endLine} ~${s.tokens} tok`).join("; ");
        process.stderr.write(
          `   ↳ symbols: ${list}. Read with offset/limit to fetch just the part you need.\n`
        );
      }
    }
  }

  if (found) {
    session.anatomy_hits++;
  } else {
    session.anatomy_misses++;
  }

  // Record initial read entry (tokens will be updated in post-read).
  // Capture mtime now so future re-reads can detect if the file changed.
  let readMtime: number | undefined;
  try {
    readMtime = fs.statSync(normalizedFile).mtimeMs;
  } catch {
    // File may not exist yet (e.g. read of a path about to be created);
    // leave read_mtime undefined so mtime comparison is skipped next time.
  }

  session.files_read[normalizedFile] = {
    count: 1,
    tokens: 0,
    first_read: new Date().toISOString(),
    read_mtime: readMtime,
  };

  writeJSON(sessionFile, session);
  process.exit(0);
}

main().catch(() => process.exit(0));
