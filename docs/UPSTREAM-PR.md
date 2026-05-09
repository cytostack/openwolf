# Multi-Agent Runtime PR

## Summary

This PR adds a `--agent <name>` flag to `openwolf init`, supporting **8 new
AI coding agents** in addition to Claude Code:

| Agent | Notes | Closes |
|-------|-------|--------|
| **codex** | `~/.codex/AGENTS.md` marker block | #2 |
| **gemini** | `~/.gemini/GEMINI.md` marker block | #22 |
| **opencode** | `~/.config/opencode/openwolf-instructions.md` + patches `opencode.json` `instructions[]` | #5, #6 |
| **openclaw** | `~/.openclaw/workspace/AGENTS.md` marker block | — |
| **hermes** | Python plugin (entry-point `hermes_agent.plugins.openwolf`), installed into Hermes' venv via `uv pip install` + `~/.hermes/config.yaml` `plugins.enabled` patch. **Published to PyPI as [`openwolf-hermes 0.1.0`](https://pypi.org/project/openwolf-hermes/0.1.0/)** | — |
| **cline** | OS-aware Cline rules path (`~/Library/Application Support/cline/rules.md` on macOS, XDG/AppData on Linux/Windows) | — |
| **cursor** | `~/.cursor/USER_RULES.md` (experimental — Cursor has no documented global rules path as of 2026-05; adapter writes the file and prints guidance to paste into Cursor → Settings → Rules) | — |
| **pi-mono** | `~/.pi/agent/AGENTS.md` (or `$PI_CODING_AGENT_DIR/AGENTS.md`). Verified against [badlogic/pi-mono](https://github.com/badlogic/pi-mono) docs | — |

Default behavior (no `--agent` flag) is **bit-for-bit identical to v1.0.4**:
the original `initCommand()` flow runs unchanged. Existing users see no
difference.

## Architecture

A new `src/agents/` directory introduces an `AgentAdapter` interface:

```typescript
interface AgentAdapter {
  name: AgentName;
  detect(): boolean;
  installGlobal(opts: InstallOpts): Promise<void>;
  uninstallGlobal(): Promise<void>;
  parseHookInput(stdin: string): NormalizedHookInput;
  emitHookOutput(decision: HookDecision): string;
  projectDirEnvVar: string;
}
```

Each adapter encapsulates one agent's quirks: where to write the integration
file, what hook protocol the agent speaks (if any), how to parse/emit hook
JSON. Core OpenWolf logic (anatomy / cerebrum / token-ledger) stays
agent-agnostic. The shared `OPENWOLF_SNIPPET` constant in
`src/agents/openwolf-snippet.ts` is the single source of truth for the
soft-instruction protocol; both `snippets/openwolf-cross-agent.md` (human
docs) and the embedded const must stay in sync when the protocol changes.

Full design rationale + rejected alternatives in
[`docs/adr/ADR-001-multi-agent-runtime.md`](https://github.com/ChasLui/openwolf/blob/dev/docs/adr/ADR-001-multi-agent-runtime.md).

## Honest Limitations

OpenWolf's full power (auto-injecting anatomy descriptions before reads,
catching repeated reads, post-write anatomy refresh) requires hooks at the
agent's `Read` / `Write` / `Edit` tool boundaries. Of the 8 new agents:

- **codex / gemini**: hook protocols only support shell-command
  interception (no file-op matchers). Soft instructions only.
- **opencode**: has `instructions[]` array — clean injection, but no
  runtime hook (we do not ship a TS plugin; agent reads `.wolf/`
  voluntarily per the instructions).
- **openclaw / cline / cursor / pi-mono**: same soft-instruction pattern
  via their respective rules / instructions file.
- **hermes**: Python plugin with `pre_tool_call` hook can write to
  `.wolf/memory.md` + `token-ledger.json` on file ops, plus a
  `/openwolf` slash command (status / scan). Hermes API has no
  system-prompt injection point so it cannot auto-inject anatomy
  descriptions like Claude does.

Only **claude** still gets the full hook-driven experience. The other 8
agents get the "agent reads `.wolf/` voluntarily" experience, which is
strictly better than no integration but weaker than Claude's. Documented
per-adapter in `src/agents/*.ts` headers and in ADR-001 "Findings during
Phase 1a".

## Hermes plugin distribution

The `openwolf-hermes` Python plugin ships as a separate PyPI package, not
bundled in the npm `openwolf` package:

- Source lives in `src/agents/hermes/python/` (this PR adds it)
- `.github/workflows/publish-hermes-plugin.yml` builds + publishes via
  PyPI Trusted Publishing (OIDC), tag-triggered on `openwolf-hermes-v*`
- v0.1.0 already published 2026-05-09 → https://pypi.org/project/openwolf-hermes/0.1.0/
- After this PR merges, the HermesAdapter can switch from
  `uv pip install -e <path>` (dev install) to plain
  `uv pip install openwolf-hermes` for users without a fork checkout

## Testing

End-to-end tested locally (macOS arm64, all reachable agents installed and
live). The 4 agents the test machine had installed all passed
install/uninstall/idempotent/reinstall flows:

| Agent | Install | Idempotent (reinstall ×2) | Uninstall | Reinstall |
|-------|---------|--------------------------|-----------|-----------|
| codex | ✅ | ✅ count=1 | ✅ | ✅ |
| gemini | ✅ | ✅ count=1 | ✅ | ✅ |
| opencode | ✅ instructions.md + opencode.json | ✅ no dup path | ✅ both removed | ✅ |
| openclaw | ✅ | ✅ count=1 | ✅ | ✅ |
| hermes | ✅ openwolf-hermes 0.1.0 in venv + config.yaml plugins.enabled | ✅ entry count=1 | ✅ pkg uninstalled, config rolled back | ✅ |
| cline | ✅ ~/Library/Application Support/cline/rules.md | ✅ count=1 | ✅ | ✅ |
| pi-mono / cursor | not installed locally — adapters fail-fast on `detect()` as expected | — | — | — |

`tsc --noEmit` reports 0 type errors on all new code. Pre-existing errors
in `src/cli/`, `src/hooks/`, `bin/` are upstream and untouched (need
`@types/node` install).

## Phased landing

If a single 13-commit PR is too much, this can land in 5 separate PRs:

1. **ADR-only** (`bddf690`, `be6c54e`): documentation + AgentAdapter
   skeleton. Zero behavior change.
2. **Codex + Gemini** (`13e3d66`, `963fbc8`): two soft-instruction
   adapters + `--agent` flag.
3. **OpenClaw + OpenCode** (`981084f`): two more adapters.
4. **Hermes** (`c08bb69`, `a40b0dd`): Python plugin + adapter.
5. **CI + extra agents + docs** (`adef463`, `db60152`, `bdd4b96`,
   `e115b3f`, `48c7a3e`, `d5821fe`): GitHub Actions for PyPI publishing,
   pi-mono / cline / cursor adapters, OIDC Trusted Publishing config,
   PR description draft.

Happy to split if preferred.

## Out of scope (future PRs)

- **ClaudeAdapter refactor**: `src/cli/init.ts` `HOOK_SETTINGS` + Claude-
  specific `.claude/settings.json` write logic still lives in `init.ts`.
  Phase 1d in ADR-001 plans to refactor it into
  `ClaudeAdapter.installGlobal()` so Claude becomes "just another
  adapter". Behavior identical, code organization cleaner. Holding back
  to keep this PR review-able.
- **Copilot adapter**: per-project (`.github/copilot-instructions.md`),
  doesn't fit the `installGlobal` interface. Needs an
  `installPerProject(projectDir)` extension first.
- **Windsurf / kilocode / antigravity**: global instruction file paths
  uncertain; defer until verified or feature requested.
- **AGPL-3.0 derivative concerns**: the OpenCode soft-instruction
  approach avoids any in-process AGPL plugin. The Hermes Python plugin
  is in-process — its `pyproject.toml` declares
  `license = "AGPL-3.0-only"`, but Hermes itself is not AGPL. Would
  value upstream's perspective on whether this license posture is OK or
  needs adjustment.
- **Test infrastructure**: no integration tests for adapters yet.
  Manual testing only. Would add `vitest` + per-adapter tests if
  direction is acceptable.

## Author note

I'm a heavy OpenWolf user across 9 agents (claude + 8 above) and was
about to write 8 separate plugins as workarounds. The adapter pattern in
this PR pushes the common code (anatomy / cerebrum / ledger maintenance)
back into OpenWolf core where it belongs, with thin per-agent wrappers.
The PyPI Trusted Publishing pipeline is also configured so Hermes plugin
releases are cryptographically tied to this repo's CI — no long-lived
secrets.

Happy to discuss direction, scope, or split the PR however maintainers
prefer.

— Chao Liu (@ChasLui)
