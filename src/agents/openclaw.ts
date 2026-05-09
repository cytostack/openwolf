// OpenClawAdapter — soft-instruction installer for OpenClaw.
//
// OpenClaw's hook system (~/.openclaw/openclaw.json `.hooks.preToolUse[]`)
// only takes shell-command strings without file-op matchers — same shape
// limitation as Codex/Gemini. Therefore OpenWolf on OpenClaw is delivered
// via a marker-delimited section in ~/.openclaw/workspace/AGENTS.md.
//
// Idempotent: see openwolf-snippet.ts for marker logic.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type {
  AgentAdapter,
  HookDecision,
  InstallOpts,
  NormalizedHookInput,
} from "./types.js";
import { stripMarkerBlock, withSnippet } from "./openwolf-snippet.js";

const configDir = (): string => path.join(os.homedir(), ".openclaw");
const workspaceAgentsMd = (): string =>
  path.join(configDir(), "workspace", "AGENTS.md");

export class OpenClawAdapter implements AgentAdapter {
  readonly name = "openclaw" as const;
  readonly projectDirEnvVar = "";

  detect(): boolean {
    return fs.existsSync(configDir());
  }

  async installGlobal(_opts: InstallOpts): Promise<void> {
    if (!this.detect()) {
      throw new Error(
        `OpenClaw not detected (~/.openclaw does not exist). Install OpenClaw first.`,
      );
    }
    const target = workspaceAgentsMd();
    // Ensure ~/.openclaw/workspace/ exists (OpenClaw creates it on first use)
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const existing = fs.existsSync(target)
      ? fs.readFileSync(target, "utf-8")
      : "";
    fs.writeFileSync(target, withSnippet(existing), "utf-8");
  }

  async uninstallGlobal(): Promise<void> {
    const target = workspaceAgentsMd();
    if (!fs.existsSync(target)) return;
    const existing = fs.readFileSync(target, "utf-8");
    fs.writeFileSync(target, stripMarkerBlock(existing), "utf-8");
  }

  parseHookInput(stdin: string): NormalizedHookInput {
    const raw = JSON.parse(stdin) as { tool_input?: { command?: string } };
    return { tool: "shell", command: raw.tool_input?.command, raw };
  }

  emitHookOutput(decision: HookDecision): string {
    const out: Record<string, unknown> = {
      decision: decision.allow ? "allow" : "deny",
    };
    if (decision.allow && decision.updatedCommand) {
      out.hookSpecificOutput = {
        tool_input: { command: decision.updatedCommand },
      };
    }
    return JSON.stringify(out);
  }
}
