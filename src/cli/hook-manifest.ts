// Single source of truth for which hook scripts exist and how they are
// registered in Claude Code settings. init.ts and update.ts both consume this
// so the two can never drift (they used to carry hand-mirrored copies).

// The hook command carries the project's absolute path, baked in at
// init/update time. It used to reference $CLAUDE_PROJECT_DIR (and
// %CLAUDE_PROJECT_DIR% on Windows), which fails twice over:
//
//   1. %VAR% is cmd.exe syntax. PowerShell is Claude Code's shell on Windows
//      and passes it through as a literal, so node looked for a file named
//      "%CLAUDE_PROJECT_DIR%\.wolf\hooks\stop.js" and every hook died with
//      MODULE_NOT_FOUND on every tool call.
//   2. CLAUDE_PROJECT_DIR is not in the hook process's environment at all.
//      Claude Code passes project context through the stdin JSON payload, not
//      the env, so no variable syntax could have worked. Reported by
//      @aevnar (issue: "Windows hooks still broken on PowerShell").
//
// An absolute path needs no expansion, so it behaves identically under bash,
// zsh, cmd.exe and PowerShell, and it survives a CWD change mid-session.
// Forward slashes are used on every platform: node accepts them on Windows,
// and they keep the command free of backslash escaping inside JSON.
const cmd = (projectDir: string, file: string, timeout: number) => ({
  type: "command" as const,
  command: `node "${projectDir.replace(/\\/g, "/").replace(/\/+$/, "")}/.wolf/hooks/${file}"`,
  timeout,
});

/**
 * Build the settings.json hook block for one project.
 * `projectDir` must be an absolute path; it is written into every command.
 */
export function buildHookSettings(projectDir: string) {
  const c = (file: string, timeout: number) => cmd(projectDir, file, timeout);
  return {
    hooks: {
      SessionStart: [{ matcher: "", hooks: [c("session-start.js", 5)] }],
      UserPromptSubmit: [{ matcher: "", hooks: [c("user-prompt-submit.js", 5)] }],
      PreToolUse: [
        { matcher: "Read", hooks: [c("pre-read.js", 5)] },
        { matcher: "Write|Edit|MultiEdit", hooks: [c("pre-write.js", 5)] },
        { matcher: "Bash", hooks: [c("pre-bash.js", 5)] },
      ],
      PostToolUse: [
        { matcher: "Read", hooks: [c("post-read.js", 5)] },
        { matcher: "Write|Edit|MultiEdit", hooks: [c("post-write.js", 10)] },
        { matcher: "Bash", hooks: [c("post-bash.js", 10)] },
      ],
      PostToolBatch: [{ matcher: "", hooks: [c("post-batch.js", 5)] }],
      PreCompact: [{ matcher: "", hooks: [c("precompact.js", 5)] }],
      Stop: [{ matcher: "", hooks: [c("stop.js", 10)] }],
      SessionEnd: [{ matcher: "", hooks: [c("session-end.js", 10)] }],
    },
  };
}

/** Entry-point scripts settings.json invokes, in registration order. */
export const HOOK_ENTRY_FILES = [
  "session-start.js",
  "user-prompt-submit.js",
  "pre-read.js",
  "pre-write.js",
  "pre-bash.js",
  "post-read.js",
  "post-write.js",
  "post-bash.js",
  "post-batch.js",
  "precompact.js",
  "stop.js",
  "session-end.js",
];

/** How many hooks `init` and `update` report as registered. */
export const HOOK_COUNT = HOOK_ENTRY_FILES.length;

export type HookSettings = ReturnType<typeof buildHookSettings>;

/** Compiled hook scripts installed into <project>/.wolf/hooks/. */
export const HOOK_FILES = [
  "session-start.js",
  "user-prompt-submit.js",
  "pre-read.js",
  "pre-write.js",
  "pre-bash.js",
  "post-bash.js",
  "bash-filter.js",
  "bash-output-governor.js",
  "bash-path-parser.js",
  "post-read.js",
  "post-write.js",
  "precompact.js",
  "post-batch.js",
  "rule-reinjection.js",
  "stop.js",
  "session-end.js",
  "ledger.js",
  "ledger-math.js",
  "shared.js",
  "bug-index.js",
  "hook-attachments.js",
  "anatomy-store.js",
  "anatomy-lock.js",
  "symbol-extractor.js",
];
