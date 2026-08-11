# Configuration

OpenWolf is configured via `.wolf/config.json`. All settings have sensible defaults, you do not need to change anything for normal use.

## Full Reference

```json
{
  "version": 1,
  "openwolf": {
    "enabled": true,
    "anatomy": { ... },
    "token_audit": { ... },
    "cron": { ... },
    "memory": { ... },
    "cerebrum": { ... },
    "daemon": { ... },
    "dashboard": { ... },
  }
}
```

## `anatomy`

Controls the project file scanner.

| Key | Default | Description |
|-----|---------|-------------|
| `auto_scan_on_init` | `true` | Run a full scan during `openwolf init` |
| `rescan_interval_hours` | `6` | How often the daemon rescans the project |
| `max_description_length` | `100` | Max characters for file descriptions |
| `max_files` | `500` | Stop scanning after this many files |
| `exclude_patterns` | *(see below)* | Directories and patterns to skip |

**Default exclude patterns:**

```json
[
  "node_modules", ".git", "dist", "build", ".wolf",
  ".next", ".nuxt", "coverage", "__pycache__", ".cache",
  "target", ".vscode", ".idea", ".turbo", ".vercel",
  ".netlify", ".output", "*.min.js", "*.min.css"
]
```

## `token_audit`

Controls token estimation and waste detection.

| Key | Default | Description |
|-----|---------|-------------|
| `enabled` | `true` | Enable token tracking |
| `report_frequency` | `"weekly"` | How often to generate waste reports |
| `waste_threshold_percent` | `15` | Alert when waste exceeds this percentage |
| `chars_per_token_code` | `3.5` | Character-to-token ratio for code files |
| `chars_per_token_prose` | `4.0` | Character-to-token ratio for prose files |

## `cron`

Controls the daemon's task scheduler.

| Key | Default | Description |
|-----|---------|-------------|
| `enabled` | `true` | Enable cron tasks |
| `max_retry_attempts` | `3` | Times to retry a failed task before dead-lettering |
| `dead_letter_enabled` | `true` | Move exhausted tasks to dead letter queue |
| `heartbeat_interval_minutes` | `30` | Daemon health check frequency |
| `use_claude_p` | `true` | Use `claude -p` (subscription) for AI-powered tasks |
| `api_key_env` | `null` | Environment variable name for API key override. When `null`, uses `claude -p` OAuth credentials |

## `memory`

Controls the action log.

| Key | Default | Description |
|-----|---------|-------------|
| `consolidation_after_days` | `7` | Compress sessions older than this |
| `max_entries_before_consolidation` | `200` | Force consolidation at this count |

## `cerebrum`

Controls the learning memory.

| Key | Default | Description |
|-----|---------|-------------|
| `max_tokens` | `2000` | Keep cerebrum.md under this token count |
| `reflection_frequency` | `"weekly"` | How often AI reviews and prunes cerebrum |

## `daemon`

Controls the background daemon process.

| Key | Default | Description |
|-----|---------|-------------|
| `port` | `18790` | Daemon HTTP API port |
| `log_level` | `"info"` | Log verbosity: `"debug"`, `"info"`, `"warn"`, `"error"` |

## `dashboard`

Controls the web dashboard.

| Key | Default | Description |
|-----|---------|-------------|
| `enabled` | `true` | Serve the dashboard |
| `port` | `18791` | Dashboard HTTP and WebSocket port |

::: tip
The dashboard port is also the daemon's HTTP server port for the web UI. Change this if 18791 conflicts with another service.
:::

## `context`

Per-agent token budgets for the session digest injected at session start.

```json
"context": {
  "session_digest_budget_tokens": 1500,
  "budgets": {
    "claude": 1500,
    "codex": 1200,
    "gemini": 1200,
    "opencode": 1200,
    "cursor": 800
  }
}
```

The digest packs the highest-value state first (STATUS.md next phase, the
Do-Not-Repeat list, recent bug fixes, the anatomy pointer) and stops at the
budget, so injection cost stays fixed and predictable.
