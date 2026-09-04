# Troubleshooting

Common issues and their solutions.

## Hooks not firing

**Symptom:** No digest at session start, no tracking, no memory entries.

**Diagnosis first:** OpenWolf can tell you what is wrong.

```bash
openwolf status
```

Checks that the hook scripts exist and the agent registrations are in place.
Then look at hook health: every hook writes a heartbeat to
`.wolf/hooks/_heartbeat.json` with its last success, last error, and
consecutive failures. The dashboard's context-health card shows failing
hooks with the actual error, and the session-start digest itself reports a
degraded install.

**Fix:** `openwolf update` reinstalls the hooks and then verifies the
install with a per-hook selfcheck. If verification fails, the error names
the broken file.

## `openwolf update` downgraded my projects

**Symptom:** After running `openwolf update`, projects show an older
version and features disappear.

**Cause:** A stale global install on another Node installation (for example
under `/usr/local` from a pre-nvm setup) resolved first in your shell, and
its old `update` overwrote the hooks with old versions.

**Fix:**

```bash
which openwolf && openwolf --version
```

If the version is old, delete the binary and package at the path `which`
printed, run `hash -r`, then run `openwolf update` from the current install.
Everything is restored; user data was never touched and backups exist from
before the downgrade.

## The dashboard hero shows 0 tokens kept out of context

**Cause:** Nothing has been governed yet. The number accumulates as the Bash
governor condenses oversized output (results over 2,000 tokens), and it only
ever shows measured deltas, never estimates. Short sessions with small
outputs legitimately show 0.

**Check:** run a command with big output through your agent (a broad grep,
a `git show` of a large commit) and watch `openwolf report`'s governor
section.

## Governed output lost something the model needed

**Symptom:** The agent re-runs a command to recover detail after
condensation.

**Fix:** The full output is always preserved at `.wolf/cache/bash/<id>.log`
and the condensed result points at it, so the model can read the log instead
of re-running. If a command family is condensed too aggressively for your
workflow, set it to `"suggest"` or `"off"` in `openwolf.bash.governor.families`.
Test and build output is suggest-only by default for exactly this reason.

## A cron task fails with "ai_task is no longer supported"

**Cause:** A `.wolf/cron-manifest.json` written before 2.5 still lists the
weekly cerebrum-reflection or project-suggestions task. Those were the only
things in OpenWolf that ever called a model, and they are gone.

**Fix:** Run `openwolf update`, or delete the `ai_task` entries from
`.wolf/cron-manifest.json` by hand. Nothing else depends on them.

## Dashboard shows the wrong project, or a 401

**Cause:** Port collision between projects (common on 1.x upgrades), or a
stale token in the URL.

**Fix:** `openwolf update` assigns every project a unique port pair.
`openwolf dashboard` always opens the right port with a fresh token.

## Port already in use

`openwolf dashboard` starts on a free port automatically when the configured
one is taken. To pin a specific port, set `openwolf.dashboard.port` in
`.wolf/config.json`.

## Anatomy scan finds 0 files

**Cause:** Wrong project root, or everything excluded.

**Fix:** Check `anatomy.exclude_patterns` in `.wolf/config.json`. Note that
lockfiles, caches, minified files, and agent-config directories are excluded
built-in and never appear in the index.

## `scan --check` exits 1

Expected: exit 1 means the index no longer matches the tree. Run
`openwolf scan` and re-check. Useful as a CI gate for committed indexes.

## `openwolf find` returns nothing for a symbol I can see

Symbols are extracted for files above ~500 estimated tokens; very small
files are indexed with a description only. Path queries still match
(`openwolf find --file <path>` shows what the index holds for any file). If
a large file is missing symbols, run `openwolf scan` to refresh the
tree-sitter pass.

## Daemon will not stop

`openwolf daemon stop` handles both PM2-managed and forked daemons, falling
back to killing the process on the dashboard port. Manual fallback:

::: code-group
```bash [macOS/Linux]
lsof -ti :<port> | xargs kill
```

```bash [Windows]
netstat -ano -p tcp | findstr :<port>
taskkill /PID <pid> /F
```
:::

## Commands say "OpenWolf not initialized"

The project has no `.wolf/` directory. Run `openwolf init` in the project
root.
