# Command reference

Run commands from the project directory unless a command explicitly selects registered projects. This reference covers the 2.5.3 release. Use `openwolf --version` and `openwolf <command> --help` to check your installed CLI.

## Installation and status

```bash
openwolf init
openwolf init --agent claude codex opencode antigravity
openwolf status
openwolf status --all
openwolf operations doctor
```

`init` creates project memory and registers selected agents. `status` checks the installation. `operations doctor` also reports memory authority and update readiness. Existing malformed settings are preserved and reported for repair.

## Project map

```bash
openwolf scan
openwolf scan --check
openwolf find validateToken
openwolf find --file src/auth.ts
openwolf map --focus auth,jwt --budget 1000
```

`scan` refreshes eligible index entries. `scan --check` checks freshness without writing and exits with a failure status when the index does not match. `find` searches indexed paths and symbols. `map` returns a focused overview within an estimated token budget.

## Recorded usage

```bash
openwolf usage report --json
openwolf usage report --agent codex --json
openwolf usage reconcile
openwolf report
```

`usage report` reads available Claude, Codex and OpenCode records and reports coverage. `usage reconcile` persists the shared report and recovers retained observations. `report` also shows the operational ledger and estimates. None of these commands starts a model conversation.

## Save a checkpoint

Create a JSON file with the task fields you want to save:

```json
{
  "objective": "Fix expired-session handling",
  "next_action": "Run the authentication tests",
  "unresolved": ["The expired-session case is still failing"],
  "completed": ["Updated the token validation check"]
}
```

Use the actual receiving agent session ID:

```bash
openwolf handoff checkpoint --agent codex --session SESSION_ID --file checkpoint.json
```

## Inspect and transfer a session

```bash
openwolf handoff list --from claude
openwolf handoff read --from claude --session SOURCE_ID
openwolf handoff export --from claude --session SOURCE_ID --to codex --preview
openwolf handoff export --from claude --session SOURCE_ID --to codex
openwolf handoff inspect PACKET_ID
openwolf handoff import PACKET_ID --to codex --session RECEIVING_ID
```

Replace the capitalised values with IDs from the current project. Inspect the preview before writing a packet, then inspect the packet before import. Import checks identity, source records and repository drift. `--allow-drift` is for explicitly reviewed historical evidence; it is not a repair for changed or missing source records.

```bash
openwolf handoff recover --from codex --session SESSION_ID
openwolf handoff search "expired session"
```

Recovery uses saved records when observations are missing. Search returns relevant saved evidence. See [handover details](claude-codex-handoff-plan.md).

Antigravity sessions can take part too (`--from antigravity` / `--to antigravity` / `--agent antigravity`), sourced from the hook-captured checkpoint state rather than a decoded transcript. See the [Antigravity limits](hooks.md#antigravity-limits) for what that does and does not cover.

## Close an Antigravity session

Antigravity has no automatic session-end event: its `Stop` mapping fires every turn, not once at session close, so the ledger's final flush and the "Session end" line in `memory.md` need an explicit close:

```bash
openwolf finalize --agent antigravity --session SESSION_ID
```

Run it after the final turn of an Antigravity session. It is safe to run more than once; a session that is already finalized reports `finalized: false`.

## Session notes and archives

```bash
openwolf memory log --session SESSION_ID --summary "Updated token validation" --files src/auth.ts --outcome "Expired-session test still fails"
openwolf memory archive --days 7 --dry-run
openwolf memory archive --days 7
openwolf memory restore ARCHIVE_ID
openwolf maintenance --dry-run
```

Archive previews do not write. Archival retains the latest block, pinned notes and tracked active sessions. Restore verifies the stored content before changing active memory. `maintenance` combines memory maintenance and usage reconciliation; inspect its preview first.

## Durable memory review

```bash
openwolf memory review --json
openwolf operations prepare --output NEW_REVIEW_DIRECTORY
```

These commands produce review material. They do not grant authority. `memory approve` and `memory revoke` are independent administrator operations for a protected deployment. Follow the [operations guide](repair-operations.md).

## Dashboard and daemon

```bash
openwolf dashboard
openwolf daemon status
openwolf daemon start
openwolf daemon stop
openwolf daemon restart
openwolf daemon logs
```

The dashboard can start a local daemon without PM2. Persistent daemon management uses the supported PM2 integration where installed. Stop commands verify daemon ownership rather than stopping any process that happens to use a port.

## Updates and backups

```bash
openwolf update --list
openwolf update --dry-run
openwolf update --project my-app
openwolf self-update --status
openwolf self-update
openwolf restore
```

`update` refreshes registered projects from the package already installed on your machine. `self-update` checks npm and prepares a compatible project runtime under the configured policy. It does not replace the global CLI. `restore` lists backups; `restore BACKUP_NAME` restores the selected snapshot and can replace newer project state.

## Bugs and scheduled tasks

```bash
openwolf bug search "cannot read properties"
openwolf cron list
openwolf cron run TASK_ID
openwolf cron retry TASK_ID
openwolf cron enable TASK_ID
openwolf cron disable TASK_ID
```

## Benchmarks

```bash
openwolf bench --repo /path/to/fixture --yes
```

The benchmark runs coding tasks with and without OpenWolf through the supported benchmark runner. It uses real model access and can consume paid usage. It requires `--yes`. Results apply to those tasks and runs, not every project or agent.

### Saved observations versus transfer packets

`openwolf handoff observations --agent claude --session <id>` reads the materialized session's bounded recent hook observations. These are historical, unverified observations; older entries outside that window may no longer be available there. Use `--agent codex` for Codex sessions.

`openwolf handoff inspect <id>` expects a SHA-256 transfer-packet ID from `handoff export`. A tool-call observation ID is not a packet ID. Neither a saved observation nor a successful historical command establishes a current pass after inputs change.
