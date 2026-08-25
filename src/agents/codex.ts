import * as fs from "node:fs";
import * as path from "node:path";
import { upsertMarkerBlock } from "./markers.js";
import { readSnippet } from "./index.js";
import type { AgentAdapter, AgentInstallContext, AgentInstallResult } from "./types.js";

// Codex integration, adapted from PR #36 by @nottyjay (closes #2).
// Codex discovers project-level hooks from <repo>/.codex/hooks.json when
// `[features] hooks = true` is set, and reads AGENTS.md as its context file.
// The hook scripts themselves are the same provider-agnostic .wolf/hooks/*.js
// used for Claude Code (they resolve the project root via getProjectDir()).

function hookEntry(projectRoot: string, script: string, timeout: number, statusMessage: string) {
  return {
    type: "command",
    command: `node "${path.join(projectRoot, ".wolf", "hooks", script)}"`,
    timeout,
    statusMessage,
  };
}

function buildCodexHooks(projectRoot: string) {
  return {
    hooks: {
      SessionStart: [
        { matcher: "startup|resume|clear", hooks: [hookEntry(projectRoot, "session-start.js", 5, "OpenWolf session bootstrap")] },
      ],
      PreToolUse: [
        { matcher: "Read", hooks: [hookEntry(projectRoot, "pre-read.js", 5, "OpenWolf read precheck")] },
        { matcher: "Bash", hooks: [hookEntry(projectRoot, "pre-bash.js", 5, "OpenWolf Bash precheck")] },
        { matcher: "Edit|Write|MultiEdit|apply_patch", hooks: [hookEntry(projectRoot, "pre-write.js", 5, "OpenWolf write precheck")] },
      ],
      PostToolUse: [
        { matcher: "Read", hooks: [hookEntry(projectRoot, "post-read.js", 5, "OpenWolf read tracking")] },
        { matcher: "Bash", hooks: [hookEntry(projectRoot, "post-bash.js", 10, "OpenWolf Bash tracking")] },
        { matcher: "Edit|Write|MultiEdit|apply_patch", hooks: [hookEntry(projectRoot, "post-write.js", 10, "OpenWolf anatomy update")] },
      ],
      PreCompact: [
        { matcher: "", hooks: [hookEntry(projectRoot, "precompact.js", 5, "OpenWolf compaction snapshot")] },
      ],
      Stop: [
        { matcher: "", hooks: [hookEntry(projectRoot, "stop.js", 10, "OpenWolf session wrap-up")] },
      ],
    },
  };
}

export const codexAdapter: AgentAdapter = {
  name: "codex",
  displayName: "Codex CLI",
  install(ctx: AgentInstallContext): AgentInstallResult {
    const actions: string[] = [];
    const warnings: string[] = [];
    const codexDir = path.join(ctx.projectRoot, ".codex");
    fs.mkdirSync(codexDir, { recursive: true });

    // 1. Register hooks. MERGE with any existing hooks.json: the file may
    // carry the user's own hooks, and a blind overwrite clobbered them.
    // OpenWolf entries are recognized by their .wolf/hooks/ command path and
    // replaced; everything else is preserved.
    const hooksPath = path.join(codexDir, "hooks.json");
    const ours = buildCodexHooks(ctx.projectRoot);
    let merged: { hooks: Record<string, unknown[]> } = ours;
    try {
      if (fs.existsSync(hooksPath)) {
        const existing = JSON.parse(fs.readFileSync(hooksPath, "utf-8")) as { hooks?: Record<string, unknown[]> };
        if (existing && typeof existing === "object" && existing.hooks) {
          const isOurs = (matcherEntry: unknown): boolean => {
            const s = JSON.stringify(matcherEntry);
            return s.includes(".wolf/hooks") || s.includes(".wolf\\\\hooks");
          };
          const combined: Record<string, unknown[]> = {};
          const events = new Set([...Object.keys(existing.hooks), ...Object.keys(ours.hooks)]);
          for (const event of events) {
            const theirs = (existing.hooks[event] ?? []).filter((m) => !isOurs(m));
            const ourEvent = (ours.hooks as Record<string, unknown[]>)[event] ?? [];
            combined[event] = [...theirs, ...ourEvent];
          }
          merged = { hooks: combined };
        }
      }
    } catch {
      // Unparseable existing file: fall back to writing just our hooks.
    }
    fs.writeFileSync(hooksPath, JSON.stringify(merged, null, 2) + "\n", "utf-8");
    actions.push("Codex hooks registered (.codex/hooks.json)");

    // 2. Enable the hooks feature — but never corrupt an existing config.toml.
    const configPath = path.join(codexDir, "config.toml");
    if (!fs.existsSync(configPath)) {
      fs.writeFileSync(configPath, "[features]\nhooks = true\n", "utf-8");
      actions.push("Codex hooks feature enabled (.codex/config.toml)");
    } else {
      const existing = fs.readFileSync(configPath, "utf-8");
      // Anchored: the old /hooks\s*=\s*true/ also matched "webhooks = true"
      // or a commented "# hooks = true" and suppressed the warning.
      if (!/^\s*hooks\s*=\s*true\s*$/m.test(existing)) {
        warnings.push('add "hooks = true" under [features] in .codex/config.toml');
      }
    }

    // 3. Context file
    if (upsertMarkerBlock(path.join(ctx.projectRoot, "AGENTS.md"), readSnippet(ctx.templatesDir))) {
      actions.push("AGENTS.md updated (OpenWolf block)");
    }

    return { actions, warnings };
  },
};
