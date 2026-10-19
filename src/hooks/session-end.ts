import { mutateJSON, HOOK_LOCK_BUDGET_MS } from "./anatomy-lock.js";
import { reconcileReads } from "./event-journal.js";
import * as path from "node:path";
import { getWolfDir, ensureWolfDir, readJSON, appendMarkdown, timeShort, readStdin, hookMain, getSessionFilePath, realpathOrSelf } from "./shared.js";
import { buildSessionEntry, flushSessionToLedger, type SessionData } from "./ledger.js";
import { verifyHookDelivery } from "./hook-attachments.js";

// SessionEnd hook: final ledger flush + the single "Session end" line in
// memory.md. Fires on clear/logout/exit (not on SIGKILL — the per-turn Stop
// upsert already left a correct ledger entry for that case). Writing the
// memory line here instead of on every Stop is what keeps memory.md from
// growing one summary line per turn.

export interface FinalizeResult {
  finalized: boolean;
  reason?: string;
  session_id?: string;
}

/**
 * Core SessionEnd logic, shared by the hook entry point (below) and the
 * `openwolf finalize` CLI command. The CLI command exists for harnesses like
 * Antigravity whose Stop event fires every turn but that expose no separate,
 * automatic session-end event — see docs/hooks.md.
 */
export async function finalizeSession(hookInput: { transcript_path?: string; reason?: string; session_id?: string } = {}): Promise<FinalizeResult> {
  ensureWolfDir();
  const wolfDir = getWolfDir();
  const sessionFile = getSessionFilePath(hookInput);

  reconcileReads(sessionFile);
  const session = readJSON<SessionData | null>(sessionFile, null);
  if (!session || !session.session_id) {
    return { finalized: false, reason: "no active session state found for this session id" };
  }

  let firstEnd = false;
  mutateJSON<Record<string, unknown>>(sessionFile, {}, HOOK_LOCK_BUDGET_MS, state => {
    firstEnd = !state.ended;
    state.ended = state.ended ?? new Date().toISOString();
  });
  const readCount = Object.keys(session.files_read ?? {}).length;
  const writeCount = (session.files_written ?? []).length;
  if (readCount === 0 && writeCount === 0) {
    return { finalized: false, reason: "no recorded activity this session", session_id: session.session_id };
  }

  const entry = buildSessionEntry(session, hookInput.transcript_path);
  if (hookInput.transcript_path) {
    const verified = verifyHookDelivery(hookInput.transcript_path);
    if (verified) entry.verified = verified;
  }
  flushSessionToLedger(wolfDir, entry);

  if (writeCount > 0 && firstEnd) {
    try {
      const uniqueFiles = new Set(session.files_written.map((w) => path.basename(w.file)));
      const fileList = [...uniqueFiles].slice(0, 5).join(", ");
      const tokens = entry.totals.input_tokens_estimated + entry.totals.output_tokens_estimated;
      appendMarkdown(
        path.join(wolfDir, "memory.md"),
        `| ${timeShort()} | Session end: ${writeCount} writes across ${uniqueFiles.size} files (${fileList}) | ${readCount} reads | ~${tokens} tok |\n`
      );
    } catch {}
  }

  return { finalized: firstEnd, session_id: session.session_id, reason: firstEnd ? undefined : "session was already finalized" };
}

async function main(): Promise<void> {
  let hookInput: { transcript_path?: string; reason?: string; session_id?: string } = {};
  try {
    hookInput = JSON.parse(await readStdin());
  } catch {}
  await finalizeSession(hookInput);
}

// Run only when executed as a hook script — never on import (the CLI's
// `finalize` command imports finalizeSession() directly, and must not also
// trigger the stdin-reading hook runner as a side effect of that import).
// Compared via realpath: a symlink anywhere in the project path (e.g. a
// linked work directory) would otherwise make argv[1] never match
// import.meta.url and silently disable SessionEnd entirely.
import { fileURLToPath } from "node:url";
if (process.argv[1] && realpathOrSelf(process.argv[1]) === realpathOrSelf(fileURLToPath(import.meta.url))) {
  hookMain("session-end", main);
}
