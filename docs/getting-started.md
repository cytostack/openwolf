# Getting Started

## Prerequisites

- **Node.js 20+** -- [download](https://nodejs.org). Required because OpenWolf's hooks run as Node.js scripts.
- **Claude Code or Codex App** -- OpenWolf supports Claude Code project hooks and Codex App global hooks.

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
  ✓ OpenWolf initialized
  ✓ .wolf/ created with 11 files
  ✓ Claude Code hooks registered (6 hooks)
  ✓ Codex App hooks registered (6 hooks)
  ✓ CLAUDE.md updated
  ✓ .claude/rules/openwolf.md created
  ✓ Anatomy scan: 47 files indexed
  ✓ Daemon: start manually with: openwolf daemon start

  You're ready. Use Claude Code or Codex App normally. OpenWolf is watching.
```

That's it. No configuration needed. Use `claude` or Codex App as you normally would.

## Verify it's working

```bash
openwolf status
```

```
OpenWolf Status
===============

  ✓ All 11 core files present
  ✓ All 7 hook scripts present
  ✓ Claude Code hooks registered (6 matchers)
  ✓ Codex App hooks registered (6 hooks)

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

Every time you run Claude Code in this project, or use Codex App with this project open:

1. **Session starts** -- OpenWolf creates a session tracker and logs the start to `memory.md`
2. **Before file reads** -- the hook checks if the file was already read (warns you) and shows the anatomy description
3. **Before writes** -- the hook scans your `cerebrum.md` Do-Not-Repeat list and warns if you're about to repeat a known mistake
4. **After reads** -- token usage is estimated and tracked
5. **After writes** -- `anatomy.md` is updated with the new/changed file, `memory.md` gets a log entry
6. **On stop** -- session totals are written to the token ledger

You don't interact with any of this. It's invisible.

## Codex App hooks

For Codex App, `openwolf init` writes a small adapter to `~/.codex/hooks/openwolf_codex_hook.mjs` and merges OpenWolf entries into `~/.codex/hooks.json`. Existing Codex hooks are preserved. The adapter translates Codex tool names and payloads into OpenWolf's hook format, including `functions.apply_patch`, `functions.shell_command`, and `multi_tool_use.parallel`.

If Codex App was already open, start a new Codex App session after running `openwolf init` so it reloads the hook configuration.

## View the dashboard

The simplest way to get going. This auto-starts the daemon and opens the dashboard:

```bash
openwolf dashboard
```

Opens `http://localhost:18791` with real-time token usage, project anatomy, cron status, cerebrum state, and more.

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

OpenWolf includes two weekly AI tasks that use your **Claude subscription** (not API credits):

- **Cerebrum reflection** -- reviews and cleans up `cerebrum.md` (Sundays 3am)
- **AI suggestions** -- analyzes your project and generates improvement suggestions (Mondays 4am)

These run automatically via the daemon's cron scheduler. You can also trigger them manually:

```bash
openwolf cron run cerebrum-reflection
openwolf cron run project-suggestions
```

::: warning ANTHROPIC_API_KEY conflict
If you have `ANTHROPIC_API_KEY` set in your environment, OpenWolf automatically strips it when running AI tasks so that `claude -p` uses your subscription credentials from `~/.claude/.credentials.json` instead. This prevents "Credit balance is too low" errors when your API key has no credits but your subscription is active.
:::

## Design QC

Design QC captures full-page sectioned screenshots of your running app so Claude can evaluate the design. It requires `puppeteer-core` and a Chrome/Chromium installation:

```bash
npm install -g puppeteer-core
```

Then run:

```bash
openwolf designqc
```

OpenWolf will auto-detect (or start) your dev server, detect routes from your project structure, and capture screenshots at desktop (1440px) and mobile (375px) viewports. Screenshots are saved to `.wolf/designqc-captures/`.

After capture, tell Claude:

> Read the screenshots in `.wolf/designqc-captures/` and evaluate the design.

Claude reads the images directly and provides inline feedback. No external design tools or services needed.

::: tip Options
Use `--url http://localhost:3000` to specify a dev server URL manually. Use `--desktop-only` to skip mobile captures. Use `--routes /,/about,/pricing` to capture specific routes.
:::

## Reframe

Need help choosing a UI component framework? Just ask Claude:

> Help me pick a UI framework for this project.

OpenWolf ships a knowledge file (`.wolf/reframe-frameworks.md`) that Claude reads automatically. It covers 12 frameworks -- shadcn/ui, Aceternity UI, Magic UI, DaisyUI, HeroUI, Chakra UI, Flowbite, Preline UI, Park UI, Origin UI, Headless UI, and Cult UI -- with a decision tree, comparison matrix, and ready-made migration prompts.

There is no CLI command for reframe. It works through Claude's normal conversation flow.

::: tip Windows path separators
If you see path errors on Windows, ensure you're using a recent Node.js 20+ release. OpenWolf normalizes paths internally, but some edge cases require Node 20.10+.
:::
