import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import {
  getWolfDir, ensureWolfDir, readJSON, writeJSON, readStdin, emitHookJSON,
  hookMain, getSessionFilePath, normalizePath, getProjectDir, projectRelativePath
} from "./shared.js";
import {
  classifyCommand, condenseOutput, estimateTokens,
  DEFAULT_GOVERNOR_CONFIG, type GovernorConfig, type GovernorAction
} from "./bash-output-governor.js";
import { parseBashRead } from "./bash-path-parser.js";
import { mutateJSON, HOOK_LOCK_BUDGET_MS } from "./anatomy-lock.js";

// ─────────────────────────────────────────────────────────────────────────────
// PostToolUse[Bash] governor (2.3 flagship). Bash results are 48.3% of all
// tool-result tokens and the >2k-token tail alone is 25.8% of bash output.
// This hook:
//   1. condenses oversized stdout structurally (family-aware) and replaces
//      the tool output via updatedToolOutput, preserving the full text at
//      .wolf/cache/bash/<id>.log — every avoided token is avoided again on
//      every later API call (the 10x-valued kind);
//   2. registers simple bash file reads (cat/head/tail/sed) in files_read,
//      closing the channel where all real duplicate reads happen;
//   3. records original-vs-entered tokens per governed call — ground truth
//      nobody else has (the platform's own telemetry logs pre-hook output).
// stderr is NEVER modified. Test/build families default to suggest, not
// replace, so failure detail is never at risk.
// ─────────────────────────────────────────────────────────────────────────────

function governorConfig(wolfDir: string): GovernorConfig {
  const cfg = readJSON<{ openwolf?: { bash?: { governor?: Partial<GovernorConfig> } } }>(
    path.join(wolfDir, "config.json"), {}
  );
  const user = cfg.openwolf?.bash?.governor ?? {};
  return {
    mode: user.mode ?? DEFAULT_GOVERNOR_CONFIG.mode,
    threshold_tokens: user.threshold_tokens ?? DEFAULT_GOVERNOR_CONFIG.threshold_tokens,
    families: { ...DEFAULT_GOVERNOR_CONFIG.families, ...(user.families ?? {}) },
  };
}

interface GovernedRecord {
  /** Whether the full output is actually recoverable from the cache (#82). */
  preserved?: boolean;
  family: string;
  action: "replaced" | "suggested";
  original_tokens: number;
  entered_tokens: number;
  at: string;
}

interface BashSessionState {
  files_read?: Record<string, { count: number; tokens: number; first_read: string; ranged?: boolean; read_mtime?: number; via_bash?: boolean }>;
  [key: string]: unknown;
}

