# OpenWolf Operating Protocol

You are working in an OpenWolf-managed project. These rules apply every turn.

OpenWolf's hooks handle the bookkeeping: they maintain `.wolf/anatomy.md` and `.wolf/memory.md` after writes, track reads, and surface anatomy hints when you read files. Do not update those two files manually unless your agent has no OpenWolf hooks installed (Gemini CLI, Cursor).

## STATUS.md: read first, keep fresh

`.wolf/STATUS.md` is the handoff document. Read it FIRST when resuming a session; it replaces re-reading memory, plans, and code to reconstruct context.

Keep it fresh: when the user signals a quest is done ("done", "ship it", "next phase", "/clear", "wrap up"), move finished items to the done section, write the next quest (objective, files, decisions), and bump the date. Do this before responding "done" on any multi-file task and before suggesting `/clear`. A stale STATUS.md wastes the next session.

## File navigation

1. Before reading an unfamiliar file, grep `.wolf/anatomy.md` for its path to get a one-line description and token estimate. Do NOT read anatomy.md whole; it is an index, not a document.
2. If the description answers your question, skip the full read. For large files, prefer Read with offset/limit over whole-file reads.
3. If a file is not in anatomy.md, search with Grep/Glob. Regenerate the index with `openwolf scan`.

## Code generation

1. Before generating code, check `.wolf/cerebrum.md`: respect `## Do-Not-Repeat` (past mistakes), `## Key Learnings`, and `## User Preferences`.
2. Update cerebrum.md whenever you learn something: a user correction or preference, a project convention not obvious from code, an API surprise, a gotcha that would trip a fresh session, a significant decision and its why. The bar is LOW; a redundant entry costs nothing, a missing one repeats the discovery next session.

## Bug logging

Before fixing any bug: grep `.wolf/buglog.json` for the error message or filename; the fix may already be known.

After fixing any bug, failed test, failed build, or user-reported problem: append an entry with `id`, `timestamp`, `error_message`, `file`, `root_cause`, `fix`, `tags`, `occurrences`, `last_seen`. Also log when you edit a file more than twice to get it right. The threshold is LOW.

## Token discipline

- Never re-read a file already read this session unless it changed since.
- Prefer anatomy descriptions and targeted Grep over full file reads.
- If appending to a file, do not read the entire file first.

## Session end

Before wrapping up: update `.wolf/STATUS.md`, write a one-line session summary to `.wolf/memory.md` (`| HH:MM | description | file(s) | outcome | ~tokens |`), and record any learnings or bugs from the session in cerebrum.md / buglog.json.

## On-demand skills

- `/reframe`: UI framework selection, migration, and anti-generic design audits.
- `/security-audit`: security review of the project.
