import * as path from "node:path";
import { upsertMarkerBlock } from "./markers.js";
import { readSnippet } from "./index.js";
import type { AgentAdapter, AgentInstallContext, AgentInstallResult } from "./types.js";

// Gemini CLI integration (closes #22). Gemini CLI reads GEMINI.md as its
// project context file; it has no lifecycle-hook system comparable to
// Claude Code/Codex, so the protocol instructions carry the integration.
// (Approach from PR #39 by @ChasLui.)

export const geminiAdapter: AgentAdapter = {
  name: "gemini",
  displayName: "Gemini CLI",
  install(ctx: AgentInstallContext): AgentInstallResult {
    const actions: string[] = [];
    if (upsertMarkerBlock(path.join(ctx.projectRoot, "GEMINI.md"), readSnippet(ctx.templatesDir))) {
      actions.push("GEMINI.md updated (OpenWolf block)");
    }
    return { actions, warnings: [] };
  },
};
