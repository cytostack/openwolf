import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import {
  getWolfDir, ensureWolfDir, readJSON, writeJSON, readStdin, emitHookJSON,
  hookMain, getSessionFilePath, normalizePath, readSessionState
} from "./shared.js";
import {
  classifyCommand, condenseOutput, estimateTokens,
  DEFAULT_GOVERNOR_CONFIG, type GovernorConfig, type GovernorAction
} from "./bash-output-governor.js";
import { parseBashRead } from "./bash-path-parser.js";

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
  family: string;
  action: "replaced" | "suggested";
  original_tokens: number;
  entered_tokens: number;
  at: string;
}

async function main(): Promise<void> {
  ensureWolfDir();
  const wolfDir = getWolfDir();

  const raw = await readStdin();
  let input: {
    tool_input?: { command?: string };
    tool_response?: string | { stdout?: string; stderr?: string; [key: string]: unknown };
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
  const stdout = typeof resp === "string" ? resp : typeof resp?.stdout === "string" ? resp.stdout : "";
  if (!command || !resp) return;

  const sessionFile = getSessionFilePath(input);
  const notes: string[] = [];

  // ── Bash-channel read registration + dedupe advisory ──────────────────────
  try {
    const read = parseBashRead(command);
    if (read && stdout.length > 0) {
      const normalized = normalizePath(path.isAbsolute(read.file) ? read.file : path.resolve(process.cwd(), read.file));
      if (!normalized.includes("/.wolf/")) {
        const session = readSessionState(sessionFile, input.session_id) as {
          files_read?: Record<string, { count: number; tokens: number; first_read: string; ranged?: boolean; read_mtime?: number; via_bash?: boolean }>;
        };
        if (!session.files_read) session.files_read = {};
        const prev = session.files_read[normalized];
        let unchanged = false;
        let mtime: number | undefined;
        try {
          mtime = fs.statSync(normalized).mtimeMs;
          unchanged = prev?.read_mtime !== undefined && mtime <= prev.read_mtime!;
        } catch {}
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
        writeJSON(sessionFile, session);
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
      const result = condenseOutput(family, stdout, config.threshold_tokens, relLog);

      if (result) {
        // Preserve the full output regardless of action: the pointer (or the
        // suggestion) must always be honest about where the bytes live.
        try {
          fs.mkdirSync(logDir, { recursive: true });
          fs.writeFileSync(logPath, stdout, "utf-8");
          pruneLogs(logDir);
        } catch {}

        const record: GovernedRecord = {
          family,
          action: effectiveAction === "replace" ? "replaced" : "suggested",
          original_tokens: result.original_tokens,
          entered_tokens: effectiveAction === "replace" ? result.condensed_tokens : result.original_tokens,
          at: new Date().toISOString(),
        };
        try {
          const session = readSessionState(sessionFile, input.session_id) as { bash_governed?: GovernedRecord[] };
          session.bash_governed = [...(session.bash_governed ?? []), record].slice(-200);
          writeJSON(sessionFile, session);
        } catch {}

        if (effectiveAction === "replace") {
          // Preserve the received response shape. A mismatch makes the
          // harness silently ignore the replacement.
          emitHookJSON("PostToolUse", {
            updatedToolOutput: typeof resp === "string" ? result.text : { ...resp, stdout: result.text },
            additionalContext: notes.length > 0 ? notes.join("\n") : undefined,
          });
          return;
        }
        notes.push(
          `OpenWolf: that ${family.replace("_", " ")} output was ~${result.original_tokens.toLocaleString("en-US")} tokens and now sits in context for the rest of the session. A copy is saved at ${relLog}. Narrower variants (grep with a file filter, head/tail, git show --stat) produce the same information at a fraction of the cost.`
        );
      }
    }
  }

  if (notes.length > 0) {
    emitHookJSON("PostToolUse", { additionalContext: notes.join("\n") });
  }
}

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
      if (i >= 200 || total > 50 * 1024 * 1024) {
        try { fs.unlinkSync(f.p); } catch {}
      }
    });
  } catch {}
}

hookMain("post-bash", main);
