// CursorAdapter — EXPERIMENTAL: Cursor IDE has no documented global rules
// file path as of 2026-05. User Rules are configured via Settings UI; project
// rules live in <project>/.cursor/rules/. Community feature requests for a
// global ~/.cursor/rules/ directory exist but are unmerged.
//
// As a best-effort fallback, this adapter writes to ~/.cursor/USER_RULES.md.
// If a future Cursor version adopts that path or ~/.cursor/rules/, the
// content is already there. Until then, users must paste the file content
// into Cursor Settings → Rules manually.
//
// detect() checks for ~/.cursor/. Cursor binary on macOS lives at
// /Applications/Cursor.app — we don't inspect it here; presence of
// ~/.cursor/ is sufficient evidence.

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

const configDir = (): string => path.join(os.homedir(), ".cursor");
const userRulesPath = (): string => path.join(configDir(), "USER_RULES.md");

export class CursorAdapter implements AgentAdapter {
  readonly name = "cursor" as const;
  readonly projectDirEnvVar = "";

  detect(): boolean {
    return fs.existsSync(configDir());
  }

  async installGlobal(_opts: InstallOpts): Promise<void> {
    if (!this.detect()) {
      throw new Error(
        `Cursor not detected (${configDir()} missing). Install Cursor IDE first.`,
      );
    }
    const target = userRulesPath();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const existing = fs.existsSync(target)
      ? fs.readFileSync(target, "utf-8")
      : "";
    fs.writeFileSync(target, withSnippet(existing), "utf-8");
    // Print actionable guidance — Cursor doesn't auto-load this file yet.
    console.log("");
    console.log(
      "  ⚠ Cursor has no auto-loaded global rules file as of 2026-05.",
    );
    console.log(`  Open ${target} and paste its contents into:`);
    console.log("     Cursor → Settings → Rules → User Rules");
    console.log("");
  }

  async uninstallGlobal(): Promise<void> {
    const target = userRulesPath();
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
