// Multi-Agent Runtime — see docs/adr/ADR-001-multi-agent-runtime.md
// Phase 0: skeleton only. Phase 1 fills in the implementation.

export type AgentName =
  | "claude"
  | "codex"
  | "gemini"
  | "opencode"
  | "openclaw"
  | "hermes"
  | "pi-mono"
  | "cline"
  | "cursor";

export type CanonicalTool =
  | "read"
  | "write"
  | "edit"
  | "shell"
  | "session-start"
  | "stop";

export interface NormalizedHookInput {
  tool: CanonicalTool;
  filePath?: string;
  command?: string;
  raw: unknown;
}

export interface HookDecision {
  allow: boolean;
  reason?: string;
  updatedFilePath?: string;
  updatedCommand?: string;
  contextInjection?: string;
}

export interface InstallOpts {
  global: boolean;
  projectDir?: string;
  uninstall?: boolean;
}

export interface AgentAdapter {
  readonly name: AgentName;
  detect(): boolean;
  installGlobal(opts: InstallOpts): Promise<void>;
  uninstallGlobal(): Promise<void>;
  parseHookInput(stdin: string): NormalizedHookInput;
  emitHookOutput(decision: HookDecision): string;
  readonly projectDirEnvVar: string;
}
