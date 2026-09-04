# Configuration

OpenWolf is configured through `.wolf/config.json`. Every setting has a
sensible default; nothing needs changing for normal use. `openwolf update`
merges newly introduced keys into existing configs without touching your
values.

```json
{
  "version": 1,
  "openwolf": {
    "enabled": true,
    "reads": { ... },
    "bash": { ... },
    "context": { ... },
    "anatomy": { ... },
    "token_audit": { ... },
    "cron": { ... },
    "memory": { ... },
    "cerebrum": { ... },
    "daemon": { ... },
    "dashboard": { ... }
  }
}
```

## `reads`

Duplicate-read handling and read hints.

| Key | Default | Description |
|-----|---------|-------------|
| `duplicate_mode` | `"warn"` | `"warn"` advises on duplicate full reads; `"deny"` blocks each duplicate once (with a pass-through retry so the model is never stranded); `"off"` disables |
| `skeleton_hints` | `true` | For large indexed files, serve a signature outline in the pre-read hint instead of the largest-sections line |

## `bash`

The Bash channel: the pre-run suggestion filter and the output governor.

| Key | Default | Description |
|-----|---------|-------------|
| `filter_mode` | `"suggest"` | Pre-run note for flood-prone commands: `"suggest"` or `"off"` |
| `governor.mode` | `"replace"` | Master switch: `"replace"`, `"suggest"`, or `"off"` |
| `governor.threshold_tokens` | `2000` | Only results above this size are governed |
| `governor.families` | *(below)* | Per-family action override |

Default family actions:

```json
"families": {
  "grep_flood": "replace",
  "file_print": "replace",
  "git_show": "replace",
  "test": "suggest",
  "build": "suggest",
  "unknown": "suggest"
}
```

Only the three losslessly recoverable families replace by default. Test and
build output is never replaced unless you opt in, and stderr is never
modified by any family. Full outputs are always preserved at
`.wolf/cache/bash/`.

## `context`

Session digest, rule re-injection, and state budgets.

| Key | Default | Description |
|-----|---------|-------------|
| `session_digest_budget_tokens` | `1500` | Upper bound for the session-start injection (the index targets ~400) |
| `budgets` | per agent | Per-agent digest budgets (`claude` 1500, `codex` 1200, `cursor` 800, ...) |
| `reinjection_interval` | `25` | Re-surface the top Do-Not-Repeat rules every N tool batches; `0` disables |
| `state_budgets` | `{".wolf/cerebrum.md": 2000, ".wolf/STATUS.md": 1000}` | Token budgets enforced with one warning per session on over-budget writes |

## `anatomy`

The project scanner.

| Key | Default | Description |
|-----|---------|-------------|
| `auto_scan_on_init` | `true` | Run a full scan during `openwolf init` |
| `rescan_interval_hours` | `6` | Daemon rescan cadence. Rescans are skipped when the index is provably fresh (stat sweep + git HEAD) |
| `max_description_length` | `100` | Max characters per file description |
| `max_files` | `500` | Stop scanning after this many files |
| `exclude_patterns` | node_modules, .git, dist, ... | Directories and globs to skip |

Lockfiles, OS junk, caches, coverage, minified files, and agent-config
directories (`.claude`, `.codex`, and friends) are excluded built-in,
regardless of this list.

## `token_audit`

| Key | Default | Description |
|-----|---------|-------------|
| `enabled` | `true` | Token tracking |
| `chars_per_token_code` | `3.5` | Estimation ratio for code |
| `chars_per_token_prose` | `4.0` | Estimation ratio for prose |
| `waste_threshold_percent` | `15` | Waste-alert threshold |

Estimates are the softest tier; measured and verified numbers come from
transcripts and are unaffected by these ratios.

## `cron`

| Key | Default | Description |
|-----|---------|-------------|
| `enabled` | `true` | Scheduled tasks |
| `max_retry_attempts` | `3` | Retries before dead-lettering |

## `memory` and `cerebrum`

| Key | Default | Description |
|-----|---------|-------------|
| `memory.consolidation_after_days` | `7` | Compress session blocks older than this |
| `cerebrum.max_tokens` | `2000` | Target size for cerebrum.md |

## `daemon` and `dashboard`

| Key | Default | Description |
|-----|---------|-------------|
| `daemon.port` | per project | Daemon HTTP API port |
| `dashboard.port` | per project | Dashboard HTTP and WebSocket port |
| `dashboard.enabled` | `true` | Serve the dashboard |

Ports are assigned per project at init so multiple dashboards never collide,
and they survive updates.
