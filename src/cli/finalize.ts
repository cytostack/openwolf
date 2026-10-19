import type { Command } from "commander";
import { findProjectRoot } from "../scanner/project-root.js";

// Harnesses without a true, automatic SessionEnd event: their Stop-equivalent
// fires per turn, so the ledger flush and the "Session end" memory.md line
// that SessionEnd normally writes never happen on their own. See docs/hooks.md.
const NO_AUTO_SESSION_END_AGENTS = ["antigravity"];

export function addFinalizeCommand(program: Command): void {
  program
    .command("finalize")
    .description("Manually close a session for a harness with no automatic SessionEnd hook (e.g. Antigravity)")
    .requiredOption("--agent <agent>", `Agent to finalize (${NO_AUTO_SESSION_END_AGENTS.join(", ")})`)
    .option("--session <id>", 'Session id to finalize; defaults to "default", the conversation id the Antigravity bridge uses when none is supplied')
    .action(async (opts: { agent: string; session?: string }) => {
      if (!NO_AUTO_SESSION_END_AGENTS.includes(opts.agent)) {
        throw new Error(`Unknown finalize agent: ${opts.agent}. Only agents without an automatic SessionEnd hook need this command.`);
      }
      const root = findProjectRoot();
      process.env.OPENWOLF_PROJECT_ROOT = root;
      const { finalizeSession } = await import("../hooks/session-end.js");
      // The bridge always sends session_id: conversationId, which defaults
      // to "default" — never the legacy _session.json path that omitting
      // session_id falls back to. Match that default here, or a bare
      // `openwolf finalize --agent antigravity` always reported "no active
      // session state found" (or finalized an unrelated legacy session).
      const hookInput = { session_id: opts.session ?? "default" };
      let result;
      try {
        result = await finalizeSession(hookInput);
      } catch (err) {
        const { recordHeartbeat } = await import("../hooks/shared.js");
        recordHeartbeat("session-end", err);
        throw err;
      }
      // finalizeSession() only does the ledger/memory.md work; mirror the
      // rest of what hookMain() does for a normal session-end hook run
      // (heartbeat + handoff checkpoint observation), since this command
      // bypasses hookMain entirely.
      const { recordHeartbeat } = await import("../hooks/shared.js");
      const { observeCheckpoint } = await import("../hooks/handoff-state.js");
      recordHeartbeat("session-end");
      try {
        observeCheckpoint(root, opts.agent, "session-end", hookInput);
      } catch {}
      console.log(JSON.stringify(result, null, 2));
    });
}
