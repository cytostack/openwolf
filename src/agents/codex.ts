// CodexAdapter — soft-instruction installer for Codex CLI.
//
// Codex's hook protocol only supports matcher "shell" (no Read/Write/Edit
// matcher). Rather than register a shell-only hook that competes with
// pandafilter / rtk for the same slot, OpenWolf on Codex is delivered as a
// pure soft-instruction: append a marker-delimited section to
// ~/.codex/AGENTS.md that tells Codex to follow the OpenWolf protocol when
// the cwd contains a `.wolf/` directory.
//
// Idempotent: repeated `openwolf init --agent codex` only updates the
// content between `<!-- openwolf:start -->` and `<!-- openwolf:end -->`.
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

const configDir = (): string => path.join(os.homedir(), ".codex");
const agentsMdPath = (): string => path.join(configDir(), "AGENTS.md");

export class CodexAdapter implements AgentAdapter {
  readonly name = "codex" as const;
  readonly projectDirEnvVar = "";

  detect(): boolean {
    return fs.existsSync(configDir());
  }

  async installGlobal(_opts: InstallOpts): Promise<void> {
    if (!this.detect()) {
      throw new Error(
        `Codex not detected (~/.codex does not exist). Install Codex CLI first.`,
      );
    }
    const target = agentsMdPath();
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
    if (decision.reason) {
      (out as { reason?: string }).reason = decision.reason;
    }
    return JSON.stringify(out);
  }
}
