# Dashboard

A real-time local dashboard for everything OpenWolf tracks. React SPA served
by the daemon, bound to localhost, token-authenticated.

## Launch

```bash
openwolf dashboard
```

Starts the daemon if needed and opens your browser with a per-project token.
Each project gets its own port, so multiple dashboards never collide.

## Overview

The home screen leads with what can be proven:

- **Tokens kept out of context**: the hero tile. The Bash governor's
  original-versus-entered delta, measured at the rewrite point, plus any
  denied duplicate reads. Never an estimate.
- **Measured usage** from transcripts: input, output, cache reads, API calls
- **Hook health**: heartbeat status per hook; a failing hook shows its
  consecutive-failure count and the actual error
- **Context health**: index freshness, duplicate-read mode, always-on
  context estimate, and audit findings (oversized instruction files, missing
  config)
- **Stat row**: what the usage is worth at list price, files tracked, edits
  per file read, re-read warnings, anatomy hit rate, bugs on file. A hit rate
  under 30% turns red: it means the agent is reading files the index cannot
  describe instead of calling `openwolf find`.
- **Next phase** from STATUS.md and a weekly sessions chart

## Tokens

Measured, verified, and estimated usage side by side:

- Headline tiles: measured lifetime, cache reads, OpenWolf's own overhead as
  a percentage of what it kept out, and what the usage is worth
- **Where the cost is**: the same measured tokens priced at Anthropic's
  published rates, split into cache reads, output, cache writes and fresh
  input, then broken down per model. Cache reads dominate on every real
  project and almost nobody expects it. On a subscription you are not billed
  per token, so the figure sizes the work rather than reporting an invoice.
- **In plain language**: one paragraph, no jargon, saying how many tokens
  were kept out, what that would have cost at the ceiling, what OpenWolf's
  own overhead was, and what the net saving is
- **Governor by command family**: tokens kept out per family with the share
  of that family's output condensed. A family at 0% is either set to
  `suggest` or rarely crosses the threshold, which is the fastest way to see
  where the governor earns its keep
- **Measured across all project transcripts**: totals per model, subagent
  share, scan timestamp (written by the daemon)
- Usage over time per session, with the measured line overlaid where
  transcript data exists
- Per-agent table: sessions, estimated, measured in/out, cache reads
- A verification footnote: how many hook runs the transcripts confirm, how
  many failed, and how many injections provably entered the conversation
- Waste alerts from the pattern detector

Estimates are always labeled. Measured figures come from transcripts.
Verified figures come from the harness's own hook records.

## Activity

Chronological log of agent actions with timestamps, files, and token
estimates. Filter by date, search, group by session.

## Cron

All scheduled tasks with schedule, last run, next run, and a Run Now button.
Dead letter queue with retry, and execution history.

## Cerebrum

Structured view of the learning memory: Do-Not-Repeat cards (red-tinted,
dated), preferences, learnings, and the decision log. Searchable.

## Memory

Sessions as collapsible cards with the full action table. The most recent
session opens by default.

## Anatomy

Interactive file tree from the index. Files show descriptions and token
badges; large files list their symbols with line ranges. Search by filename
or description.

## Bugs

The searchable bug database: error, root cause, fix, tags, occurrence
counts. Quick-filter by tag.
