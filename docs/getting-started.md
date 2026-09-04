# Getting Started

## Prerequisites

- **Node.js 20+** ([download](https://nodejs.org)). OpenWolf's hooks run as
  Node.js scripts. Bug-log full-text search uses Node's built-in SQLite on
  22.5+ and falls back to a simpler matcher below that.
- **At least one supported coding agent.** Claude Code, Codex, and OpenCode
  get full lifecycle hooks; Cursor, Gemini CLI, and Antigravity get
  context-level integration. `openwolf init` auto-detects what you have.

## Install

```bash
npm install -g @alptech/openwolf
openwolf --version
```

## Initialize a project

```bash
cd your-project
openwolf init
```

```
  ██████ ██████ ██████ ██   ██ ██     ██ ██████ ██     ██████
  ██  ██ ██  ██ ██     ███  ██ ██     ██ ██  ██ ██     ██
  ██  ██ ██████ █████  ██ █ ██ ██  █  ██ ██  ██ ██     █████
  ██  ██ ██     ██     ██  ███ ██ ███ ██ ██  ██ ██     ██
  ██████ ██     ██████ ██   ██  ███ ███  ██████ ██████ ██

  v1.1.2  ·  one project memory across your coding agents
  ~/your-project

  ✓ Agents detected: codex, gemini (wiring all; --agent claude to skip)
  ✓ Codex hooks registered (.codex/hooks.json)
  ✓ Skills installed: /security-audit, /reframe, /handoff (claude, codex)
  ✓ Claude skills installed: openwolf (.claude/skills/)

  ✓ created   .wolf/ · 10 files            memory every agent shares
  ✓ hooks     12 registered                fire on their own, invisibly
  ✓ index     47 files                     query with openwolf find <name>
  ✓ rules     CLAUDE.md + .claude/rules    protocol every session reads
  ✓ agents    claude, codex, gemini
  ✓ daemon    running (pm2)                openwolf dashboard for live view

  Next
    Work as before. Whichever agent you start, OpenWolf runs underneath.
    openwolf dashboard       measured token usage, hook health, bug memory
    openwolf find <name>     locate a symbol without reading whole files
    openwolf report          what was governed, saved, and attributed

  Everything stays on this machine. No API calls, no telemetry.
```

No configuration needed. To wire specific agents instead of auto-detecting,
pass `--agent codex opencode`, `--agent all`, or `--agent claude`.

## Verify it works

```bash
openwolf status
```

Confirms the core files, the hook scripts (24 on disk, 12 of them registered
as lifecycle hooks), and the agent registrations.
After your first session, `openwolf report` shows measured usage from the
transcripts.

## What happens during a session

1. **Session start**: OpenWolf self-tests its own install, then injects a
   ~400-token index of your project state: what each `.wolf` file holds, the
   top Do-Not-Repeat rules, and the current handoff.
2. **Before reads**: duplicate reads get a factual note; large files get
   their symbol map so the agent reads a slice instead of the whole file.
3. **Before writes**: the edit is checked against your Do-Not-Repeat list,
   and relevant past bug fixes are surfaced from the bug log.
4. **After Bash**: oversized output (grep floods, git show, file re-prints)
   is condensed before it enters context. The full output stays at
   `.wolf/cache/bash/` with a pointer. Test failures are never touched.
5. **Every 25 tool batches**: the top rules are re-surfaced in one short
   note, countering within-session instruction decay.
6. **On compaction**: in-flight state, your rules, and the path-scoped
   instructions the platform drops are re-injected.
7. **On stop**: the ledger records measured usage per model and verifies
   from the transcript which hooks fired and which context was delivered.

You interact with none of this.

## The dashboard

```bash
openwolf dashboard
```

Starts the daemon if needed and opens a token-authenticated local dashboard.
The hero number is tokens verifiably kept out of context, measured at the
rewrite point. Around it: measured vs estimated usage, cache-rebuild
attribution, hook health, per-agent breakdown, the anatomy browser, and cron
control. Each project gets its own port automatically.

For a daemon that survives terminal closures, install
[PM2](https://pm2.keymetrics.io/) and run `openwolf daemon start`. PM2 is
optional; `openwolf dashboard` works without it.

## Navigating large repos

Two commands answer questions the agent would otherwise grep for:

```bash
openwolf find validateToken        # ranked shortlist, under 1k tokens
openwolf find --file src/auth.ts   # one file: description, size, symbols
openwolf map --focus auth          # budgeted overview of the important files
```

`map` ranks files by personalized PageRank over the import graph, seeded by
what your sessions have touched and your focus terms.

## Team usage

`.wolf/` ships with a `.gitignore` that commits the state worth sharing
(cerebrum, STATUS, bug log, the index) and ignores machine-local runtime
(ledgers, caches, hook state). Commit `.wolf/` and your conventions, known
fixes, and project map reach every teammate and every agent through normal
code review.