async function main(): Promise<void> {
  ensureWolfDir();
  const wolfDir = getWolfDir();

  const raw = await readStdin();
  let input: {
    tool_input?: { command?: string };
    tool_response?: { stdout?: string; stderr?: string; [key: string]: unknown };
    tool_use_id?: string;
    session_id?: string;
  };
  try {
    input = JSON.parse(raw);
  } catch {
    return;
  }

  const command = input.tool_input?.command ?? "";
  const resp = input.tool_response;
  const stdout = typeof resp?.stdout === "string" ? resp.stdout : "";
  if (!command || !resp) return;

  const sessionFile = getSessionFilePath(input);
  const notes: string[] = [];

  // ── Bash-channel read registration + dedupe advisory ──────────────────────
  try {
    const read = parseBashRead(command);
    if (read && stdout.length > 0) {
      // Resolve against the same project root the other hooks use, then apply
      // the same lexical containment check. `cat ../other-project/secret.ts`
      // used to be registered in this project's read history: this channel had
      // no project-root check at all.
      const projectDir = getProjectDir();
      const normalized = normalizePath(path.resolve(projectDir, read.file));
      const relToProject = projectRelativePath(projectDir, normalized);
      if (relToProject !== null && relToProject !== "" && !relToProject.startsWith(".wolf/")) {
        let mtime: number | undefined;
        try { mtime = fs.statSync(normalized).mtimeMs; } catch {}
        // Parallel Bash calls each fire this hook. The read has to happen
        // inside the lock or one process's registration overwrites another's
        // (#83) — and `prev` must come from current on-disk state, since the
        // dedupe decision below depends on it.
        mutateJSON<BashSessionState>(sessionFile, {}, HOOK_LOCK_BUDGET_MS, (session) => {
          if (!session.files_read) session.files_read = {};
          const prev = session.files_read[normalized];
          const unchanged = prev?.read_mtime !== undefined && mtime !== undefined && mtime <= prev.read_mtime;
          if (read.full && prev && prev.ranged !== true && unchanged && prev.tokens > 0) {
            notes.push(
              `OpenWolf: ${path.basename(normalized)} was already fully output this session (~${prev.tokens} tok) and is unchanged on disk since.`
            );
            prev.count++;
          } else if (read.full) {
            session.files_read[normalized] = {
              count: (prev?.count ?? 0) + 1,
              tokens: estimateTokens(stdout),
              first_read: prev?.first_read ?? new Date().toISOString(),
              read_mtime: mtime,
              via_bash: true,
            };
          } else if (!prev) {
            session.files_read[normalized] = {
              count: 1, tokens: 0, first_read: new Date().toISOString(), ranged: true, read_mtime: mtime, via_bash: true,
            };
          }
        });
      }
    }
  } catch {}

  // ── Output governor ───────────────────────────────────────────────────────
  const config = governorConfig(wolfDir);
  const originalTokens = estimateTokens(stdout);
  if (config.mode !== "off" && originalTokens >= config.threshold_tokens) {
    const family = classifyCommand(command);
    const action: GovernorAction = config.families[family] ?? "suggest";
    if (action !== "off") {
      const id = (typeof input.tool_use_id === "string" && /^[\w-]+$/.test(input.tool_use_id))
        ? input.tool_use_id
        : crypto.randomBytes(6).toString("hex");
      const logDir = path.join(wolfDir, "cache", "bash");
      const logPath = path.join(logDir, `${id}.log`);
      const relLog = `.wolf/cache/bash/${id}.log`;

      const effectiveAction = config.mode === "suggest" ? "suggest" : action;
      const probe = condenseOutput(family, stdout, config.threshold_tokens, relLog);

      // Preserve the full output, then VERIFY it survived, and only then
      // describe it as preserved. The cache prune runs immediately after the
      // write, and an output bigger than the whole cache budget deletes
      // itself: the hook used to hand the model a pointer to a file that no
      // longer existed, while claiming the bytes were recoverable (#82).
      const preserved = probe ? preserveOutput(logDir, logPath, stdout) : false;
      const result = !probe ? null : preserved
        ? probe
        : condenseOutput(family, stdout, config.threshold_tokens, null);

      // The honest pointer is shorter than the preserving one, so it cannot
      // fail the savings ratio the preserving one already passed. Guard anyway:
      // with no condensation available, letting the output through unchanged is
      // the only option that does not destroy unrecoverable content. Fall
      // through to the notes flush below rather than returning, so an earlier
      // dedupe advisory is not swallowed with it.
      if (probe && result) {
        const record: GovernedRecord = {
          family,
          action: effectiveAction === "replace" ? "replaced" : "suggested",
          original_tokens: result.original_tokens,
          entered_tokens: effectiveAction === "replace" ? result.condensed_tokens : result.original_tokens,
          at: new Date().toISOString(),
          preserved,
        };
        try {
          // Append-to-list: the classic lost-update shape (#83).
          mutateJSON<{ bash_governed?: GovernedRecord[] }>(sessionFile, {}, HOOK_LOCK_BUDGET_MS, (session) => {
            session.bash_governed = [...(session.bash_governed ?? []), record].slice(-200);
          });
        } catch {}

        if (effectiveAction === "replace") {
          // Mirror the received object exactly; change ONLY stdout. A shape
          // mismatch makes the harness silently ignore the replacement.
          emitHookJSON("PostToolUse", {
            updatedToolOutput: { ...resp, stdout: result.text },
            additionalContext: notes.length > 0 ? notes.join("\n") : undefined,
          });
          return;
        }
        const copyNote = preserved
          ? ` A copy is saved at ${relLog}.`
          : " It was too large for the local output cache, so no copy was kept.";
        notes.push(
          `OpenWolf: that ${family.replace("_", " ")} output was ~${result.original_tokens.toLocaleString("en-US")} tokens and now sits in context for the rest of the session.${copyNote} Narrower variants (grep with a file filter, head/tail, git show --stat) produce the same information at a fraction of the cost.`
        );
      }
    }
  }

  if (notes.length > 0) {
    emitHookJSON("PostToolUse", { additionalContext: notes.join("\n") });
  }
}

/**
 * Write the full output to the cache and report whether it is still there
 * afterwards.
 *
 * Issue #82, reported with PR #100 by @davdittrich, which additionally evicts
 * older logs to keep the current one; here an output larger than the whole
 * budget is simply reported as unpreserved.
 *
 * The answer can be no: pruneLogs enforces a 50 MB cache budget, and an output
 * larger than that budget is deleted by the very prune that follows its own
 * write. The cap is a real limit and should win, but the caller must then stop
 * claiming the output was preserved.
 */
function preserveOutput(logDir: string, logPath: string, stdout: string): boolean {
  // An output bigger than the whole cache budget cannot be retained, so do not
  // spend the write and the prune churning 50 MB to disk just to delete it.
  if (Buffer.byteLength(stdout, "utf-8") > CACHE_MAX_BYTES) return false;
  try {
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(logPath, stdout, "utf-8");
  } catch {
    return false;
  }
  pruneLogs(logDir);
  try {
    return fs.statSync(logPath).size === Buffer.byteLength(stdout, "utf-8");
  } catch {
    return false;
  }
}

const CACHE_MAX_FILES = 200;
const CACHE_MAX_BYTES = 50 * 1024 * 1024;

/** Keep the bash log cache bounded (200 files / ~50MB, oldest first). */
function pruneLogs(logDir: string): void {
  try {
    const files = fs.readdirSync(logDir)
      .filter((f) => f.endsWith(".log"))
      .map((f) => {
        const p = path.join(logDir, f);
        const st = fs.statSync(p);
        return { p, mtime: st.mtimeMs, size: st.size };
      })
      .sort((a, b) => b.mtime - a.mtime);
    let total = 0;
    files.forEach((f, i) => {
      total += f.size;
      if (i >= CACHE_MAX_FILES || total > CACHE_MAX_BYTES) {
        try { fs.unlinkSync(f.p); } catch {}
      }
    });
  } catch {}
}

hookMain("post-bash", main);
