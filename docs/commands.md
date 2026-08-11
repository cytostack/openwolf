# Commands

Complete reference for all OpenWolf CLI commands.

## `openwolf init`

Initialize OpenWolf in the current project.

```bash
openwolf init
```

**Options:**

```bash
openwolf init                          # auto-detect installed agents (default)
openwolf init --agent codex opencode   # wire exactly these agents
openwolf init --agent all              # wire every supported agent
openwolf init --agent claude           # Claude Code only, skip detection
```

**What it does:**
1. Detects the project root (looks for `.git`, `package.json`, `Cargo.toml`, etc.)
2. Creates `.wolf/` with the template files and the durable anatomy store
3. Copies the lifecycle hook scripts to `.wolf/hooks/`
4. Registers 7 hooks in `.claude/settings.json`
5. Auto-detects installed agents (Codex, OpenCode, Gemini CLI, Cursor) and wires each one: hook registrations, protocol blocks, or plugins as appropriate
6. Installs the bundled skills (`/security-audit`, `/reframe`) for every wired agent
7. Creates `.claude/rules/openwolf.md` and prepends the OpenWolf snippet to `CLAUDE.md`
8. Runs the initial anatomy scan (descriptions, token estimates, symbols)
9. Populates `cerebrum.md` with detected project name and description

If `.wolf/` already exists, it reinitializes (overwrites templates, preserves learned data).

::: info
If `.claude/settings.json` already has hooks, OpenWolf merges its hooks in, existing hooks are not overwritten.
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

  ✓ All core files present
  ✓ All 7 hook scripts present
  ✓ Agent hooks registered (claude, codex)

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

## `openwolf report`

Print the token report: estimated usage (character-ratio heuristic) next to
measured usage (summed from harness transcripts at session end), plus
lifetime stats and the most recent measured sessions.

```bash
openwolf report
```

Measured figures appear once sessions end under 2.0; older projects show
estimates only until then.

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
