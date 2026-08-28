import * as fs from "node:fs";
import * as path from "node:path";
import { safeCopyFile } from "../utils/fs-safe.js";
import { upsertMarkerBlock } from "./markers.js";
import { readSnippet } from "./index.js";
import type { AgentAdapter, AgentInstallContext, AgentInstallResult } from "./types.js";

// Kilo is an OpenCode fork. It loads plugins from .kilo/plugin/*.ts with a
// non-recursive glob, so we install the multi-file plugin under
// .kilo/plugin/openwolf/ plus a top-level default-export entry. Do not reuse
// OpenCode's `export { OpenWolf }` — Kilo's loader requires `mod.default.server`.

const ENTRY = `// OpenWolf plugin entry — installed by \`openwolf init --agent kilo\`.
import { server } from "./openwolf/index.js"
export default { id: "openwolf", server }
`;

export const kiloAdapter: AgentAdapter = {
  name: "kilo",
  displayName: "Kilo",
  install(ctx: AgentInstallContext): AgentInstallResult {
    const actions: string[] = [];
    const warnings: string[] = [];

    const pluginSrcDir = path.join(ctx.templatesDir, "kilo-plugin");
    if (!fs.existsSync(pluginSrcDir)) {
      warnings.push("kilo-plugin templates missing from the OpenWolf install — plugin not written");
      return { actions, warnings };
    }

    const pluginDir = path.join(ctx.projectRoot, ".kilo", "plugin");
    const destDir = path.join(pluginDir, "openwolf");
    fs.mkdirSync(destDir, { recursive: true });
    for (const file of fs.readdirSync(pluginSrcDir)) {
      if (!file.endsWith(".ts")) continue;
      safeCopyFile(path.join(pluginSrcDir, file), path.join(destDir, file));
    }
    fs.writeFileSync(path.join(pluginDir, "openwolf.ts"), ENTRY, "utf-8");
    actions.push("Kilo plugin installed (.kilo/plugin/openwolf.ts)");

    if (upsertMarkerBlock(path.join(ctx.projectRoot, "AGENTS.md"), readSnippet(ctx.templatesDir))) {
      actions.push("AGENTS.md updated (OpenWolf block)");
    }

    return { actions, warnings };
  },
};
