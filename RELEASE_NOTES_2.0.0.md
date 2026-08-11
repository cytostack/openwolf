# OpenWolf 2.0.0

The second brain for Claude Code is now a context layer for every AI coding assistant.

OpenWolf 2.0 is a ground-up upgrade focused on three things: improved context
management, optimized architecture scaffolding, and smarter token utilization.
It integrates 10 community pull requests (every author is credited in the
README), closes 12 issues, and ships the first test suite for the project's
most load-bearing internals.

## Highlights

**Works with your whole toolbox.** `openwolf init` auto-detects the coding
agents installed on your machine and wires each one to the same `.wolf/`
brain: Claude Code and Codex get full lifecycle hooks, OpenCode gets a native
plugin, Gemini CLI and Cursor get protocol files. One project memory, shared
by every assistant you use.

**Tokens you can verify.** OpenWolf now reads real API usage from harness
transcripts at the end of every session: input, output, and cache tokens,
per agent. `openwolf report` and the dashboard show measured numbers next to
the estimates instead of asking you to trust a heuristic.

**Context that survives.** A budget-capped digest of your project's most
valuable state is injected at session start. A new PreCompact hook plus a
compaction-aware session start mean context compaction no longer erases what
the session already did. STATUS.md gives every session a one-read handoff.

**A project index that cannot corrupt itself.** The anatomy index moved to a
durable store guarded by a cross-process lock; concurrent edits no longer
lose entries, and markdown edits by older hooks or humans are absorbed
instead of fought. Big files now index their functions and classes with line
ranges, so agents read one function with offset/limit instead of the whole file.

**Hardened by default.** The dashboard binds to localhost with token
authentication, command injection surfaces are gone, path traversal is
blocked, and secret-bearing files never enter the index.

**A dashboard worth opening.** Complete redesign: dot-matrix numerals,
monochrome surfaces with a single signal red, and panels for measured
tokens, per-agent usage, context health, and session handoff.

## Breaking and behavioral changes

- `openwolf init` wires all detected agents by default. Use `--agent claude`
  for the previous Claude-only behavior.
- The dashboard now requires a token (printed by `openwolf dashboard`,
  stored at `.wolf/dashboard-token`). Bookmarks without it will see 401.
- Design QC was removed; agents capture their own screenshots now, and the
  `puppeteer-core` dependency is gone.
- `.wolf/anatomy-index.json` is the new source of truth for the project
  index. `anatomy.md` is rendered from it and remains fully readable.
  Existing projects are migrated automatically by `openwolf update`.

## Upgrading

```bash
npm install -g openwolf@2
openwolf update          # every registered project: backup, migrate, rewire
```

Full details in CHANGELOG.md. Community contributions are credited in the
README Contributors section.
