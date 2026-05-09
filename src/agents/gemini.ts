// GeminiAdapter — soft-instruction installer for Gemini CLI.
//
// Same rationale as CodexAdapter: Gemini's hook protocol only supports
// BeforeTool matcher "run_shell_command", no file-op matchers. OpenWolf on
// Gemini is delivered via a marker-delimited section in ~/.gemini/GEMINI.md.
//
// See ADR-001 "Findings during Phase 1a" for hook-protocol rationale.

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

const configDir = (): string => path.join(os.homedir(), ".gemini");
const geminiMdPath = (): string => path.join(configDir(), "GEMINI.md");

export class GeminiAdapter implements AgentAdapter {
  readonly name = "gemini" as const;
  readonly projectDirEnvVar = "";

  detect(): boolean {
    return fs.existsSync(configDir());
  }

  async installGlobal(_opts: InstallOpts): Promise<void> {
    if (!this.detect()) {
      throw new Error(`Gemini CLI not detected (~/.gemini does not exist).`);
    }
    const target = geminiMdPath();
    const existing = fs.existsSync(target)
      ? fs.readFileSync(target, "utf-8")
      : "";
    fs.writeFileSync(target, withSnippet(existing), "utf-8");
  }

  async uninstallGlobal(): Promise<void> {
    const target = geminiMdPath();
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
