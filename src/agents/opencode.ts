// OpenCodeAdapter — instructions-file installer for OpenCode CLI.
//
// OpenCode supports system-level instruction injection via the `instructions`
// array in ~/.config/opencode/opencode.json (each entry is a path to a .md
// file whose content is concatenated into the system prompt).
//
// Strategy:
//   1. Write the OpenWolf snippet to ~/.config/opencode/openwolf-instructions.md
//      (whole file = the snippet; no marker needed since file is OpenWolf-owned).
//   2. Patch opencode.json: ensure the path is present in `instructions[]`.
//      Idempotent — re-running adds the path only once.
//
// Uninstall reverses both steps: remove path from instructions[] and delete
// the instructions file.
//
// We intentionally do NOT write a TS plugin — OpenWolf needs no runtime
// hook on OpenCode (file-op interception isn't its goal here; the agent
// reads .wolf/ voluntarily per the instructions).

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type {
  AgentAdapter,
  HookDecision,
  InstallOpts,
  NormalizedHookInput,
} from "./types.js";
import { OPENWOLF_SNIPPET } from "./openwolf-snippet.js";

const configDir = (): string => path.join(os.homedir(), ".config", "opencode");
const opencodeJsonPath = (): string => path.join(configDir(), "opencode.json");
const instructionsFilePath = (): string =>
  path.join(configDir(), "openwolf-instructions.md");

// Both literal-tilde and absolute paths are accepted by OpenCode; we use
// literal tilde for portability across machines that share opencode.json.
const INSTRUCTIONS_PATH_REL = "~/.config/opencode/openwolf-instructions.md";

interface OpenCodeConfig {
  instructions?: string[];
  [key: string]: unknown;
}

function readConfig(): OpenCodeConfig {
  const p = opencodeJsonPath();
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, "utf-8")) as OpenCodeConfig;
}

function writeConfig(cfg: OpenCodeConfig): void {
  const p = opencodeJsonPath();
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
}

export class OpenCodeAdapter implements AgentAdapter {
  readonly name = "opencode" as const;
  readonly projectDirEnvVar = "";

  detect(): boolean {
    return fs.existsSync(opencodeJsonPath());
  }

  async installGlobal(_opts: InstallOpts): Promise<void> {
    if (!this.detect()) {
      throw new Error(
        `OpenCode not detected (~/.config/opencode/opencode.json missing).`,
      );
    }
    // 1. Write instructions file (whole file is OpenWolf snippet; strip markers
    //    since the file is OpenWolf-owned end-to-end).
    const body = OPENWOLF_SNIPPET.replace(/^<!-- openwolf:start -->\n?/, "")
      .replace(/\n?<!-- openwolf:end -->\n?$/, "")
      .trim();
    fs.writeFileSync(instructionsFilePath(), body + "\n", "utf-8");

    // 2. Patch opencode.json instructions[]
    const cfg = readConfig();
    const list = Array.isArray(cfg.instructions) ? cfg.instructions : [];
    if (!list.includes(INSTRUCTIONS_PATH_REL)) {
      list.push(INSTRUCTIONS_PATH_REL);
    }
    cfg.instructions = list;
    writeConfig(cfg);
  }

  async uninstallGlobal(): Promise<void> {
    // 1. Strip path from instructions[]
    if (fs.existsSync(opencodeJsonPath())) {
      const cfg = readConfig();
      if (Array.isArray(cfg.instructions)) {
        cfg.instructions = cfg.instructions.filter(
          (p) => p !== INSTRUCTIONS_PATH_REL,
        );
        if (cfg.instructions.length === 0) delete cfg.instructions;
        writeConfig(cfg);
      }
    }
    // 2. Delete instructions file
    if (fs.existsSync(instructionsFilePath())) {
      fs.unlinkSync(instructionsFilePath());
    }
  }

  parseHookInput(stdin: string): NormalizedHookInput {
    // OpenCode plugin API would deliver tool input via TS callback, not stdin.
    // We don't ship a runtime plugin — this method exists for interface
    // completeness but should not be reached in normal flow.
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
