---
name: openwolf
description: OpenWolf operating protocol for this project. Load when starting multi-file work, resuming a session, wrapping up a session, or when unsure how to use .wolf/ state files (anatomy, cerebrum, memory, buglog, STATUS).
---

# OpenWolf Operating Protocol

You are working in an OpenWolf-managed project. The hooks handle bookkeeping automatically: they maintain `.wolf/anatomy.md` and `.wolf/memory.md` after writes, track reads, and surface anatomy hints when you read files. Do not update those two files manually unless your agent has no OpenWolf hooks installed.

## Session resume

`.wolf/STATUS.md` is the handoff document. Read it first when resuming; it replaces re-reading memory, plans, and code to reconstruct context. Regenerate it on demand with `/handoff` when a quest finishes or before suggesting `/clear`.

## File navigation

1. To locate a symbol or file by name, run `openwolf find <query>` first: a ranked shortlist from the index (~1k tokens max), cheaper than grepping the world. For one file's description, size, and symbol line ranges: `openwolf find --file <path>`.
2. If the description answers your question, skip the full read. For large files, prefer Read with offset/limit; the pre-read hook surfaces the largest sections with line ranges, and `openwolf map` prints a token-budgeted overview of the most important files.
3. Never read `.wolf/anatomy.md` whole; it is an index. Grep it only for a single path's line when `find` is unavailable.
4. If a file is not indexed, search with Grep/Glob. Regenerate the index with `openwolf scan`.

## Code generation and learning

1. Before generating code, check `.wolf/cerebrum.md`: respect `## Do-Not-Repeat` (past mistakes), `## Key Learnings`, and `## User Preferences`.
2. Update cerebrum.md whenever you learn something: a user correction or preference, a project convention not obvious from code, an API surprise, a gotcha that would trip a fresh session. The bar is LOW; a missing entry repeats the discovery next session.

## Bug logging

Before fixing any bug: grep `.wolf/buglog.json` for the error message or filename; the fix may already be known.

After fixing any bug, failed test, failed build, or user-reported problem: append an entry with `id`, `timestamp`, `error_message`, `file`, `root_cause`, `fix`, `tags`, `occurrences`, `last_seen`. Also log when you edit a file more than twice to get it right.

## Token discipline

- Never re-read a file already read this session unless it changed since.
- Prefer anatomy descriptions and targeted Grep over full file reads.
- If appending to a file, do not read the entire file first.

## Session end

Before wrapping up: run `/handoff` (or update `.wolf/STATUS.md` by hand), write a one-line session summary to `.wolf/memory.md` (`| HH:MM | description | file(s) | outcome | ~tokens |`), and record any learnings or bugs in cerebrum.md / buglog.json.

## On-demand skills

- `/handoff`: regenerate .wolf/STATUS.md from the session's actual state.
- `/reframe`: UI framework selection, migration, and anti-generic design audits.
- `/security-audit`: security review of the project.
