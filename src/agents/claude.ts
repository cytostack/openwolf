// ClaudeAdapter — full-fidelity adapter (current OpenWolf default behavior).
// Phase 1a skeleton; Phase 1b refactors src/cli/init.ts HOOK_SETTINGS into here.
//
// Capabilities (full):
//   - SessionStart hook
//   - PreToolUse  matcher Read
//   - PreToolUse  matcher Write|Edit|MultiEdit
//   - PostToolUse matcher Read
//   - PostToolUse matcher Write|Edit|MultiEdit
//   - Stop hook
//
// Hook input shape: {tool_input: {file_path?, path?, command?}, ...}
// Hook output: write to stderr (for LLM-visible injection) + exit 0.
//   For permission-flow override: emit hookSpecificOutput JSON to stdout.

import type {
  AgentAdapter,
  CanonicalTool,
  HookDecision,
  InstallOpts,
  NormalizedHookInput,
} from "./types.js";

export class ClaudeAdapter implements AgentAdapter {
  readonly name = "claude" as const;
  readonly projectDirEnvVar = "$CLAUDE_PROJECT_DIR";

  detect(): boolean {
    // ~/.claude/ exists OR `claude` binary in PATH
    // TODO Phase 1b: implement
    throw new Error("not yet implemented");
  }

  async installGlobal(_opts: InstallOpts): Promise<void> {
    // Move HOOK_SETTINGS object + writeJSON(~/.claude/settings.json) logic
    // from src/cli/init.ts here. Behavior must remain identical.
    // TODO Phase 1b
    throw new Error("not yet implemented");
  }

  async uninstallGlobal(): Promise<void> {
    // Inverse of installGlobal: strip OpenWolf entries from settings.json
    // TODO Phase 1b
    throw new Error("not yet implemented");
  }

  parseHookInput(stdin: string): NormalizedHookInput {
    const raw = JSON.parse(stdin) as {
      tool_name?: string;
      tool_input?: { file_path?: string; path?: string; command?: string };
    };
    const ti = raw.tool_input ?? {};
    const filePath = ti.file_path ?? ti.path;
    const tool = mapClaudeTool(raw.tool_name, filePath, ti.command);
    return { tool, filePath, command: ti.command, raw };
  }

  emitHookOutput(decision: HookDecision): string {
    // Claude PreToolUse permission-flow output:
    //   {hookSpecificOutput: {hookEventName, permissionDecision, permissionDecisionReason, updatedInput?}}
    if (!decision.allow) {
      return JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: decision.reason ?? "blocked by OpenWolf",
        },
      });
    }
    if (decision.updatedFilePath || decision.updatedCommand) {
      return JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          permissionDecisionReason: decision.reason ?? "OpenWolf rewrite",
          updatedInput: {
            ...(decision.updatedFilePath
              ? { file_path: decision.updatedFilePath }
              : {}),
            ...(decision.updatedCommand
              ? { command: decision.updatedCommand }
              : {}),
          },
        },
      });
    }
    // No structured output — context injection happens via stderr in caller
    return "";
  }
}

function mapClaudeTool(
  toolName: string | undefined,
  filePath: string | undefined,
  command: string | undefined,
): CanonicalTool {
  if (toolName === "Read") return "read";
  if (toolName === "Write") return "write";
  if (toolName === "Edit" || toolName === "MultiEdit") return "edit";
  if (toolName === "Bash") return "shell";
  if (filePath) return "read"; // best-effort fallback
  if (command) return "shell";
  return "shell";
}
