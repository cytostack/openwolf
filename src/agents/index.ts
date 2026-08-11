import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import type { AgentAdapter } from "./types.js";
import { codexAdapter } from "./codex.js";
import { opencodeAdapter } from "./opencode.js";
import { geminiAdapter } from "./gemini.js";
import { cursorAdapter } from "./cursor.js";
import { antigravityAdapter } from "./antigravity.js";

export type { AgentAdapter, AgentInstallContext, AgentInstallResult } from "./types.js";

// "claude" is not in this registry: the Claude Code integration is OpenWolf's
// native install path in cli/init.ts. This registry holds the additional
// agents wired up via `openwolf init --agent <name>`.
const ADAPTERS: Record<string, AgentAdapter> = {
  [codexAdapter.name]: codexAdapter,
  [opencodeAdapter.name]: opencodeAdapter,
  [geminiAdapter.name]: geminiAdapter,
  [cursorAdapter.name]: cursorAdapter,
  [antigravityAdapter.name]: antigravityAdapter,
};

export function availableAgents(): string[] {
  return Object.keys(ADAPTERS);
}

function onPath(bin: string): boolean {
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", [bin], {
      stdio: "ignore", timeout: 2000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Which additional agents are actually present on this machine — used by
 * `openwolf init` (no --agent flag) to auto-wire only what the user runs.
 * An agent counts as installed if its config directory exists or its CLI
 * is on PATH; Cursor is an app, so its app bundle also counts on macOS.
 */
export function detectInstalledAgents(): string[] {
  const home = os.homedir();
  const detected: string[] = [];
  if (fs.existsSync(path.join(home, ".codex")) || onPath("codex")) detected.push("codex");
  if (fs.existsSync(path.join(home, ".config", "opencode")) || onPath("opencode")) detected.push("opencode");
  if (fs.existsSync(path.join(home, ".gemini")) || onPath("gemini")) detected.push("gemini");
  if (
    fs.existsSync(path.join(home, ".cursor")) ||
    (process.platform === "darwin" && fs.existsSync("/Applications/Cursor.app"))
  ) detected.push("cursor");
  if (
    fs.existsSync(path.join(home, ".antigravity")) ||
    fs.existsSync(path.join(home, ".config", "antigravity")) ||
    (process.platform === "darwin" && fs.existsSync("/Applications/Antigravity.app"))
  ) detected.push("antigravity");
  return detected;
}

export function resolveAgents(names: string[]): AgentAdapter[] {
  const seen = new Set<string>();
  const result: AgentAdapter[] = [];
  for (const raw of names) {
    const name = raw.toLowerCase().trim();
    if (name === "claude" || seen.has(name)) continue; // claude is always installed
    const adapter = name === "all" ? null : ADAPTERS[name];
    if (name === "all") {
      for (const a of Object.values(ADAPTERS)) {
        if (!seen.has(a.name)) { seen.add(a.name); result.push(a); }
      }
      continue;
    }
    if (!adapter) {
      throw new Error(`Unknown agent "${raw}". Valid agents: claude, ${availableAgents().join(", ")}, all`);
    }
    seen.add(name);
    result.push(adapter);
  }
  return result;
}

/** Shared OpenWolf context snippet injected into AGENTS.md / GEMINI.md / rules. */
export function readSnippet(templatesDir: string): string {
  const p = path.join(templatesDir, "agents-md-snippet.md");
  try {
    return fs.readFileSync(p, "utf-8");
  } catch {
    return `# OpenWolf

@.wolf/OPENWOLF.md

This project uses OpenWolf for context management. Read and follow .wolf/OPENWOLF.md every session. Check .wolf/cerebrum.md before generating code. Check .wolf/anatomy.md before reading files.`;
  }
}
