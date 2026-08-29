import * as fs from "node:fs";
import * as path from "node:path";
import { getWolfDir, ensureWolfDir, readJSON, writeJSON, countSemanticEntries, readStdin, hookMain, getSessionFilePath } from "./shared.js";
import { buildSessionEntry, flushSessionToLedger, type SessionData } from "./ledger.js";
import { verifyHookDelivery } from "./hook-attachments.js";
import { mutateJSON, HOOK_LOCK_BUDGET_MS } from "./anatomy-lock.js";

async function main(): Promise<void> {
  ensureWolfDir();
  const wolfDir = getWolfDir();

  // Stop payload → transcript path for real usage measurement (F1)
  let hookInput: { transcript_path?: string; session_id?: string } = {};
  try {
    hookInput = JSON.parse(await readStdin());
  } catch {}
  const sessionFile = getSessionFilePath(hookInput);

  // All session mutation happens in ONE serialized transaction, and the ledger
  // flush below runs on its result AFTER the lock is released: reading a large
  // transcript with the session lock held would stall every parallel hook.
  // stop_count, reminders_sent, and pending_reminders are all counters or
  // append/test-and-set state, so an unlocked read-modify-write loses them (#83).
  const session = mutateJSON<SessionData>(sessionFile, {
    session_id: "",
    started: "",
    files_read: {},
    files_written: [],
    edit_counts: {},
    anatomy_hits: 0,
    anatomy_misses: 0,
    repeated_reads_warned: 0,
    stop_count: 0,
    reminders_sent: {},
  }, HOOK_LOCK_BUDGET_MS, (s) => {
    s.stop_count++;

    // Nothing happened this turn: bump the counter and stop there.
    if (Object.keys(s.files_read ?? {}).length === 0 && (s.files_written ?? []).length === 0) return;

    // Collect end-of-turn reminders. Each fires at most ONCE per session, and
    // they are QUEUED rather than emitted: Stop additionalContext forces a full
    // continuation turn (the model re-sends the whole conversation to respond),
    // so the UserPromptSubmit hook drains the queue into the next user turn's
    // context instead — same visibility, zero extra turns.
    if (!s.reminders_sent) s.reminders_sent = {};
    const reminderChecks: Array<[string, string | null]> = [
      ["buglog", checkForMissingBugLogs(wolfDir, s)],
      ["cerebrum", checkCerebrumFreshness(wolfDir, s)],
      ["semantic", checkSemanticSummaries(wolfDir, s)],
    ];
    const reminders: string[] = [];
    for (const [key, message] of reminderChecks) {
      if (message === null) continue;
      const sent = s.reminders_sent[key] ?? 0;
      if (sent >= 1) continue;
      s.reminders_sent[key] = sent + 1;
      reminders.push(message);
    }
    if (reminders.length > 0) {
      if (!s.pending_reminders) s.pending_reminders = [];
      s.pending_reminders.push(
        `OpenWolf end-of-turn reminders:\n${reminders.map((r) => `- ${r}`).join("\n")}`
      );
    }
  });

  // Lock contention beyond budget: skip this turn's ledger flush. The flush is
  // idempotent per session id, so the next Stop converges the state.
  if (session === null) return;

  // Only write to the ledger if there has been activity.
  if (Object.keys(session.files_read ?? {}).length === 0 && (session.files_written ?? []).length === 0) return;

  // Idempotent ledger write: the entry for this session id is REPLACED, not
  // appended — Stop fires every turn, and appending per turn is what used to
  // duplicate sessions and quadratically inflate lifetime totals.
  const entry = buildSessionEntry(session, hookInput.transcript_path);

  // Verified delivery (2.2): the transcript records every hook invocation as
  // an attachment line; that is ground truth for what fired, failed, and what
  // context actually reached the model — self-reported counters are estimates.
  if (hookInput.transcript_path) {
    const verified = verifyHookDelivery(hookInput.transcript_path);
    if (verified) entry.verified = verified;
  }

  flushSessionToLedger(wolfDir, entry);
}

/**
 * Check if files were edited multiple times but buglog.json wasn't updated.
 * Returns a reminder string if action is needed, otherwise null.
 */
function checkForMissingBugLogs(wolfDir: string, session: SessionData): string | null {
  if (!session.edit_counts) return null;

  const multiEditFiles = Object.entries(session.edit_counts)
    .filter(([, count]) => count >= 3)
    .map(([file]) => path.basename(file));

  if (multiEditFiles.length === 0) return null;

  let buglogWritten = false;
  try {
    const stat = fs.statSync(path.join(wolfDir, "buglog.json"));
    const sessionStartMs = session.started ? Date.parse(session.started) : 0;
    buglogWritten = sessionStartMs > 0 && stat.mtimeMs >= sessionStartMs;
  } catch {}

  if (!buglogWritten) {
    return `ACTION REQUIRED: Files edited 3+ times this session (${multiEditFiles.join(", ")}) but buglog.json was not updated. Log the bug fixes to .wolf/buglog.json now.`;
  }
  return null;
}

/**
 * Check if STATUS.md is older than the session start AND there was meaningful
 * code activity (3+ writes outside .wolf/). If so, nudge Claude to update
 * STATUS.md so the next /clear has fresh handoff context.
 */
// (The STATUS.md staleness nag was removed in 2.1: STATUS.md is regenerated
// on demand by the /handoff skill instead of being nagged about every turn.)

/**
 * Check if cerebrum.md was updated recently. If it hasn't been updated in
 * a while and there was significant activity, return a reminder.
 */
function checkCerebrumFreshness(wolfDir: string, session: SessionData): string | null {
  const cerebrumPath = path.join(wolfDir, "cerebrum.md");
  try {
    const stat = fs.statSync(cerebrumPath);
    const hoursSinceUpdate = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60);

    if (hoursSinceUpdate > 24 && session.files_written.length >= 3) {
      return `ACTION REQUIRED: cerebrum.md hasn't been updated in ${Math.floor(hoursSinceUpdate)}h and ${session.files_written.length} files were modified. Update .wolf/cerebrum.md with any new user preferences, conventions, or gotchas discovered this session.`;
    }
  } catch {
    // cerebrum.md doesn't exist, that's ok
  }
  return null;
}

/**
 * Check if a semantic summary was written to memory.md this session.
 * Returns a reminder string if action is needed, otherwise null.
 */
function checkSemanticSummaries(wolfDir: string, session: SessionData): string | null {
  const writeCount = session.files_written.length;
  if (writeCount < 2) return null;

  const semanticCount = countSemanticEntries(wolfDir);
  if (semanticCount === 0) {
    return `ACTION REQUIRED: ${writeCount} files were modified this session but no semantic summary was written to memory.md. Append a one-line summary: | HH:MM | description | file(s) | outcome | ~tokens |`;
  }
  return null;
}

// Run only when executed as a hook script — never on import (tests import
// from this module, and main() exits the process).
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  hookMain("stop", main);
}
