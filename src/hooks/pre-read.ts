import * as fs from "node:fs";
import * as path from "node:path";
import {
  getWolfDir, ensureWolfDir, readJSON, writeJSON,
  estimateTokens, readStdin, normalizePath, getProjectDir, emitHookJSON, recordInjection,
  hookMain, getSessionFilePath, readSessionState
} from "./shared.js";
import { lookupEntry } from "./anatomy-store.js";

interface FileRead {
  count: number;
  tokens: number;
  first_read: string;
  read_mtime?: number;
  anatomy_hit?: boolean;
  /** True when only ranged (offset/limit) reads have touched this file — a
   * later full read is legitimate, never a duplicate. */
  ranged?: boolean;
  /** Duplicate denial already spent for this file (one-shot guarantee). */
  denied_once?: boolean;
  /** Set when compaction evicted file contents from context — deny would be wrong. */
  compacted?: boolean;
}

interface SessionData {
  session_id: string;
  files_read: Record<string, FileRead>;
  anatomy_hits: number;
  anatomy_misses: number;
  repeated_reads_warned: number;
  reads_denied?: number;
  denied_tokens_saved?: number;
  [key: string]: unknown;
}

type DuplicateMode = "warn" | "deny" | "off";

function duplicateMode(wolfDir: string): DuplicateMode {
  const cfg = readJSON<{ openwolf?: { reads?: { duplicate_mode?: string } } }>(
    path.join(wolfDir, "config.json"), {}
  );
  const mode = cfg.openwolf?.reads?.duplicate_mode;
  return mode === "deny" || mode === "off" ? mode : "warn";
}

function skeletonHintsEnabled(wolfDir: string): boolean {
  const cfg = readJSON<{ openwolf?: { reads?: { skeleton_hints?: boolean } } }>(
    path.join(wolfDir, "config.json"), {}
  );
  return cfg.openwolf?.reads?.skeleton_hints !== false;
}

