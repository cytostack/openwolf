# Dashboard

OpenWolf includes a real-time web dashboard for visibility into your project's agent activity. It is a React SPA served by the daemon, token-authenticated and bound to localhost.

## Launch

```bash
openwolf dashboard
```

This starts the daemon (if not already running) and opens your browser to the dashboard with a per-project token in the URL. Each project gets its own port automatically, so multiple projects' dashboards never collide.

## Theme

The dashboard supports **dark and light modes**. Toggle with the light/dark pill in the top navigation. Your preference is saved in localStorage. The design is a monochrome dot-matrix system with a single signal-red accent reserved for live, measured, and attention states.

## Panels

The dashboard has nine panels, accessible from the top navigation: Overview, Tokens, Activity, Cron, Cerebrum, Memory, Anatomy, Bugs, and Insights.

### Overview

The home screen. Shows:
- **Tokens saved** (estimated), as the hero tile
- **Measured usage** from the agent transcripts: input, output, cache read, and API calls
- **Agents** wired to this project (Claude Code, Codex, OpenCode, and others)
- **Stat row**: sessions, files tracked, reads/writes, re-reads blocked, anatomy hit rate, bugs on file
- **Context health**: anatomy scan freshness, pinned git HEAD, session digest budget
- **Next phase** from STATUS.md, and a weekly sessions dot chart

### Activity Timeline

Chronological log of everything your agent has done. Each action is a card with timestamp, description, affected files, and token estimate.

**Controls:** filter by date range (today / this week / all), search by keyword, toggle between grouped (by session) and flat views.

### Token Intelligence

Measured and estimated usage side by side:

- **Headline tiles**: estimated lifetime tokens, measured lifetime tokens, cache reads, and estimated savings
- **Usage over time**: per-session estimated input and output tokens, with the measured line overlaid in red where transcript data exists
- **By agent**: a table of sessions, estimated tokens, and measured input/output/cache per agent
- **Waste alerts**: flagged patterns like repeated reads, unnecessary full-file reads, and memory bloat

Estimated figures use a character-ratio heuristic; measured figures are summed from the agent's transcript at session end. Only real numbers or clearly labeled estimates are shown.

### Cron Control Center

Table of all scheduled tasks showing status, schedule (human-readable), last run, and next run. Each row has a **Run Now** button.

Below the table:
- **Dead Letter Queue**: failed tasks with error details and **Retry** buttons
- **Execution History**: last 30 runs with duration and status

### Cerebrum Viewer

Structured view of `cerebrum.md`:

- **Do-Not-Repeat**: prominent red-tinted cards with date badges (most important section)
- **User Preferences**: bullet list
- **Key Learnings**: card per learning
- **Decision Log**: collapsible cards with rationale

Includes a search bar that filters across all sections.

### Memory Browser

Sessions as collapsible cards. Each shows the date, action count, and total tokens. Expand to see the full action table (time, action, files, outcome, tokens).

Most recent session is expanded by default.

### Anatomy Browser

Interactive file tree built from the anatomy index. Directories are expandable nodes. Files show their description and a token badge (neutral ink, turning red for genuinely heavy files). Large files also list their indexed symbols with line ranges beneath the file entry.

Search filters by filename or description.

### Bug Log

Searchable bug database from `buglog.json`. Each bug expands to show:
- Error message (in a code block)
- Root cause
- Fix (in a code block)
- Tags as badges
- Occurrence count (badge if seen more than once)

Quick-filter by clicking common tags.

## Design

- **Monochrome dot-matrix theme** with a single signal-red accent; dark and light modes via the top-nav pill
- **Top navigation** with deep-linkable panels (for example `#tokens`)
- **Live updates**: an authenticated WebSocket pushes `.wolf/` file changes in real time
- **Lazy-loaded panels** with skeleton fallbacks
- **Graceful auth handling**: a rejected token shows a clear message rather than a blank screen
