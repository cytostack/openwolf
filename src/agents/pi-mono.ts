// PiMonoAdapter — soft-instruction installer for pi-mono coding agent.
//
// pi-mono (https://github.com/badlogic/pi-mono, npm
// @mariozechner/pi-coding-agent) stores global agent instructions in
// ~/.pi/agent/AGENTS.md. This is a clean global injection point — same
// pattern as Codex AGENTS.md.
//
// Install path is overridable via PI_CODING_AGENT_DIR env var; we honor it
// at runtime so users with custom locations are respected.

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

const configDir = (): string =>
  process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
const agentsMdPath = (): string => path.join(configDir(), "AGENTS.md");

export class PiMonoAdapter implements AgentAdapter {
  readonly name = "pi-mono" as const;
  readonly projectDirEnvVar = "";

  detect(): boolean {
    return fs.existsSync(configDir());
  }

  async installGlobal(_opts: InstallOpts): Promise<void> {
    if (!this.detect()) {
      throw new Error(
        `pi-mono not detected (${configDir()} missing). Install with: npm install -g @mariozechner/pi-coding-agent`,
      );
    }
    const target = agentsMdPath();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const existing = fs.existsSync(target)
      ? fs.readFileSync(target, "utf-8")
      : "";
    fs.writeFileSync(target, withSnippet(existing), "utf-8");
  }

  async uninstallGlobal(): Promise<void> {
    const target = agentsMdPath();
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
