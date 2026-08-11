// Agent adapter architecture (OpenWolf 2.0, Workstream C).
// Design adopted from PR #39 by @ChasLui; concrete integrations from
// PR #36 (@nottyjay, Codex) and PR #9 (@alfasin, OpenCode).

export interface AgentInstallContext {
  projectRoot: string;
  wolfDir: string;
  templatesDir: string;
}

export interface AgentInstallResult {
  /** Human-readable lines describing what was written, for init output. */
  actions: string[];
  /** Manual steps the user still has to do, if any. */
  warnings: string[];
}

export interface AgentAdapter {
  /** Registry key used with `openwolf init --agent <name>`. */
  name: string;
  displayName: string;
  /**
   * Wire this agent up to the project's .wolf/ brain. Must be idempotent:
   * re-running init must never duplicate blocks or clobber user config.
   */
  install(ctx: AgentInstallContext): AgentInstallResult;
}
