# Getting Started

## Prerequisites

- **Node.js 20+** ([download](https://nodejs.org)). OpenWolf's hooks run as Node.js scripts, so Node is required regardless of how your agent was installed.
- **At least one supported coding agent.** OpenWolf works with Codex, OpenCode, and Claude Code (full lifecycle hooks), plus Cursor and Antigravity (beta, context-level). `openwolf init` auto-detects which ones you have installed and wires each of them.

## Install OpenWolf

```bash
npm install -g openwolf
```

Verify the installation:

```bash
openwolf --version
```

## Initialize a project

Navigate to any project and run:

```bash
cd your-project
openwolf init
```

You'll see:

```
  ✓ Agents detected on this machine: codex, cursor (auto-wiring)
  ✓ Codex hooks registered (.codex/hooks.json)
  ✓ Skills installed: /security-audit, /reframe
  ✓ OpenWolf v2 initialized
  ✓ Claude Code hooks registered (7 hooks)
  ✓ Anatomy scan: 47 files indexed

  You're ready. Use your agents as normal. OpenWolf is watching.
```

That's it. No configuration needed. Use your agents as you normally would. To wire specific agents instead of auto-detecting, pass `--agent codex opencode`, `--agent all`, or `--agent claude` to opt out.

## Verify it's working

```bash
openwolf status
```

```
OpenWolf Status
===============

  ✓ All core files present
  ✓ All 7 hook scripts present
  ✓ Agent hooks registered

Token Stats:
  Sessions: 0
  Total reads: 0
  Total writes: 0
  Tokens tracked: ~0
  Estimated savings: ~0 tokens

Anatomy: 47 files tracked

Daemon: initialized
```

## What happens next?

Every time you run a supported agent in this project:

1. **Session starts** - OpenWolf injects a budgeted digest of your project's key state, then logs the start to `memory.md`
2. **Before file reads** - the hook checks for repeated reads and shows the anatomy description plus symbol line ranges for large files
3. **Before writes** - the hook scans your `cerebrum.md` Do-Not-Repeat list and warns if you're about to repeat a known mistake
4. **After reads** - token usage is estimated and tracked
5. **After writes** - the anatomy index is updated under a lock, `memory.md` gets a log entry
6. **Before compaction** - session state is snapshotted and restored, so no finished work is redone
7. **On stop** - measured token usage is read from the transcript into the ledger

You don't interact with any of this. It's invisible.

## View the dashboard

The simplest way to get going. This auto-starts the daemon and opens the dashboard:

```bash
openwolf dashboard
```

Opens the token-authenticated dashboard with measured vs estimated token usage, per-agent breakdown, project anatomy, context health, cron status, and more. Each project gets its own port automatically.

## Optional: Persistent daemon with PM2

For production use, you can run the daemon via [PM2](https://pm2.keymetrics.io/) for auto-restart and boot persistence:

```bash
npm install -g pm2
```

```bash
openwolf daemon start
```

::: tip Windows
Run `pm2-windows-startup` for boot persistence after installing PM2.
:::

::: info PM2 is optional
`openwolf dashboard` starts the daemon automatically without PM2. PM2 is only needed if you want the daemon to survive terminal closures and auto-start on boot.
:::

## AI-powered tasks

OpenWolf includes two optional weekly AI tasks. They use the Claude CLI with your **Claude subscription** (not API credits), and are the one Claude-specific maintenance feature; everything else works with any supported agent:

- **Cerebrum reflection**, reviews and cleans up `cerebrum.md` (Sundays 3am)
- **AI suggestions**, analyzes your project and generates improvement suggestions (Mondays 4am)

These run automatically via the daemon's cron scheduler. You can also trigger them manually:

```bash
openwolf cron run cerebrum-reflection
openwolf cron run project-suggestions
```

::: warning ANTHROPIC_API_KEY conflict
If you have `ANTHROPIC_API_KEY` set in your environment, OpenWolf automatically strips it when running AI tasks so that `claude -p` uses your subscription credentials from `~/.claude/.credentials.json` instead. This prevents "Credit balance is too low" errors when your API key has no credits but your subscription is active.
:::

## Reframe

Need help choosing a UI component framework? Run the `/reframe` skill or just ask your agent:

> Help me pick a UI framework for this project.

OpenWolf installs a `/reframe` slash command and ships a knowledge file (`.wolf/reframe-frameworks.md`) that your agent reads automatically. It covers 13 frameworks (shadcn/ui, Aceternity UI, Magic UI, DaisyUI, HeroUI, Chakra UI, Flowbite, Preline UI, Park UI, Origin UI, Headless UI, Cult UI, and Astryx) with a decision tree, comparison matrix, an anti-generic design mandate, and ready-made migration prompts.

It works as the `/reframe` skill (installed for Claude Code, Codex, and OpenCode) or through your agent's normal conversation flow.

::: tip Windows path separators
If you see path errors on Windows, ensure you're using a recent Node.js 20+ release. OpenWolf normalizes paths internally, but some edge cases require Node 20.10+.
:::
