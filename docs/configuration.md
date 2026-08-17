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
| `provider` | `null` | Selects an inference provider for AI-powered tasks. When `null`, uses `claude -p` OAuth credentials |

### `cron.provider`

When set, AI-powered cron tasks (`ai_task`) run against a configured inference
provider that exposes an Anthropic-compatible endpoint, instead of the default
`claude -p` subscription credentials. The `claude` CLI is pointed at the
provider's regional base URL and asked for the selected model.

| Key | Default | Description |
|-----|---------|-------------|
| `id` | — | Provider registry key. Supported: `minimax` |
| `region` | `global_en` | Endpoint region. `minimax`: `global_en`, `cn_zh` |
| `model` | provider default | Model to request. `minimax`: `MiniMax-M3`, `MiniMax-M2.7` |

The registry also exposes model metadata for tooling and validation. Prices are
in US dollars per million tokens.

| Model | Context | Input / output | Cache read / write | Input modalities | Thinking modes |
|-------|---------|----------------|--------------------|------------------|----------------|
| `MiniMax-M3` | 1,000,000 | $0.60 / $2.40 | $0.12 / unavailable | text, image, video | adaptive, disabled |
| `MiniMax-M2.7` | 204,800 | $0.30 / $1.20 | $0.06 / $0.375 | text | always on |

The provider API key is read from the provider's environment variable
(`minimax`: `MINIMAX_API_KEY`). Example:

```json
"cron": {
  "provider": { "id": "minimax", "region": "global_en", "model": "MiniMax-M3" }
}
```

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
