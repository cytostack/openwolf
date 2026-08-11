# Changelog

All notable changes to OpenWolf are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and OpenWolf uses
[Semantic Versioning](https://semver.org/).

## [2.0.2] - 2026-07-15

### Added

- Antigravity agent adapter (beta, context-level via `AGENTS.md`).
  `openwolf init --agent antigravity` and `--agent all` now include it, and
  auto-detection picks it up when Antigravity is installed.

### Changed

- Documentation and website refreshed to reflect v2 throughout: the seven
  lifecycle hooks including PreCompact, the durable anatomy store with
  symbol-level reads, measured token usage, the redesigned dashboard, the
  `/reframe` skill, and per-project dashboard ports. Retired Design QC
  content removed. Positioning generalized across supported agents.

## [2.0.1] - 2026-07-15

### Fixed

- Dashboard no longer white-screens when the server rejects the token. A 401
  now renders a clear "token rejected" message with guidance instead of
  crashing the page. Root cause: `StatusBadge` threw on an undefined status,
  and failed API responses were being fed into component state.
- Multi-project port collisions resolved. Projects upgraded from 1.x all kept
  the shared default dashboard and daemon ports, so only the first project's
  dashboard would ever open. Three fixes work together: `openwolf update`
  reassigns a free port pair when a project's ports collide with another
  registered project, `openwolf dashboard` starts this project's server on a
  free port when the configured one is held by another project's daemon
  (instead of opening a URL that gets a 401), and the daemon accepts an
  `OPENWOLF_DASHBOARD_PORT` override. Fresh installs already received unique
  ports; this brings upgraded projects to parity.

## [2.0.0] - 2026-07-15

OpenWolf 2.0 turns the second brain for Claude Code into a context layer for
every AI coding assistant, with verifiable token measurement, a hardened
security posture, and a re-architected project index.

### Added

Multi-agent support:

- Agent adapter architecture: `openwolf init` now auto-detects the coding
  agents installed on your machine and wires each of them to the same `.wolf/`
  brain. Explicit control via `--agent codex opencode gemini cursor`, `--agent all`,
  or `--agent claude` to opt out.
- Codex CLI integration: project-level lifecycle hooks via `.codex/hooks.json`
  plus an `AGENTS.md` protocol block.
- OpenCode integration: a native plugin installed to `.opencode/plugin/` that
  maps OpenCode tool events onto the `.wolf/` state.
- Gemini CLI integration: `GEMINI.md` protocol block.
- Cursor integration: an always-applied rule at `.cursor/rules/openwolf.mdc`.
- Protocol blocks are marker-fenced and idempotent: your own content in
  `AGENTS.md` or `GEMINI.md` is never modified, and re-running init never
  duplicates anything.

Measured token usage:

- The Stop hook reads real API usage from the harness transcript (input,
  output, cache read, cache write tokens, and API call count) into the token
  ledger. Estimates and measurements are reported side by side.
- New `openwolf report` command: estimated vs measured usage in the terminal.
- Per-agent session attribution: every ledger session records which agent ran it.

Context management:

- Session digest: at session start, a token-budget-capped digest of the most
  valuable state (STATUS.md next phase, Do-Not-Repeat list, recent bug fixes,
  anatomy pointer) is injected directly into the model's context.
  Budgets are configurable per agent in `config.json`.
- Compaction survival: a new PreCompact lifecycle hook
  snapshots in-flight session state, and session start after compaction
  re-injects a digest of the files already modified. Session state is no
  longer wiped on resume or compaction.
- Anatomy staleness detection: scans pin the git HEAD; if the HEAD moves or
  the scan ages past the configured interval, the agent is told to rescan
  before trusting the index.
- End-of-turn reminders now reach the model through the `additionalContext`
  channel instead of invisible stderr.
- `STATUS.md` session handoff document: resume any session in one small read.

Anatomy re-architecture:

- Durable store: the source of truth for the project index moved from
  `anatomy.md` itself to `.wolf/anatomy-index.json`, with `anatomy.md`
  rendered from it. Concurrent writers now coordinate through a
  cross-platform lock; simultaneous edits no longer lose entries.
- Version-skew safe: markdown written by older hooks or edited by hand is
  detected by content hash and absorbed additively into the store.
- Symbol-level entries: files above 500 estimated tokens index their
  top-level functions and classes with line ranges and per-slice token
  estimates (TypeScript, JavaScript, Python, Go, Rust). The pre-read hint
  points agents at exact line ranges so they can read one function with
  offset/limit instead of the whole file. Hints are suppressed automatically
  if the file on disk has changed since indexing.

Skills and tooling:

- Bundled skills installed on init for Claude Code, Codex, and OpenCode:
  `/security-audit` (layered audit: dependencies, secrets, injection
  surfaces, authorization, ranked report) and `/reframe` (framework
  selection and migration plus a design audit/fix mode).
- `scripts/openwolf-check.mjs`: a standalone, read-only inspector that
  reports whether OpenWolf is installed in a project, which agents are
  wired, recency, and lifetime plus recent-session statistics.
- `openwolf update` now has parity with init: it creates missing files,
  re-runs the recorded agent adapters, refreshes bundled skills, and
  performs one-time data migrations, all after taking a timestamped backup.

Dashboard 2.0:

- Complete redesign: monochrome dot-matrix design system with a single
  signal-red accent, top navigation, bento stat tiles, and hash-based deep
  links to panels.
- Surfaces the 2.0 data: measured vs estimated tokens, cache economics,
  per-agent breakdown table, wired-agents widget, context health (scan
  freshness, pinned git HEAD, digest budget), and the STATUS.md handoff.
- Reliable Run Now for cron tasks over authenticated HTTP with visible
  running/queued/failed feedback.

### Changed

- Reframe now leads with an anti-generic design mandate: a blocklist of the
  recognizable AI-generated aesthetic plus positive principles, applied to
  every framework migration prompt. Distinctiveness is an acceptance criterion.
- Astryx added as the 13th framework in the Reframe knowledge base.
- Contributors are credited in the README; detailed attribution lives in
  commit trailers.
- STATUS.md template localized to English.

### Fixed

- CRLF line endings no longer wipe `anatomy.md` on Windows (#50, #24).
- Concurrent post-write hooks no longer lose anatomy entries.
- Old `config.json` files without newer sections no longer crash commands (#26, #27).
- `openwolf init` and `openwolf update` no longer reset per-project ports;
  fresh projects get a free port pair automatically (#37, #38).
- `bug search` is null-safe across buglog schema drift (#44).
- `EPERM` on WSL2 with EFS-encrypted directories fixed via a copy shim (#33).
- Files outside the project root no longer pollute the index (#56).
- Documentation and config edits are no longer mislogged as bug fixes, and
  auto-detection can be disabled (#28, #57).
- Dart language support in the scanner (#10).

### Security

- Dashboard binds to 127.0.0.1 by default and requires a per-project token
  (timing-safe comparison) for all API and WebSocket access (#30, #34).
- Command injection eliminated: every dynamic process invocation uses
  argument arrays; a shell-mode spawn was removed from the cron engine.
- Path traversal guards (realpath-based, symlink-safe) on cron AI task file access.
- File-watcher broadcasts capped at 1 MB to prevent memory abuse.
- Secret-bearing files (keys, keystores, credential files, `.npmrc`, and
  more, not just `.env`) are excluded from all index and memory capture (#54).
- A security regression test suite runs with `pnpm test`, including a guard
  test that fails the build if injectable process calls ever return.

### Removed

- Design QC screenshot capture (agents capture and read their own
  screenshots now); the `puppeteer-core` dependency is gone.
- The unverifiable token comparison chart in the dashboard; only measured
  numbers or clearly labeled estimates are shown.

## [1.0.4] - 2026-03-20

Final 1.x release. Claude Code only.
