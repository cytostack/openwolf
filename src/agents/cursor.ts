import * as fs from "node:fs";
import * as path from "node:path";
import { readSnippet } from "./index.js";
import type { AgentAdapter, AgentInstallContext, AgentInstallResult } from "./types.js";

// Cursor integration (closes #12). Cursor reads project rules from
// .cursor/rules/*.mdc; `alwaysApply: true` injects the OpenWolf protocol
// into every conversation for this project.

export const cursorAdapter: AgentAdapter = {
  name: "cursor",
  displayName: "Cursor",
  install(ctx: AgentInstallContext): AgentInstallResult {
    const rulesDir = path.join(ctx.projectRoot, ".cursor", "rules");
    fs.mkdirSync(rulesDir, { recursive: true });
    const body = `---
description: OpenWolf project protocol (context management via .wolf/)
alwaysApply: true
---

${readSnippet(ctx.templatesDir).trim()}
`;
    const rulePath = path.join(rulesDir, "openwolf.mdc");
    // Overwrite only a file that is still recognizably ours (unchanged
    // OpenWolf frontmatter); a user-customized rule is left alone.
    if (fs.existsSync(rulePath)) {
      const existing = fs.readFileSync(rulePath, "utf-8");
      const stillOurs = existing.includes("description: OpenWolf project protocol");
      if (!stillOurs && existing !== body) {
        return {
          actions: ["Cursor rule left untouched (customized): .cursor/rules/openwolf.mdc"],
          warnings: [],
        };
      }
    }
    fs.writeFileSync(rulePath, body, "utf-8");
    return { actions: ["Cursor rule installed (.cursor/rules/openwolf.mdc)"], warnings: [] };
  },
};
