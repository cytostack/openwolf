import * as fs from "node:fs";
import * as path from "node:path";
import { upsertMarkerBlock } from "./markers.js";
import { readSnippet } from "./index.js";
import type { AgentAdapter, AgentInstallContext, AgentInstallResult } from "./types.js";

// Antigravity integration. Antigravity discovers project-level hooks from
// <repo>/.agents/hooks.json and reads AGENTS.md (or GEMINI.md) as its project
// context file.
// The lifecycle hooks are connected via .wolf/hooks/antigravity-bridge.js,
// translating between Antigravity's camelCase hook protocol and OpenWolf's
// provider-agnostic hook scripts.

function hookEntry(projectRoot: string, args: string, timeout: number) {
  return {
    type: "command",
    command: `node "${path.join(projectRoot, ".wolf", "hooks", "antigravity-bridge.js")}" ${args}`,
    timeout,
  };
}

function buildAntigravityHooks(projectRoot: string) {
  return {
    openwolf: {
      PreInvocation: [
        hookEntry(projectRoot, "PreInvocation", 5),
      ],
      PreToolUse: [
        {
          matcher: "view_file",
          hooks: [hookEntry(projectRoot, "PreToolUse read", 5)],
        },
        {
          matcher: "write_to_file|replace_file_content",
          hooks: [hookEntry(projectRoot, "PreToolUse write", 5)],
        },
        {
          matcher: "run_command",
          hooks: [hookEntry(projectRoot, "PreToolUse bash", 5)],
        },
      ],
      PostToolUse: [
        {
          matcher: "view_file",
          hooks: [hookEntry(projectRoot, "PostToolUse read", 5)],
        },
        {
          matcher: "write_to_file|replace_file_content",
          hooks: [hookEntry(projectRoot, "PostToolUse write", 10)],
        },
        {
          matcher: "run_command",
          hooks: [hookEntry(projectRoot, "PostToolUse bash", 10)],
        },
      ],
      Stop: [
        hookEntry(projectRoot, "Stop", 10),
      ],
    },
  };
}

export const antigravityAdapter: AgentAdapter = {
  name: "antigravity",
  displayName: "Antigravity",
  install(ctx: AgentInstallContext): AgentInstallResult {
    const actions: string[] = [];
    const warnings: string[] = [];
    const agentsDir = path.join(ctx.projectRoot, ".agents");
    fs.mkdirSync(agentsDir, { recursive: true });

    // 1. Register hooks in .agents/hooks.json
    const hooksPath = path.join(agentsDir, "hooks.json");
    const ours = buildAntigravityHooks(ctx.projectRoot);
    let merged: Record<string, any> = ours;
    let canWriteHooks = true;

    if (fs.existsSync(hooksPath)) {
      let raw: string | null = null;
      let parsed: any = null;
      let failure: string | null = null;
      try {
        raw = fs.readFileSync(hooksPath, "utf-8");
      } catch (err) {
        failure = `could not be read (${err instanceof Error ? err.message : String(err)})`;
      }
      if (raw !== null) {
        try {
          parsed = JSON.parse(raw);
        } catch (err) {
          failure = `is not valid JSON (${err instanceof Error ? err.message : String(err)})`;
        }
      }

      const isObject = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
      if (failure === null && !isObject) {
        failure = "is valid JSON but not a hooks object";
      }

      if (failure !== null) {
        canWriteHooks = false;
        warnings.push(
          `.agents/hooks.json ${failure}. It was left exactly as it is, so OpenWolf hooks are NOT registered for Antigravity. ` +
          `Fix the file (or move it aside) and re-run "openwolf init".`,
        );
      } else {
        // Merge without clobbering user groups
        merged = { ...parsed, openwolf: ours.openwolf };
      }
    }

    if (canWriteHooks) {
      fs.writeFileSync(hooksPath, JSON.stringify(merged, null, 2) + "\n", "utf-8");
      actions.push("Antigravity hooks registered (.agents/hooks.json)");
    }

    // 2. Context file (AGENTS.md, or GEMINI.md if present)
    const contextFile = fs.existsSync(path.join(ctx.projectRoot, "GEMINI.md")) ? "GEMINI.md" : "AGENTS.md";
    if (upsertMarkerBlock(path.join(ctx.projectRoot, contextFile), readSnippet(ctx.templatesDir))) {
      actions.push(`${contextFile} updated (OpenWolf block, Antigravity)`);
    }

    return { actions, warnings };
  },
};
