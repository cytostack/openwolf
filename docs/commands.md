# Commands

Complete reference for all OpenWolf CLI commands.

## `openwolf init`

Initialize OpenWolf in the current project.

```bash
openwolf init
```

**What it does:**
1. Detects the project root (looks for `.git`, `package.json`, `Cargo.toml`, etc.)
2. Creates `.wolf/` with 10 template files
3. Copies 7 hook scripts to `.wolf/hooks/`
4. Registers 6 Claude Code hooks in `.claude/settings.json`
5. Installs Codex App adapter hooks in `~/.codex/hooks.json`
6. Creates `.claude/rules/openwolf.md`
7. Prepends the OpenWolf snippet to `CLAUDE.md`
8. Runs an initial anatomy scan
9. Populates `cerebrum.md` with detected project name and description

If `.wolf/` already exists, it reinitializes (overwrites templates, preserves learned data).

::: info
If `.claude/settings.json` or `~/.codex/hooks.json` already has hooks, OpenWolf merges its hooks in -- existing hooks are not overwritten.
:::

---

## `openwolf status`

Show health, stats, and file integrity.

```bash
openwolf status
```

**Output:**
```
OpenWolf Status
===============

  ✓ All 10 core files present
  ✓ All 7 hook scripts present
  ✓ Claude Code hooks registered (6 matchers)
  ✓ Codex App hooks registered (6 hooks)

Token Stats:
  Sessions: 12
  Total reads: 87
  Total writes: 34
  Tokens tracked: ~45,200
  Estimated savings: ~8,400 tokens

Anatomy: 79 files tracked

Daemon: running
  Last heartbeat: 2 minutes ago
```

---

## `openwolf scan`

Force a full anatomy rescan of the project.

```bash
openwolf scan
```

```
Scanning project...
  ✓ Anatomy scan complete: 79 files indexed in 42ms
```

### `openwolf scan --check`

Compare the current filesystem against `anatomy.md` without writing any changes. Exits with code 1 if the anatomy is out of date.

```bash
openwolf scan --check
```

Useful in CI pipelines to verify that `anatomy.md` has been kept in sync:

```bash
openwolf scan --check || echo "anatomy.md is out of date. Run openwolf scan"
```

---

## `openwolf dashboard`

Open the real-time dashboard in your default browser.

```bash
openwolf dashboard
```

If the daemon is not running, this command **automatically starts it** as a background process. No PM2 required.

The dashboard opens at `http://localhost:18791` and connects via WebSocket for live updates.

---

## `openwolf daemon`

Manage the background daemon process.

### `openwolf daemon start`

