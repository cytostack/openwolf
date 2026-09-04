# Update and Restore

How to keep OpenWolf current across projects and recover from problems.

## `openwolf update`

Updates every registered project (or one) to the installed OpenWolf version.

```bash
openwolf update
openwolf update --project my-app   # partial name match
openwolf update --dry-run          # preview, touch nothing
openwolf update --list             # show registered projects
```

### What it does, in order

1. **Backup.** A timestamped copy of `.wolf/` is created before anything
   changes. `openwolf restore` rolls back to any of them.
2. **Config merge.** Newly introduced settings are added to your
   `config.json` without touching existing values. Ports, budgets, and
   custom excludes survive every update.
3. **Dead-weight cleanup.** Files shipped by older versions that your
   project never used are removed, but only when they are byte-identical to
   our templates or verifiably empty stubs. Anything you edited stays.
4. **Hook refresh.** All hook scripts are replaced with the current
   versions, and OpenWolf's entries in `.claude/settings.json` are updated.
   Your own hook entries are never touched.
5. **Install verification.** Every hook file must exist, and every
   registered hook must pass a selfcheck (its imports must load). A failure
   fails the whole project update loudly. This exists because a missing
   dependency file once broke a hook silently for three weeks; now that
   class of failure is caught at install time, at session start, and on the
   dashboard.
6. **Adapters and skills.** The agents recorded in your config
   (Codex, OpenCode, Gemini, Cursor) are re-wired, and the skills are
   refreshed. Customized skill files are left alone.
7. **State migrations.** One-time repairs and migrations (ledger corrections,
   snippet upgrades) run idempotently. A legacy `CLAUDE.md` snippet is
   replaced with the current stub only when it is byte-identical to
   something we shipped.
8. **Memory sync.** On Claude Code, the cerebrum syncs with native
   auto-memory in both directions.

### What is never overwritten

`config.json`, `cerebrum.md`, `memory.md`, `buglog.json`, `anatomy.md` and
the index, `STATUS.md`, and any custom files you added to `.wolf/`.

## `openwolf restore [backup]`

```bash
openwolf restore                    # list available backups
openwolf restore 2026-08-20T1655    # restore this one
```

Restores `.wolf/` (and the backed-up `.claude` settings and rules) from the
snapshot. Restoring replaces current state including user data, so check the
timestamp before you pull the trigger.

## Registered projects

Every `openwolf init` registers the project path. `openwolf update` iterates
that registry and skips paths that no longer exist.

```bash
openwolf update --list
```

## One global install

Keep exactly one global OpenWolf on your machine. If an old copy lingers on
another Node installation (for example under `/usr/local` from a pre-nvm
setup), your shell can resolve it first and an `openwolf update` from an old
version will downgrade your projects' hooks. Check with:

```bash
which openwolf && openwolf --version
```

If the version is older than you installed, remove the stale copy (the path
`which` printed) and run `hash -r`. A downgraded project is fully repaired
by running `openwolf update` again from the current version; backups from
before the downgrade also remain available.
