import * as fs from "node:fs";
import * as path from "node:path";
import { safeCopyFile } from "../utils/fs-safe.js";
import { upsertMarkerBlock } from "./markers.js";
import { readSnippet } from "./index.js";
import type { AgentAdapter, AgentInstallContext, AgentInstallResult } from "./types.js";

// OMP loads standalone project AGENTS.md files as context and discovers native
// hook factories from .omp/hooks/pre|post. The factory bridges OMP's events to
// the provider-agnostic .wolf/hooks/*.js runtime.
export const ompAdapter: AgentAdapter = {
  name: "omp",
  displayName: "Oh My Pi",
  install(ctx: AgentInstallContext): AgentInstallResult {
    const actions: string[] = [];
    const warnings: string[] = [];

    const hookSource = path.join(ctx.templatesDir, "omp-hooks", "openwolf.ts");
    const hookPath = path.join(ctx.projectRoot, ".omp", "hooks", "pre", "openwolf.ts");
    if (!fs.existsSync(hookSource)) {
      warnings.push("OMP hook template is missing; native OMP hooks were not registered");
    } else if (fs.existsSync(hookPath)) {
      const existing = fs.readFileSync(hookPath, "utf-8");
      const template = fs.readFileSync(hookSource, "utf-8");
      if (existing !== template) {
        warnings.push(".omp/hooks/pre/openwolf.ts is customized; it was left untouched");
      } else {
        safeCopyFile(hookSource, hookPath);
        actions.push("OMP hooks refreshed (.omp/hooks/pre/openwolf.ts)");
      }
    } else {
      safeCopyFile(hookSource, hookPath);
      actions.push("OMP hooks registered (.omp/hooks/pre/openwolf.ts)");
    }

    if (upsertMarkerBlock(path.join(ctx.projectRoot, "AGENTS.md"), readSnippet(ctx.templatesDir))) {
      actions.push("AGENTS.md updated (OpenWolf block for OMP)");
    }
    return { actions, warnings };
  },
};
