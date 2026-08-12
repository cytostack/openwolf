import * as path from "node:path";
import { upsertMarkerBlock } from "./markers.js";
import { readSnippet } from "./index.js";
import type { AgentAdapter, AgentInstallContext, AgentInstallResult } from "./types.js";

// Antigravity integration (beta). Antigravity reads AGENTS.md as its project
// context file, so the OpenWolf protocol block there carries the integration.
// Context-level like Gemini and Cursor: no dedicated lifecycle hooks yet.

export const antigravityAdapter: AgentAdapter = {
  name: "antigravity",
  displayName: "Antigravity",
  install(ctx: AgentInstallContext): AgentInstallResult {
    const actions: string[] = [];
    if (upsertMarkerBlock(path.join(ctx.projectRoot, "AGENTS.md"), readSnippet(ctx.templatesDir))) {
      actions.push("AGENTS.md updated (OpenWolf block, Antigravity beta)");
    }
    return { actions, warnings: [] };
  },
};
