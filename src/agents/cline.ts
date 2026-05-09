// ClineAdapter — soft-instruction installer for Cline (VS Code).
//
// Cline reads a global rules file. Path is OS-specific:
//   - macOS:   ~/Library/Application Support/cline/rules.md
//   - Linux:   ~/.config/cline/rules.md   (XDG)
//   - Windows: %APPDATA%/cline/rules.md
//
// Verified against panda init --agent cline 1.3.5 install on macOS, which
// writes to ~/Library/Application Support/cline/rules.md.

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

function configDir(): string {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "cline");
  }
  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA ?? path.join(home, "AppData", "Roaming"),
      "cline",
    );
  }
  return path.join(
    process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"),
    "cline",
  );
}

const rulesMdPath = (): string => path.join(configDir(), "rules.md");

export class ClineAdapter implements AgentAdapter {
  readonly name = "cline" as const;
  readonly projectDirEnvVar = "";

  detect(): boolean {
    return fs.existsSync(configDir());
  }

  async installGlobal(_opts: InstallOpts): Promise<void> {
    if (!this.detect()) {
      throw new Error(
        `Cline not detected (${configDir()} missing). Install Cline VS Code extension first.`,
      );
    }
    const target = rulesMdPath();
    const existing = fs.existsSync(target)
      ? fs.readFileSync(target, "utf-8")
      : "";
    fs.writeFileSync(target, withSnippet(existing), "utf-8");
  }

  async uninstallGlobal(): Promise<void> {
    const target = rulesMdPath();
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