async function main(): Promise<void> {
  ensureWolfDir();
  const wolfDir = getWolfDir();

  const raw = await readStdin();
  let input: {
    tool_input?: { file_path?: string; path?: string; offset?: number; limit?: number };
    agent_id?: string;
    agent_type?: string;
    session_id?: string;
  };
  try {
    input = JSON.parse(raw);
  } catch {
    return;
  }
  const sessionFile = getSessionFilePath(input);

  const filePath = input.tool_input?.file_path ?? input.tool_input?.path ?? "";
  if (!filePath) { return; }

  // Ranged reads (offset/limit) are exactly what the symbol hints steer the
  // model toward — never warn about, deny, or record them as full reads (a
  // ranged first contact must not make a later legitimate full read look like
  // a duplicate).
  const isRangedRead = input.tool_input?.offset !== undefined || input.tool_input?.limit !== undefined;
  // Subagents share this session file but not the main thread's context: a
  // file the main thread read is unseen by a fresh subagent, so duplicate
  // handling stays hands-off for them.
  const isSubagent = typeof input.agent_id === "string" && input.agent_id.length > 0;

  const normalizedFile = normalizePath(filePath);

  // Skip tracking for .wolf/ internal files — they're infrastructure, not project files.
  // Counting them inflates anatomy miss rates since .wolf/ is excluded from anatomy scanning.
  const projectDir = normalizePath(getProjectDir());
  const relToProject = normalizedFile.startsWith(projectDir)
    ? normalizedFile.slice(projectDir.length).replace(/^\//, "")
    : "";
  if (relToProject.startsWith(".wolf/") || relToProject.startsWith(".wolf\\")) {
    // 2.4: .wolf reads used to be invisible to OpenWolf itself (~147k tokens
    // of unmeasured self-inflicted reads, including whole-file reads of the
    // two files the rules say never to read whole). Measure them (tagged
    // separately so anatomy metrics stay clean) and steer the expensive
    // pattern to the cheap one, once per file per session.
    try {
      const base = path.basename(normalizedFile);
      const isRanged = input.tool_input?.offset !== undefined || input.tool_input?.limit !== undefined;
      if (!isRanged && (base === "anatomy.md" || base === "cerebrum.md" || base === "memory.md")) {
        let sizeTokens = 0;
        try { sizeTokens = Math.ceil(fs.statSync(filePath).size / 3.5); } catch {}
        if (sizeTokens > 1500) {
          const session = readSessionState(sessionFile, input.session_id) as SessionData;
          const warned = (session.wolf_read_advised ?? {}) as Record<string, boolean>;
          if (!warned[base]) {
            warned[base] = true;
            session.wolf_read_advised = warned;
            const note = base === "anatomy.md"
              ? `OpenWolf: ${base} is ~${sizeTokens} tokens and is an index, not a document. \`openwolf find <symbol or path>\` answers location queries in under 1k tokens; grep it for a single path's line otherwise.`
              : `OpenWolf: ${base} is ~${sizeTokens} tokens. Grep the section you need (for example "## Do-Not-Repeat") or read with offset/limit; the whole file rarely pays for itself.`;
            recordInjection(session, "wolf_read_advice", note);
            writeJSON(sessionFile, session);
            emitHookJSON("PreToolUse", { additionalContext: note });
          }
        }
      }
    } catch {}
    return;
  }

  const session = readSessionState(sessionFile, input.session_id) as SessionData;

  if (isRangedRead) {
    // Record the contact so dedupe knows about it, but flagged: a ranged
    // first contact must never make a later full read look like a duplicate
    // (the old asymmetry with post-read inflated warnings ~20x).
    if (!session.files_read[normalizedFile]) {
      session.files_read[normalizedFile] = {
        count: 1, tokens: 0, first_read: new Date().toISOString(), ranged: true,
      };
      writeJSON(sessionFile, session);
    }
    return;
  }

  // Model-visible notes for this run — flushed as ONE additionalContext at exit.
  const notes: string[] = [];

  // Check if already read this session. Only a prior FULL read counts —
  // ranged-only contact means the model has never seen the whole file.
  if (session.files_read[normalizedFile] && session.files_read[normalizedFile].ranged !== true) {
    const prev = session.files_read[normalizedFile];
    let modifiedSinceRead = true;
    try {
      const mtime = fs.statSync(filePath).mtimeMs;
      modifiedSinceRead = prev.read_mtime === undefined || mtime > prev.read_mtime;
    } catch {}
    if (!modifiedSinceRead) {
      const mode = duplicateMode(wolfDir);
      session.repeated_reads_warned++;

      // Denial is the only path that actually saves the tokens, but it must
      // never strand the model: full reads only (ranged reads exited above),
      // main thread only, only when the earlier read verifiably delivered
      // content (tokens > 0), never after a compaction evicted that content,
      // and only ONCE per file per session — the next attempt passes through.
      const denyEligible =
        mode === "deny" && !isSubagent && prev.tokens > 0 &&
        prev.denied_once !== true && prev.compacted !== true;

      if (denyEligible) {
        prev.denied_once = true;
        session.reads_denied = (session.reads_denied ?? 0) + 1;
        session.denied_tokens_saved = (session.denied_tokens_saved ?? 0) + prev.tokens;
        const reason = `OpenWolf: ${path.basename(normalizedFile)} was already read this session (~${prev.tokens} tok) and is unchanged on disk. Reuse your earlier read, or use offset/limit for the exact lines you need. If you do need the full file again, a second attempt will pass through.`;
        recordInjection(session, "dup_deny", reason);
        writeJSON(sessionFile, session);
        emitHookJSON("PreToolUse", {
          permissionDecision: "deny",
          permissionDecisionReason: reason,
        });
        return;
      }

      prev.count++;
      if (mode !== "off") {
        notes.push(
          `OpenWolf: ${path.basename(normalizedFile)} was already read this session (~${prev.tokens} tok), unchanged since. If you only need the gist, your earlier read may suffice; for exact text (edit anchors, line numbers), the re-read is fine.`
        );
      }
      if (notes.length > 0) recordInjection(session, "dup_warn", notes.join("\n"));
      writeJSON(sessionFile, session);
      if (notes.length > 0) {
        emitHookJSON("PreToolUse", { additionalContext: notes.join("\n") });
      }
      return;
    }
    delete session.files_read[normalizedFile];
  }

  // Anatomy lookup: O(1) against the durable store, legacy md scan fallback.
  const entry = lookupEntry(wolfDir, projectDir, normalizedFile);
  const found = entry !== null;
  if (entry) {
    if (entry.description) {
      notes.push(`OpenWolf anatomy: ${entry.file}: ${entry.description} (~${entry.tokens} tok)`);
    }

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
        // J2 skeleton hint: for big files with an indexed signature outline,
        // the outline replaces the "largest sections" line — often enough to
        // skip the full read entirely. Config-gated (reads.skeleton_hints).
        if (entry.skeleton && entry.tokens > 2000 && skeletonHintsEnabled(wolfDir)) {
          notes.push(
            `Signature outline of ${entry.file} (~${entry.tokens} tok full; symbols with line ranges follow):\n${entry.skeleton}\nRead with offset/limit to fetch just the part you need.`
          );
        } else {
          const top = [...entry.symbols].sort((a, b) => b.tokens - a.tokens).slice(0, 5);
          const list = top.map((s) => `${s.kind} ${s.name} L${s.startLine}-${s.endLine} ~${s.tokens} tok`).join("; ");
          notes.push(`Largest sections: ${list}. Read with offset/limit to fetch just the part you need.`);
        }
      }
    }
  }

  if (found) {
    session.anatomy_hits++;
  } else {
    session.anatomy_misses++;
  }

  // Record initial read entry (tokens will be updated in post-read)
  let readMtime: number | undefined;
  try {
    readMtime = fs.statSync(filePath).mtimeMs;
  } catch {}
  session.files_read[normalizedFile] = {
    count: 1,
    tokens: 0,
    first_read: new Date().toISOString(),
    read_mtime: readMtime,
    anatomy_hit: found,
  };

  if (notes.length > 0) recordInjection(session, "anatomy_hint", notes.join("\n"));
  writeJSON(sessionFile, session);
  if (notes.length > 0) {
    emitHookJSON("PreToolUse", { additionalContext: notes.join("\n") });
  }
}

hookMain("pre-read", main);
