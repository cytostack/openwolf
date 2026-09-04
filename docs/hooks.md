# Hooks

OpenWolf registers 12 lifecycle hooks. The same scripts serve Claude Code
and Codex (OpenCode uses a native plugin with equivalent behavior). They run
automatically; you never interact with them.

All hooks are pure Node.js file I/O: no network calls, no AI, no external
dependencies. They read JSON on stdin from the agent and answer through the
platform's documented hook output channel, so everything they say actually
reaches the model.

Three properties hold for every hook:

- **Never blocking by surprise.** Hooks advise and measure. The only
  gate-shaped behavior (duplicate-read denial) is off by default and
  one-shot when enabled.
- **Never permission-bypassing.** No hook ever auto-approves a tool call.
- **Provably alive.** Every hook records a heartbeat (last success, last
  error, consecutive failures) in `.wolf/hooks/_heartbeat.json`. Session
  start self-tests the install; `openwolf update` runs a per-hook selfcheck
  and fails loudly if anything cannot load.

Session state lives in `.wolf/hooks/sessions/<session-id>.json`, keyed by
the harness's own session id, so concurrent sessions in the same project
never contaminate each other's tracking.

## `session-start.js`

Fires when a session begins (startup, resume, clear, or compact).

1. Self-tests the installed hooks: every script's imports must resolve.
   Breakage is reported in the digest with a repair instruction.
2. Creates the session state file and appends a session header to
   `memory.md` (new sessions only).
3. Injects the state index: one line per live `.wolf` file with its
   description, size, and freshness, plus the top Do-Not-Repeat rules and
   the current STATUS handoff. Target size is about 400 tokens. Template
   placeholder text is never injected. Files whose frontmatter says
   `always: true` inject their content, budget-capped.
4. On compaction: re-injects the in-flight state (files already modified),
   the top rules, and the contents of path-scoped rules matching files this
   session touched. The platform documents those rules as lost at
   compaction; this puts them back.

## `user-prompt-submit.js`

Delivers reminders queued by the Stop hook alongside your next prompt.
Queued delivery costs zero extra model turns; Stop-level injection would
force a full continuation turn per reminder.

## `pre-read.js`

Fires before the Read tool runs.

- First contact with a file: surfaces the anatomy description, and for large
  files either the biggest symbols with line ranges or a signature outline,
  so the agent can read a slice with `offset`/`limit` instead of the whole
  file. Hints are suppressed if the file changed since indexing.
- Repeat full read of an unchanged file: a short factual advisory. Ranged
  reads are tracked separately and never make a later full read look like a
  duplicate.
- Whole-file reads of `.wolf/anatomy.md` or `cerebrum.md`: once per session,
  points at the cheap alternative (`openwolf find`, section greps).
- With `reads.duplicate_mode: "deny"` (off by default): a duplicate full
  read of an unchanged file is denied once, with a pass-through on retry so
  the model is never stranded.

## `pre-write.js`

Fires before Write, Edit, or MultiEdit.

1. Checks the edit against the cerebrum Do-Not-Repeat list.
2. Searches the bug log for relevant past fixes (full-text, keyed by error
   signature, with a precision gate) and surfaces up to two as FYI, not
   directives.

## `pre-bash.js`

Fires before Bash runs. If the command is a known flood producer (test
runners, builds) and is not already shaped (no redirect, no head/tail), it
suggests capping the output, once per command family per session.

## `post-bash.js`

Fires after Bash completes. The output governor:

1. If stdout exceeds the threshold (default 2,000 tokens), condenses it by
   command family: grep floods keep first matches per file plus counts,
   `git show` keeps the header and diff stats, file re-prints keep head and
   tail. Test and build output is suggested-only by default. stderr is never
   touched.
2. Writes the full output to `.wolf/cache/bash/<id>.log` and ends the
   condensed result with a pointer to it.
3. Records original tokens versus entered tokens in the ledger. This is the
   only place that delta can be measured; the platform's telemetry records
   output before hooks run.
4. Parses simple `cat`/`head`/`tail`/`sed` commands and registers those
   reads in session tracking. A repeated full `cat` of an unchanged file
   gets an advisory.

## `post-read.js`

Records the real size of completed full reads into session tracking. Ranged
reads are marked as ranged contact. Reads of `.wolf/` files are measured
separately so OpenWolf's own context cost is visible, not hidden.

## `post-write.js`

The busiest hook.

1. Updates the anatomy entry for the written file (description, tokens,
   hash, symbols) under a cross-process lock and re-renders `anatomy.md`.
   Secret-bearing files are never indexed.
2. Appends the action to `memory.md` with a change summary.
3. Tracks edit counts; a file edited three or more times gets one reminder
   per session to log the bug.
4. For `.wolf/` state files: enforces the token budget (cerebrum 2k, STATUS
   1k by default) with one factual warning per session when a write exceeds
   it.

## `post-batch.js`

Fires after each batch of tool calls. Every N batches (default 25,
`context.reinjection_interval`, 0 disables) it re-surfaces the top
Do-Not-Repeat rules in one short note. This targets within-session
instruction decay, the one effect a 1,650-session controlled study actually
found.

## `precompact.js`

Snapshots the session state just before the harness compacts the context
window. The restore happens in `session-start.js` when the session
continues.

## `stop.js`

Fires when the agent finishes a response.

1. Upserts the session's ledger entry (idempotent: Stop fires every turn).
2. Reads measured usage from the transcript: input, output, cache read,
   cache write, per model.
3. Verifies delivery against the transcript's own hook records: which hooks
   fired, which failed, and which injected context provably entered the
   conversation. When verification is unavailable, self-reported numbers are
   labeled estimates.
4. Queues end-of-turn reminders (missing bug logs, stale cerebrum, missing
   session summary), each at most once per session, for delivery with your
   next prompt.

## `session-end.js`

Final ledger flush on clear/logout/exit, plus a one-line session summary in
`memory.md`.
