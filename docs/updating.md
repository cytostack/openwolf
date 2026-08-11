# Update and Restore

How to keep OpenWolf current across projects and recover from problems.

## Overview

OpenWolf tracks every project where `openwolf init` has been run. The `update` command pushes new protocol files to all registered projects at once, while `restore` lets you roll back if something goes wrong.

---

## `openwolf update`

Updates all registered projects (or a specific one) to the latest OpenWolf version.

```bash
openwolf update
```

### What It Does

1. **Creates a timestamped backup** of each project's `.wolf/` directory before making any changes
2. **Overwrites protocol files** with the latest versions:
   - `OPENWOLF.md`
   - `reframe-frameworks.md`
   - Hook scripts in `.wolf/hooks/`
   - the agent rules in `.claude/rules/openwolf.md`
3. **Preserves user data**, these files are never overwritten:
   - `config.json` (ports and tunables survive updates)
   - `cerebrum.md` (learned preferences and conventions)
   - `memory.md` (session history)
   - `buglog.json` (bug tracking)
   - `anatomy.md` (project file map)
   - `STATUS.md` (session handoff, created from the template if missing)
   - Any custom files you added to `.wolf/`
4. **Updates hooks** registered in `.claude/settings.json` (your own hook entries are untouched)
5. **Re-runs the agent adapters** recorded in `config.json` (`openwolf.agents`), so Codex/OpenCode/Gemini/Cursor wiring picks up new hooks and templates
6. **Refreshes bundled skills** (`/security-audit`, `/reframe`) for every configured agent
7. **Reassigns colliding ports**: if a project shares its dashboard or daemon port with another registered project (common for 1.x upgrades), it is moved to a free pair so each project's dashboard opens independently

Running `openwolf update` and re-running `openwolf init` now produce the same result; use `update` to refresh every registered project at once.

### Options

```bash
openwolf update --dry-run              # show what would change, touch nothing
openwolf update --project my-app       # update only projects matching "my-app"
openwolf update --list                 # show all registered projects
```

| Flag | Description |
|------|-------------|
| `--dry-run` | Preview changes without writing any files. Shows which files would be overwritten, added, or skipped. |
| `--project <name>` | Update only projects whose name or path matches the given string. Partial matches work. |
| `--list` | Print all registered project paths and exit. No updates performed. |

---

## `openwolf restore`

Restore a project's `.wolf/` directory from a previous backup.

### List Available Backups

```bash
openwolf restore
```

Without arguments, this lists all available backups for the current project with their timestamps and sizes.

### Restore a Specific Backup

```bash
openwolf restore 2026-03-15T14-30-00
```

Pass a backup timestamp to restore `.wolf/` from that snapshot. The current `.wolf/` directory is replaced entirely with the backup contents.

::: warning
Restoring overwrites the entire `.wolf/` directory, including user data files like `cerebrum.md` and `memory.md`. If you have recent changes you want to keep, back them up manually first.
:::

---

## What Gets Backed Up

Every backup is a full copy of `.wolf/` at the time of the update. This includes:

| File | Type |
|------|------|
| `OPENWOLF.md` | Protocol |
| `config.json` | Protocol |
| `reframe-frameworks.md` | Protocol |
| `hooks/*` | Protocol |
| `cerebrum.md` | User data |
| `memory.md` | User data |
| `buglog.json` | User data |
| `anatomy.md` | User data |
| Any custom files in `.wolf/` | User data |

Backups are stored alongside the project and named by timestamp for easy identification.

---

## Registered Projects

Each time you run `openwolf init` in a project, that project's path is registered in OpenWolf's global state. This registry is what `openwolf update` iterates over.

To see all registered projects:

```bash
openwolf update --list
```

Output:

```
Registered projects:
  D:\WORKSPACE\my-app        (initialized 2026-02-10)
  D:\WORKSPACE\landing-site  (initialized 2026-02-28)
  D:\WORKSPACE\api-server    (initialized 2026-03-05)
```

Projects are registered automatically during `openwolf init`. There is no manual registration step. If a registered project path no longer exists (the directory was deleted or moved), `openwolf update` skips it and prints a warning.
