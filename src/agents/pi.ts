import * as path from "node:path";
import { upsertMarkerBlock } from "./markers.js";
import { readSnippet } from "./index.js";
import type { AgentAdapter, AgentInstallContext, AgentInstallResult } from "./types.js";

// Pi loads project AGENTS.md files as startup context. Project skills are
// installed by the shared skills installer under .agents/skills/.
export const piAdapter: AgentAdapter = {
  name: "pi",
  displayName: "Pi",
  install(ctx: AgentInstallContext): AgentInstallResult {
    const actions: string[] = [];
    if (upsertMarkerBlock(path.join(ctx.projectRoot, "AGENTS.md"), readSnippet(ctx.templatesDir))) {
      actions.push("AGENTS.md updated (OpenWolf block for Pi)");
    }
    return { actions, warnings: [] };
  },
};
