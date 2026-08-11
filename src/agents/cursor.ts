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
    fs.writeFileSync(path.join(rulesDir, "openwolf.mdc"), body, "utf-8");
    return { actions: ["Cursor rule installed (.cursor/rules/openwolf.mdc)"], warnings: [] };
  },
};
