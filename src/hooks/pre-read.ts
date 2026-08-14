import * as fs from "node:fs";
import * as path from "node:path";
import {
  getWolfDir, ensureWolfDir, readJSON, writeJSON,
  estimateTokens, readStdin, normalizePath, getProjectDir, resolveProjectPath
} from "./shared.js";
import { Hippocampus } from "../hippocampus/index.js";
import { lookupEntry } from "./anatomy-store.js";

interface SessionData {
  session_id: string;
  files_read: Record<string, { count: number; tokens: number; first_read: string }>;
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

  const projectRoot = getProjectDir();
  const resolvedPath = resolveProjectPath(projectRoot, filePath);
  if (!resolvedPath) { process.exit(0); return; }
  const { absolutePath, relativePath } = resolvedPath;
  const normalizedFile = normalizePath(absolutePath);

  // Skip tracking for .wolf/ internal files — they're infrastructure, not project files.
  // Counting them inflates anatomy miss rates since .wolf/ is excluded from anatomy scanning.
  if (relativePath === ".wolf" || relativePath.startsWith(".wolf/")) {
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
    process.stderr.write(
      `⚡ OpenWolf: ${path.basename(normalizedFile)} was already read this session (~${prev.tokens} tokens). Consider using your existing knowledge of this file.\n`
    );
    session.files_read[normalizedFile].count++;
    session.repeated_reads_warned++;
    writeJSON(sessionFile, session);
    process.exit(0);
    return;
  }

  // Anatomy lookup: O(1) against the durable store, legacy md scan fallback.
  const entry = lookupEntry(wolfDir, normalizePath(projectRoot), normalizedFile);
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

  // Check hippocampus for trauma warnings
  // Use context-aware recall to surface traumas from related files/directories, not just exact matches
  try {
    const hippocampus = new Hippocampus(projectRoot);

    if (hippocampus.exists()) {
      const relativeFile = relativePath;

      // First check exact file match
      const exactTraumas = hippocampus.getTraumas(relativeFile);
      const highIntensityExact = exactTraumas.filter((t) => t.outcome.intensity >= 0.6);

      // Also recall related traumas using parent directory and prefix matching
      // This surfaces traumas from sibling/parent files when working in a context
      const relatedResponse = hippocampus.recall({
        cue: {
          type: "location",
          path: relativeFile,
          match_mode: "parent",
        },
        filters: {
          valence: ["trauma"],
          min_intensity: 0.5,
        },
        limit: 5,
      });

      // Dedupe: combine exact + related, prefer exact matches
      const allTraumas = [...exactTraumas];
      for (const event of relatedResponse.events) {
        if (!allTraumas.some((t) => t.id === event.id)) {
          allTraumas.push(event);
        }
      }

      if (allTraumas.length > 0) {
        const highIntensity = allTraumas
          .filter((t) => t.outcome.intensity >= 0.6)
          .slice(0, 5);

        if (highIntensity.length > 0) {
          const fileLabel = highIntensityExact.length > 0 ? path.basename(absolutePath) : `related in ${path.basename(path.dirname(absolutePath))}`;
          const warnings = highIntensity
            .map((t) => {
              const isExact = highIntensityExact.some((e) => e.id === t.id);
              const prefix = isExact ? "⚠️" : "📌";
              return `${prefix} [${t.outcome.intensity.toFixed(1)}] ${t.outcome.reflection}`;
            })
            .join("\n");

          process.stderr.write(`\n🧠 OpenWolf hippocampus: ${warnings}\n`);
        }
      }
    }
  } catch {
    // Fail silently - hippocampus should not break existing functionality
  }

  // Record initial read entry (tokens will be updated in post-read)
  session.files_read[normalizedFile] = {
    count: 1,
    tokens: 0,
    first_read: new Date().toISOString(),
  };

  writeJSON(sessionFile, session);
  process.exit(0);
}

main().catch(() => process.exit(0));
