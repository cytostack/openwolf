# ADR-001: Multi-Agent Runtime

**Status**: Proposed (2026-05-09)  
**Author**: Chao Liu (@ChasLui)  
**Target branch**: `dev` of `ChasLui/openwolf` fork; intended for upstream PR after Phase 2.

## Context

OpenWolf v1.0.4 hard-codes the Claude Code hook protocol:
- `src/cli/init.ts` writes `.claude/settings.json` with Claude-specific `PreToolUse` / `PostToolUse` matchers (`Read`, `Write|Edit|MultiEdit`).
- Hook scripts in `src/hooks/*.ts` parse Claude's `tool_input` JSON shape.
- Templates in `src/templates/` reference `$CLAUDE_PROJECT_DIR` env var.

Real-world need: a single user runs **6 different AI coding agents** (claude, codex, gemini, opencode, openclaw, hermes) and wants OpenWolf's anatomy / cerebrum / memory / token-ledger benefits across all of them. Currently 5/6 agents get nothing.

Comparable projects (RTK, PandaFilter) already ship 8–11 agent enums via `--agent <X>` flag. OpenWolf is a generation behind on this dimension.

## Decision

**Refactor OpenWolf into a multi-agent runtime** with three layers:

1. **Agent registry** (`src/agents/`): one `AgentAdapter` per supported agent, encapsulating:
   - Hook installation point (e.g. `~/.claude/settings.json` vs `~/.codex/hooks.json` vs `~/.config/opencode/plugins/openwolf.ts`)
   - Hook input/output JSON schema (Claude `tool_input` vs Codex `shell` matcher vs OpenCode plugin TS API)
   - Tool-name normalization (Claude "Read" / Gemini "run_shell_command" / OpenCode "edit" → canonical `FileOp`)
   - Project-dir env var (Claude `$CLAUDE_PROJECT_DIR` vs others)

2. **Init layer** (`src/cli/init.ts`): expose `--agent <X>` flag with enum:
   - `claude` (default, current behavior)
   - `codex`
   - `gemini`
   - `opencode`
   - `openclaw`
   - `hermes`
   - `all` — auto-detect installed agents and install for each

3. **Hook implementation layer** (`src/hooks/*.ts`): refactor 6 hooks (session-start, pre-read, pre-write, post-read, post-write, stop) to:
   - Read agent name from env / arg
   - Use the corresponding `AgentAdapter` to parse input + emit output
   - Keep core OpenWolf logic (anatomy injection, cerebrum lookup, token-ledger update) agent-agnostic

## Architecture

```
src/
├── agents/                          # NEW
│   ├── types.ts                     # AgentAdapter interface, FileOp canonical type
│   ├── claude.ts                    # ClaudeAdapter (refactor existing logic)
│   ├── codex.ts                     # CodexAdapter
│   ├── gemini.ts                    # GeminiAdapter
│   ├── opencode.ts                  # OpenCodeAdapter (TS plugin host)
│   ├── openclaw.ts                  # OpenClawAdapter
│   ├── hermes.ts                    # HermesAdapter (Python plugin host — see Phase 3)
│   └── index.ts                     # registry + detect()
├── cli/init.ts                      # CHANGED — accept --agent flag
├── hooks/                           # CHANGED — adapter-aware
└── templates/
    ├── claude-md-snippet.md         # existing
    ├── codex-md-snippet.md          # NEW
    ├── gemini-md-snippet.md         # NEW
    ├── opencode-plugin-template.ts  # NEW
    └── hermes-plugin-template.py    # NEW (Phase 3)
```

### `AgentAdapter` interface (preliminary)

```typescript
export interface AgentAdapter {
  name: string;                                    // "claude" | "codex" | ...
  detect(): boolean;                               // is this agent installed?
  installGlobal(opts: InstallOpts): Promise<void>; // patch settings file
  uninstallGlobal(): Promise<void>;
  hookInput(stdin: string): NormalizedHookInput;   // parse agent-specific JSON
  hookOutput(decision: HookDecision): string;      // emit agent-specific JSON
  projectDirEnvVar: string;                        // "$CLAUDE_PROJECT_DIR" | ...
}

export interface NormalizedHookInput {
  tool: "read" | "write" | "edit" | "shell" | "session-start" | "stop";
  filePath?: string;
  command?: string;
  raw: unknown;
}
```

## Rollout phases