Start the daemon via [PM2](https://pm2.keymetrics.io/) for persistent background operation.

```bash
openwolf daemon start
```

The daemon handles:
- Cron tasks (anatomy rescans, memory consolidation, AI reflections)
- File watching and WebSocket broadcasting
- Dashboard HTTP server
- Health heartbeat

::: info PM2 is optional
You do not need PM2 to use the daemon. Running `openwolf dashboard` starts the daemon automatically via Node's `fork()`. PM2 is only needed for auto-restart and boot persistence.
:::

::: tip Windows
Run `pm2-windows-startup` for boot persistence.
:::

### `openwolf daemon stop`

Stop the running daemon. Works whether the daemon was started via PM2 or via `openwolf dashboard`:

```bash
openwolf daemon stop
```

- First tries to stop via PM2
- Falls back to finding the process listening on the dashboard port and killing it directly

### `openwolf daemon restart`

```bash
openwolf daemon restart
```

### `openwolf daemon logs`

Show the last 50 lines of daemon output.

```bash
openwolf daemon logs
```

---

## `openwolf cron`

Manage scheduled cron tasks.

### `openwolf cron list`

Show all tasks with their schedule, status, and last run time.

```bash
openwolf cron list
```

```
Cron Tasks
==========

  Full anatomy rescan (anatomy-rescan)
    Schedule: Every 6 hours
    Status: enabled
    Last run: 3 hours ago

  Consolidate old memory (memory-consolidation)
    Schedule: Daily at 2:00 AM
    Status: enabled
    Last run: yesterday

  Token audit report (token-audit)
    Schedule: Mondays at midnight
    Status: enabled
    Last run: 5 days ago

  Cerebrum reflection (cerebrum-reflection)
    Schedule: Sundays at 3:00 AM
    Status: enabled
    Last run: 2 days ago
    Uses: claude -p (subscription)

  AI suggestions (project-suggestions)
    Schedule: Mondays at 4:00 AM
    Status: enabled
    Last run: 5 days ago
    Uses: claude -p (subscription)
```

### `openwolf cron run <id>`

Manually trigger a cron task by ID.

```bash
openwolf cron run anatomy-rescan
```

```bash
openwolf cron run project-suggestions
```

The command first attempts to dispatch the task through the daemon's HTTP API. If the daemon is not running, it falls back to executing the task directly in the current process. The daemon is **not** required.

### `openwolf cron retry <id>`

Remove a task from the dead letter queue so it retries on its next schedule.

```bash
openwolf cron retry cerebrum-reflection
```

---

## `openwolf update`

Update all registered OpenWolf projects to the latest templates.

```bash
openwolf update
```

**Options:**

| Flag | Description |
|------|-------------|
| `--dry-run` | Show what would be updated without making changes |
| `--project <name>` | Update only a specific project (partial name match) |
| `--list` | List all registered projects and their paths |

Before making any changes, `update` creates a timestamped backup of the existing `.wolf/` directory. You can restore from these backups with [`openwolf restore`](#openwolf-restore).

```bash
# Preview changes without writing anything
openwolf update --dry-run

# Update a single project
openwolf update --project my-app

# See all registered projects
openwolf update --list
```

---

## `openwolf restore`

Restore `.wolf/` from a backup created by `openwolf update`. Run this from the project directory.

```bash
openwolf restore [backup]
```

Without arguments, lists all available backups:

```bash
openwolf restore
```

With a backup name, restores from that backup:

```bash
openwolf restore 2026-03-15T10-30-00
```

---

## `openwolf designqc`

Capture full-page screenshots for design evaluation by Claude Code.

```bash
openwolf designqc [target]
```

**Options:**

| Flag | Default | Description |
|------|---------|-------------|
| `--url <url>` | *(auto-detect)* | Dev server URL. Auto-starts the dev server if omitted |
| `--routes <routes...>` | *(all detected)* | Specific routes to capture |
| `--quality <n>` | `70` | JPEG quality 1--100. Lower values produce smaller files and consume fewer tokens |
| `--max-width <n>` | `1200` | Maximum capture width in pixels |
| `--desktop-only` | `false` | Skip mobile viewport captures |

**Requires:** `puppeteer-core` must be installed in the project or globally.

```bash
npm install puppeteer-core
```

**How it works:**

1. Detects or starts the project's dev server (Vite, Next.js, etc.)
2. Launches a headless Chrome/Edge instance
3. Captures full-page screenshots, split into sections (max 8 sections per route) for large pages
4. Saves all captures to `.wolf/designqc-captures/`

Screenshots are JPEG at the configured quality to keep file sizes and token counts low.

**Full workflow:**

```bash
# Step 1: capture screenshots
openwolf designqc

# Step 2: ask Claude to evaluate the design
# In your Claude Code session, say:
#   "Read the screenshots in .wolf/designqc-captures/ and evaluate the design"
```

Claude evaluates the screenshots inline using its vision capabilities. No separate API key is needed beyond your existing Claude Code subscription.

**Examples:**

```bash
# Capture specific routes only
openwolf designqc --routes / /about /pricing

# Point at a running server, desktop only
openwolf designqc --url http://localhost:3000 --desktop-only

# Lower quality for faster iteration
openwolf designqc --quality 40 --max-width 800
```

---

## `openwolf bug search <term>`

Search the bug memory for matching entries.

```bash
openwolf bug search "cannot read properties"
```

```
Found 2 matching bug(s):

  [bug-003] TypeError: Cannot read properties of undefined (reading 'map')
    File: src/components/UserList.tsx
    Root cause: API response was null when users array was expected
    Fix: Added optional chaining: data?.users?.map() and fallback empty array
    Tags: null-check, api-response, typescript, react
    Occurrences: 3 | Last seen: 2026-03-09T14:30:00Z
```

Searches across: error messages, root causes, fixes, tags, and file paths.

---

## `openwolf --version`

Print the current OpenWolf version. The version is read from `package.json` at runtime.

```bash
openwolf --version
```

```
1.0.0
```
