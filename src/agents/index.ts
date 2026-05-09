// Agent registry — central lookup by name + auto-detection.
// Phase 1a skeleton; adapters' methods throw until Phase 1b implements them.

import type { AgentAdapter, AgentName } from "./types.js";
import { ClaudeAdapter } from "./claude.js";
import { ClineAdapter } from "./cline.js";
import { CodexAdapter } from "./codex.js";
import { CursorAdapter } from "./cursor.js";
import { GeminiAdapter } from "./gemini.js";
import { HermesAdapter } from "./hermes.js";
import { OpenClawAdapter } from "./openclaw.js";
import { OpenCodeAdapter } from "./opencode.js";
import { PiMonoAdapter } from "./pi-mono.js";

const REGISTRY = {
  claude: () => new ClaudeAdapter(),
  cline: () => new ClineAdapter(),
  codex: () => new CodexAdapter(),
  cursor: () => new CursorAdapter(),
  gemini: () => new GeminiAdapter(),
  hermes: () => new HermesAdapter(),
  openclaw: () => new OpenClawAdapter(),
  opencode: () => new OpenCodeAdapter(),
  "pi-mono": () => new PiMonoAdapter(),
} as const satisfies Record<string, () => AgentAdapter>;

export type SupportedAgent = keyof typeof REGISTRY;

export function getAdapter(name: AgentName): AgentAdapter {
  const factory = REGISTRY[name as SupportedAgent];
  if (!factory) {
    throw new Error(
      `agent "${name}" not yet supported. Known: ${Object.keys(REGISTRY).join(", ")}.`,
    );
  }
  return factory();
}

/** Auto-detect installed agents on the host. Returns adapters in install order. */
export function detectInstalled(): AgentAdapter[] {
  const found: AgentAdapter[] = [];
  for (const factory of Object.values(REGISTRY)) {
    const adapter = factory();
    try {
      if (adapter.detect()) found.push(adapter);
    } catch {
      // detect() may throw "not yet implemented" in Phase 1a — skip silently
    }
  }
  return found;
}
