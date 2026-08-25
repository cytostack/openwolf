import * as path from "node:path";
import { ensureWolfDir, writeJSON, emitHookJSON, recordInjection, readStdin, hookMain, getSessionFilePath, readSessionState } from "./shared.js";

// UserPromptSubmit hook: drains reminders the Stop hook queued last turn.
//
// Why here and not in the Stop hook itself: Stop-level additionalContext is
// "feedback that continues the conversation" — every reminder would force a
// full extra model turn. Delivering the same text alongside the user's next
// prompt costs zero extra turns and the model still sees it before acting.

interface SessionData {
  pending_reminders?: string[];
  [key: string]: unknown;
}

async function main(): Promise<void> {
  ensureWolfDir();
  let input: { session_id?: string } = {};
  try {
    input = JSON.parse(await readStdin());
  } catch {}
  const sessionFile = getSessionFilePath(input);
  const session = readSessionState(sessionFile, input.session_id) as SessionData;
  const pending = session.pending_reminders ?? [];
  if (pending.length === 0) {
    return;
  }
  session.pending_reminders = [];
  recordInjection(session, "reminders", pending.join("\n\n"));
  writeJSON(sessionFile, session);
  emitHookJSON("UserPromptSubmit", { additionalContext: pending.join("\n\n") });
}

hookMain("user-prompt-submit", main);