| Phase | Scope | Effort | Deliverable |
|-------|-------|--------|-------------|
| **0** | This ADR + dev branch placeholder commit | 1 h | docs/adr/ADR-001 + src/agents/ skeleton dir |
| **1** | ClaudeAdapter (refactor) + CodexAdapter + GeminiAdapter + init --agent flag | 4–8 h | `openwolf init --agent codex` works |
| **2** | OpenCodeAdapter (TS plugin) + OpenClawAdapter | 4–8 h | 5/6 agents covered (hermes still TODO) |
| **3** | HermesAdapter via Python sub-package + PyPI publish | 8–16 h | 6/6 agents |
| **4** | PR to `cytostack/openwolf` upstream OR independent npm release `openwolf-multi-agent` | 4–8 h | Public release |

Total realistic estimate: **20–40 hours of focused work** spread over 1–2 weeks.

## Alternatives considered

1. **Plugin-only path** (each agent = independent npm/pip plugin, no fork):
   - Pros: zero upstream coupling, each plugin can be released independently
   - Cons: 5× duplicated boilerplate (anatomy parser, cerebrum logic, token-ledger writer); upstream changes break N plugins simultaneously
   - **Rejected** because the hard part (anatomy/cerebrum/token-ledger) is shared logic, not agent-specific

2. **Soft-instructions only** (just inject `@OPENWOLF.md` into each agent's `AGENTS.md`):
   - Pros: zero code change; 30-minute job
   - Cons: degraded experience — agents must voluntarily read `.wolf/`, no hook-level enforcement; loses ~70% of OpenWolf's value
   - **Rejected** because user requested "long-term, hard, correct" path

3. **Fork without abstraction** (just hard-code each agent's hook in init.ts):
   - Pros: faster initial implementation
   - Cons: every new agent = N×M coupling; no plugin model for community contributions
   - **Rejected** for long-term maintainability

## Findings during Phase 1a (2026-05-09)

**Codex and Gemini hook protocols cannot host file-op hooks.** Verified against:
- `~/.codex/hooks.json` written by `panda init --agent codex` v1.3.5
- `~/.codex/panda-rewrite.sh` source (panda 1.3.5)
- `~/.gemini/settings.json` written by `rtk init --gemini` and `panda init --gemini`

Both agents only support shell-command interception:
- Codex: `matcher: "shell"` in PreToolUse / PostToolUse, no Read/Write/Edit
- Gemini: `matcher: "run_shell_command"` in BeforeTool, no file-op matchers

Implication for OpenWolf 6-hook surface (session-start / pre-read / pre-write / post-read / post-write / stop):
- **Claude**: 6/6 hooks installable (current behavior)
- **Codex / Gemini**: 0/6 file-op hooks; only shell-command hook + soft-instructions (`@OPENWOLF.md` ref in AGENTS.md / GEMINI.md)
- **OpenCode / OpenClaw**: TBD in Phase 2 (TS plugin / openclaw.json hook system)
- **Hermes**: TBD in Phase 3 (Python plugin via `pre_tool_call`)

**Decision**: Mark codex/gemini as "degraded" tier. The adapter still does what's possible (shell hook + soft-instruction injection) but documents the gap. Users on codex/gemini are pointed to claude for full OpenWolf experience.

## Open questions

1. **Upstream relationship**: Will `cytostack/openwolf` accept this PR? Should we `git remote add upstream` and PR-driven from the start, or develop independently and propose later?
2. **License**: AGPL-3.0 → any in-process plugin (TS plugin in OpenCode, Python plugin in Hermes) becomes a derivative work. Does that block opencode/hermes integration?
3. **Hermes `pre_tool_call` hook**: The `rtk-hermes` PyPI plugin proves it's feasible — we should study its source as reference.
4. **OpenCode plugin API stability**: Plugin TS API may change between OpenCode versions. Does OpenWolf pin a min OpenCode version?
5. **Test strategy**: How to integration-test 6 agents in CI without spinning up real LLM sessions?

## Out of scope

- Hook protocol unification across agents (each agent's native hook is what users get; OpenWolf adapter just normalizes input/output, doesn't change Claude's PreToolUse vs Codex's `shell` matcher semantics).
- Replacing the daemon / dashboard (Claude-only by design, kept as-is).
- Adding new agents not in the 6-agent target list (cursor / windsurf / cline / copilot — defer until v2).
