# Changelog

All notable changes to OpenWolf are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and OpenWolf uses
[Semantic Versioning](https://semver.org/).

## [2.5.0] - 2026-08-22

Positioning, and the removal of the last thing that made "no API calls"
untrue.

### Added

- **Cost.** The dashboard prices measured usage at Anthropic's published
  rates, per model, split into cache reads, output, cache writes and fresh
  input. On one real 277-call project that is $84, of which 67% is cache
  reads: a number that was previously visible only as "102.3M" with no way to
  size it. Labelled as list price throughout, because a subscription user is
  not billed per token.
- **Overhead as a ratio.** "1.4K injected" now reads "1.6% of what it kept
  out", which is the claim the footnote on openwolf.com already makes.
- **Governor breakdown by command family.** The classifier always knew the
  family at the rewrite point, but the rollup threw it away and kept only
  scalars. Sessions now carry `bash_governed_by_family`, folded into a
  lifetime map that survives session trimming, so the dashboard can answer
  which families are paying off and which are set to suggest.
- **A plain-language panel.** Not everyone using OpenWolf reads ledgers. One
  paragraph states how many tokens were kept out of context, what that would
  have cost at the ceiling, what OpenWolf spent doing it, and the net.

### Changed

- Reads and writes were two numbers glued with a dot; they are now "edits per
  file read", with the raw counts underneath.
- A sub-30% anatomy hit rate is called out in the accent colour instead of
  sitting in a neutral tile: it is the most actionable number on the page.
- The "saved · denied re-reads" tile no longer renders a dead "n/a" in warn
  mode. Warn mode says what it caught and how to switch to deny.

### Removed

- **AI suggestions and every other model call.** The `ai_task` cron action
  shelled out to `claude -p` for two weekly tasks (cerebrum reflection and
  project suggestions). It was the only path in OpenWolf that reached a
  model, and it contradicted the one claim the whole project rests on. Gone,
  along with the Insights dashboard panel, `suggestions.json`, and the
  `cron.use_claude_p` / `cron.api_key_env` settings. `openwolf update`
  deletes the leftover file; a stale manifest entry now fails loudly instead
  of silently reaching the network.

### Fixed

- **Windows hooks, properly this time.** 2.0.4 swapped `$CLAUDE_PROJECT_DIR`
  for `%CLAUDE_PROJECT_DIR%` on Windows, which fixed nothing: PowerShell is
  Claude Code's shell there and has no `%VAR%` expansion, and the variable is
  not in the hook environment on any platform to begin with (project context
  arrives through the stdin JSON payload). Every hook died with
  MODULE_NOT_FOUND on every tool call. Hook commands now carry the resolved
  absolute path, so no shell expansion is involved at all. Hooks also derive
  the project root from their own location when no environment variable is
  set. Reported in detail by [@aevnar](https://github.com/aevnar).
- **A malformed buglog no longer takes anything down.** A `.wolf/buglog.json`
  written as a bare array of entries (the natural shape when an agent writes
  the file by hand) reached `bugs.length` unguarded. In one real project the
  pre-write hook failed on 465 consecutive invocations with nothing but the
  heartbeat noticing, `openwolf bug search` threw, the SessionStart file
  index was silently dropped, and the dashboard rendered a blank page. Both
  shapes are now normalised at the boundary, in the hooks, the CLI, and the
  dashboard loader.
- Dashboard panels render inside an error boundary: one malformed state file
  degrades a single panel instead of blanking the page.
- `detectAgent()` recognises Claude Code by `CLAUDECODE`, which is actually
  set, instead of `CLAUDE_PROJECT_DIR`, which is not. Sessions were being
  attributed to "default" and losing their per-agent ledger rows.
- `openwolf update` now also removes hand-patched hook entries written with
  native Windows path separators, which previously survived the filter and
  ran alongside the new ones.

### Changed

- New positioning across the README, openwolf.com, the npm package and the
  GitHub description: portable project memory across agents, plus measured
  token accounting. "Second brain" is retired.
- `openwolf init` prints a banner and a scannable summary instead of a wall
  of checkmarks, names whichever agents it actually wired rather than telling
  every user to run `claude`, and reports the real hook count.
- Hook count corrected to 12 everywhere. The docs said 10 while documenting
  12.

## [2.6.0] - 2026-08-26

### Added

- `openwolf.anatomy.extra_roots` (opt-in, default `[]`): sibling directories
  outside the project root to index alongside it, under `../sibling/...`
  keys. 2.5.0's "never index outside the project root" rule conflated kind
  (scratch/temp noise) with location — it also evicted a sibling repo one
  real project works in daily, so `find` could no longer see that code.
  The write-tracking hook honors the same list; scratch dirs stay excluded;
  the `max_files` budget is shared with the project's own files, which are
  scanned first.

### Fixed

- Multi-writer safety for sessions sharing one `.wolf` (TIK-System field
  report): buglog writes are now serialized through `buglog.json.lock` (the
  CLI falls back to an unlocked write on lock timeout so a user-requested log
  is never dropped; the auto-detect hook skips on contention), the
  `total_sessions` increment reuses the token-ledger lock, and the auto-detect
  hook assigns bug ids from the max existing id instead of the array length,
  which collided under concurrent writers.
- The session digest now warns when other sessions are active on the same
  `.wolf` (sibling state files under `hooks/sessions/` touched within 30
  minutes), and `/handoff` archives the previous `STATUS.md` to
  `.wolf/plans/` before rewriting so a concurrent regeneration costs nothing.
- The anatomy scanner hard-excludes vendored language environments (`.venv`,
  `venv`, `site-packages`, `__pycache__`, `.tox`, `node_modules`) regardless
  of `exclude_patterns`: projects with a customized exclude list keep it on
  update, which let a scan fill 55% of one real index with virtualenv files.
  Worse than noise: under the `max_files` cap (500 by default) those entries
  *displace* real source — the same project indexed 283 venv files against a
  516-file cap-bound scan, and 552 real files once excluded — so the symptom
  is `find` silently missing your own code, not a visibly noisy index.

## [2.4.1] - 2026-08-21

### Fixed

- The anatomy scanner no longer indexes agent-config directories (.claude,
  .codex, .opencode, .gemini, .cursor): steering the model toward its own
  harness config through the index is noise, and those files topped the
  importance ranking in real projects. Found during the 2.4.0 pre-publish
  end-to-end test of the Claude and Codex paths.

## [2.4.0] - 2026-08-20

Context quality and large repos: the last two phases of the evidence-based
roadmap (2.4 "context quality" + 2.5 "large repos and the moat"), shipped
together.

### Added

- Progressive-disclosure digest: the session digest is now an index, not a
  content dump. One line per live .wolf state file (what it is, size,
  freshness, read on demand), the top 3 Do-Not-Repeat rules verbatim, and the
  STATUS next-phase when genuinely filled in. Files whose frontmatter says
  `always: true` still inject content, budget-capped. Target ~400 tokens
  (previous mean: 794, of which 75% was a staleness nag or placeholder).
- Instruction-decay countermeasure: every N tool batches (default 25,
  `openwolf.context.reinjection_interval`, 0 disables) the top Do-Not-Repeat
  rules are re-surfaced as short factual statements. The only factorial study
  of instruction adherence (1,650 sessions) found within-session decay of
  ~5.6% per generated function and null effects for file size; cadence is the
  fix shape, and no other tool does this.
- Compaction restore now also re-injects paths-scoped rule contents for files
  touched this session: the platform documents these rules as silently lost
  at compaction until a matching file is re-read. Plus the top rules and the
  in-flight session state, all through the sanctioned SessionStart channel.
- State-file budgets: writing .wolf/cerebrum.md or STATUS.md past its budget
  (2k/1k tokens, `openwolf.context.state_budgets`) produces one factual
  warning per session - the measure-after-write loop native auto-memory uses,
  applied to the committed cross-agent state.
- .wolf self-read governance: OpenWolf now measures the tokens agents spend
  reading its own state files (previously a deliberate blind spot worth ~147k
  tokens) and, once per session, redirects whole-file reads of anatomy.md or
  cerebrum.md to the cheap paths (`openwolf find`, section greps).
- `openwolf find --file <path>`: full index detail for one file (description,
  size, importance, symbol line ranges) - the replacement for reading
  anatomy.md or the file itself.
- `openwolf map [--focus terms] [--budget N]`: a token-budgeted overview of
  the most important files, ranked by personalized PageRank over the import
  graph persisted in the index (restart vector biased toward files read in
  recent sessions and focus-term matches - aider's repo-map algorithm on the
  durable store), fitted to the budget by binary search.
- Merkle-style freshness: the index stores a root hash over (path,
  content-hash) pairs, and a stat sweep answers "is the index stale" without
  reading file bodies. The daemon's scheduled rescan now runs only when the
  sweep or a git HEAD move says the index is actually stale.
- Index hygiene: lockfiles, .DS_Store, caches, coverage, minified and map
  files are excluded built-in (one audited project carried ~105k tokens of
  such noise).
- Cross-agent moat: state templates carry frontmatter (description, budget);
  `.wolf/.gitignore` enforces the committed-vs-machine-local split (cerebrum,
  STATUS, memory, buglog, anatomy index committed; ledgers, caches, hook
  runtime ignored); the native Claude auto-memory index is mirrored into a
  marker-fenced cerebrum section so learnings captured natively become
  visible to other agents and teammates.
- `openwolf bench`: the A/B gate harness - same task set with and without
  OpenWolf via headless runs, medians per cache dimension, task completion,
  and the bash re-run rate (the failure signature of over-aggressive output
  condensation). Requires --yes; spends real API budget.

## [2.3.0] - 2026-08-20

The Bash channel release. The empirical audit showed Bash carries 48.3% of
all tool-result tokens (the Read tool: 35%), oversized results over 2k tokens
are a quarter of bash output, and every real duplicate file read happened
through cat/sed/head, invisible to the Read hooks. This release governs that
channel.

### Added

- Bash output governor (PostToolUse): oversized stdout is condensed
  structurally, family-aware, and the tool result is replaced before it
  enters context via the platform's updatedToolOutput channel. grep floods
  keep the first matches per file plus counts; git show keeps the commit
  header and per-file diff stats; file re-prints keep a head and tail
  window. The full output is always preserved verbatim at
  .wolf/cache/bash/<id>.log and every condensed result ends with a factual
  pointer to it. stderr is never modified, test and build output is never
  replaced by default (suggest mode only), and condensation only happens
  when it saves at least 30%. Config: openwolf.bash.governor (mode,
  threshold_tokens, per-family actions; global and per-family kill switches).
- Measured-at-the-rewrite-point accounting: for every governed call the
  ledger records original vs entered tokens. This number is unique ground
  truth: the platform's own telemetry logs tool output before hooks run, so
  only the rewriting hook can measure what actually entered the context
  window. The dashboard hero tile now shows tokens verifiably kept out of
  context; openwolf report prints the governor section.
- Bash-channel read dedupe: simple single-file reads (cat, head, tail,
  sed -n) are parsed and registered in the session's read tracking, closing
  the blind spot where all measured duplicate reads lived. A repeated full
  cat of an unchanged file gets a short factual advisory.

### Changed

- The pre-Bash suggestion filter's disqualifier list matched 1 of 2,256 real
  commands; it now exempts only genuinely shaped commands (redirects, tee,
  pipes into head/tail/grep, quiet flags, compound commands) since the
  PostToolUse governor is the safety net.

## [2.2.0] - 2026-08-20

The reliability release: OpenWolf proves what it does. Built on an empirical
audit of 16 live projects (6,869 API records) that found a hook crashing
silently for 3 weeks, self-reported counters drifting ~20x from transcript
ground truth, and several shipped files no agent ever used.

### Added

- Hook health: every hook records a heartbeat (last success, last error,
  consecutive failures) and every crash is captured instead of swallowed.
  Session start self-tests the installed hooks' imports and reports breakage
  in the digest; `openwolf update` verifies the install (file presence plus a
  per-hook selfcheck run) and fails loudly instead of leaving a broken
  install; the dashboard shows failing hooks with the error.
- Transcript-verified measurement: the ledger now records, per session, how
  many hook runs the harness actually logged, how many failed, and which
  injected context verifiably entered the conversation, parsed from the
  transcript's own hook records with a schema probe that falls back to
  labeled estimates if the format drifts. The dashboard displays verified
  numbers next to estimates.
- Cache-invalidation attribution: `openwolf report` and the daemon name what
  broke the prompt cache in the last 7 days (model switch, compaction,
  version change, cache expiry, or honestly unattributed) and how many
  tokens each rebuild re-wrote. Prefix rebuilds are the largest single waste
  class in agent sessions and no other tool attributes them.
- Position-weighted cost model: waste is now valued as tokens times remaining
  API calls times the cache-read rate, because a byte's real cost is being
  re-read on every later call, not its size.

### Fixed

- Session state is keyed by the harness session id (`.wolf/hooks/sessions/`),
  so concurrent sessions in one project no longer cross-contaminate
  duplicate-read tracking (one of two causes of a ~20x warning inflation).
- Ranged reads (offset/limit) are recorded as ranged contact and never make a
  later full read look like a duplicate (the other inflation cause).
- The edit-count warning fires once per file per session instead of on every
  edit after the third (it would have hit 39% of all writes).
- Removed the dead `cerebrum_warnings` counter (it was never incremented
  anywhere).

### Removed

- The anatomy staleness banner: it led 21 of 28 measured digests because a 6h
  rescan interval loses to normal commit cadence. Freshness is the scanner's
  job, not the model's.
- Unfilled STATUS.md template text is never injected into the digest (8 of 28
  measured digests were pure placeholder).
- Dead weight no longer shipped into projects, and removed on update when
  verifiably untouched: reframe-frameworks.md (31KB, referenced once in 2,256
  measured commands; the /reframe skill still carries it), identity.md,
  designqc-report.json stubs, empty suggestions.json stubs.

## [2.1.0] - 2026-08-20

The measurement release. OpenWolf now proves its numbers instead of asserting
them: ground-truth token usage from the harness's own transcripts, an honest
ledger of what OpenWolf itself injects, an exact tree-sitter index, and
relevance-ranked bug recall.

### Added

- Project-wide measured usage: `openwolf report` and the daemon scan every
  transcript in the harness project directory (subagent sidechains and
  headless runs included), deduplicated by message and request id, broken
  down per model. The dashboard shows the project-wide card next to the
  session numbers.
- Injection accounting: every digest, anatomy hint, duplicate-read warning,
  cerebrum/buglog note, edit warning, and reminder OpenWolf injects is
  counted per source and reported as overhead next to the savings it claims,
  in the ledger, `openwolf report`, and the dashboard.
- A/B benchmark harness (`scripts/benchmark/run-ab.mjs`, repository only):
  fixed task set, OpenWolf vs bare clones, headless runs, medians, cache
  dimensions reported separately. Methodology in the README.
- Tree-sitter symbol extraction: `openwolf scan` upgrades the index with
  exact AST line ranges and nested methods for ts/tsx/js, python, go, rust,
  java, ruby, and php, with signature skeletons for large files. Hooks keep
  the dependency-free regex extractor as the incremental fast path; any
  wasm failure falls back silently.
- Import-graph importance: a PageRank score per file ranks hints and search
  results; projects with no resolvable imports get no scores rather than
  false ones.
- `openwolf find <query>`: ranked symbol/file shortlist straight from the
  index, capped near 1k output tokens, quality then importance ordering.
- Buglog FTS: SQLite full-text index (node:sqlite, Node 22.5+) over the bug
  log keyed by normalized error signature; powers `openwolf bug search`
  (relevance ranked) and the pre-write hook's cross-file fix recall. Falls
  back to the previous matcher on older Node.
- Bash output filter (suggest mode, `openwolf.bash.filter_mode`): a
  once-per-session note when a verbose test/build command is about to dump
  its output into context, with a log-to-file + tail recipe. Rewrite mode is
  configured but intentionally inert: OpenWolf will not auto-approve tool
  calls to rewrite them.
- Context-health audit: `GET /api/context-health` and an overview card
  flagging oversized CLAUDE.md, always-on @-imports, missing config blocks,
  and injection above the digest budget.
- `/handoff` command: regenerates `.wolf/STATUS.md` from the session's real
  state. The Stop hook's STATUS staleness nag is gone.

### Changed

- CLAUDE.md snippet is now a lean stub; the operating protocol ships as a
  Claude Code skill (`.claude/skills/openwolf/SKILL.md`) loaded on demand.
  `openwolf update` swaps legacy shipped snippets byte-identically and never
  touches customized files. `.claude/rules/openwolf.md` slimmed to the
  always-true lines.
- cerebrum syncs into Claude Code auto-memory (preferences, learnings,
  do-not-repeat) when the memory directory exists; the session-start digest
  then stops re-injecting Do-Not-Repeat on Claude. cerebrum.md remains
  canonical for Codex, OpenCode, Gemini, and Cursor.
- The dashboard's char-ratio estimate headline is retired; measured tiles
  lead everywhere.

### Fixed

- Importing an existing anatomy.md preserves its recorded scan timestamp
  instead of claiming it was scanned now.

## [2.0.5] - 2026-08-20

Dashboard honesty release. After 2.0.4 made savings accounting honest, two
leftovers made the dashboard contradict itself: a "re-reads blocked" count
carried over from the old warning semantics next to a savings figure of 0,
and the config key that enables deny mode was undiscoverable on upgraded
projects. Both are fixed.

### Fixed

- `openwolf update` and `openwolf init` now deep-merge new config defaults
  into an existing `.wolf/config.json`, adding missing keys only and never
  touching customized values (ports, budgets, exclude patterns). Upgraded
  projects finally see `openwolf.reads.duplicate_mode`, which previously
  existed only in fresh installs. The default stays `warn`.
- Duplicate-read warnings and denials are now tracked as separate ledger
  fields (`repeated_reads_warned` vs `repeated_reads_blocked`). Sessions
  written before 2.0.5 stored warning counts in the blocked field;
  `openwolf update` migrates them, so "193 blocked, 0 saved" can no longer
  appear. `openwolf report` lists both lines.
- The dashboard no longer renders misleading zeros. In warn mode the savings
  tile shows "n/a" with a note that denial savings are not tracked and how to
  enable deny mode; the stat row shows "re-read warnings". In deny mode the
  tiles show denied re-reads and the tokens they saved. The context health
  card now shows the active duplicate read mode.

## [2.0.4] - 2026-08-18

The repair release. A full audit against the Claude Code hooks reference
found that most of OpenWolf's guidance never reached the model, that the
measurement layer inflated and misattributed numbers, and that anatomy.md
could destroy hand-written content. This release fixes all of it.

### Fixed

- Every hook nudge now actually reaches the model. Anatomy hints, symbol
  slice hints, repeated-read notes, cerebrum Do-Not-Repeat warnings, buglog
  matches, and edit-count warnings were written to stderr with exit code 0,
  which Claude Code sends to the debug log only; the model never saw any of
  them, in 1.x or 2.x. They now flow through the documented
  `hookSpecificOutput.additionalContext` channel.
- End-of-turn reminders no longer burn a full extra model turn each. The Stop
  hook queues them and a new UserPromptSubmit hook delivers them with the next
  user prompt. Reminders fire at most once per session, and the STATUS.md
  staleness nudge (previously stderr-only, a no-op) joins the same queue.
- The token ledger is idempotent. The Stop hook fires every turn, and the old
  flush appended a cumulative session entry each time while re-adding running
  totals (including full-transcript measured usage) to lifetime, producing
  duplicate entries and quadratically inflated metrics. Session entries are
  now upserted by id, lifetime is derived from the retained sessions plus an
  archived baseline, sessions are capped at 200, and `openwolf update`
  repairs existing inflated ledgers. A new SessionEnd hook writes the single
  memory.md session summary that used to be appended once per turn.
- Read-token tracking works again: the post-read hook read a `tool_output`
  field that does not exist in the PostToolUse payload; it now parses
  `tool_response` in all its shapes.
- Savings are honest. The old formula credited 200 tokens per anatomy hit and
  the full token count of every repeated read that in fact went through and
  was paid for. Savings are now credited only for duplicate reads OpenWolf
  verifiably prevented, and `openwolf report` leads with measured transcript
  usage instead of estimates.
- anatomy.md no longer destroys hand-written content above the first section
  heading (#61, including the follow-up report): preambles survive rewrites,
  hand-written indented notes are preserved, and an empty or unreadable
  anatomy.md can no longer wipe preserved content on import.
- The OpenCode plugin is de-forked from the canonical hook logic, closing a
  cluster of already-fixed bugs it still shipped: pre-#61 anatomy data loss,
  an .env-only sensitive-file guard (#54), missing outside-root guard, stale
  read warnings after edits (#41), boundary-less path matching, ledger
  inflation, and crashes on pre-2.0 ledger files.
- Windows installs get working hooks: `$CLAUDE_PROJECT_DIR` never expands
  under cmd.exe, which silently disabled all hooks; settings now use the
  platform's own variable syntax.
- `openwolf scan --check` no longer reports out-of-date immediately after a
  scan; it compares against the exact merged render a scan would write.
- Scanner lock contention no longer clobbers curated descriptions; the write
  is skipped and the next scan converges.
- Daemon and dashboard reliability: the launcher reuses this project's own
  daemon instead of forking an orphan per invocation and persists the served
  port; a bind race no longer kills the daemon silently; `/api/health`
  reports real degraded states; AI cron tasks no longer freeze the daemon
  event loop for up to two minutes; cron-state and token-ledger writers are
  file-locked against each other; `daemon stop` kills every listener on the
  port; memory consolidation is idempotent across runs.
- Dashboard data: live anatomy.md updates no longer wipe symbol data derived
  from the index; the anatomy metadata regex is anchored; memory table rows
  with empty cells no longer shift columns.
- CLI paper cuts: `openwolf restore` works from subdirectories; the Node 20
  version guard runs before the CLI loads; registry writes are atomic and
  read-only listings no longer unregister projects on unmounted volumes;
  buglog ids no longer collide after manual deletions; the daemon staleness
  threshold respects the configured heartbeat interval.
- The Codex adapter merges `.codex/hooks.json` instead of clobbering user
  hooks, and skill/rule installs never overwrite user-customized files.

### Changed

- The always-on context bill is much smaller. anatomy.md no longer renders
  symbol sub-bullets (symbols stay in `anatomy-index.json` and reach the
  model through the per-file pre-read hint), roughly halving the rendered
  index. OPENWOLF.md is rewritten at about a third of its size; DesignQC and
  Reframe move to on-demand skills (`/designqc` is new). The navigation rule
  is now "grep anatomy.md for the path", never "read anatomy.md".
- New config `openwolf.reads.duplicate_mode`: `warn` (default) injects a
  context note on a repeated unchanged full-file read; `deny` blocks it with
  a reason the model sees (never for ranged reads, never in subagents, never
  after compaction, at most once per file per session); `off` only counts.

Thanks to prghbla and laihenyi (#61) for the anatomy data-loss reports and
analyses that triggered the full audit.

### Fixed

- The post-write hook no longer crashes on every write. `symbol-extractor.js`
  was imported by the installed hook but missing from the install, update, and
  status file lists, which silently disabled write tracking, memory.md logging,
  and anatomy.md updates on every v2 install. `openwolf status` now checks all
  11 hook files, and a regression test verifies that every file imported by an
  installed hook is present in the copy lists. Reported with a full root-cause
  analysis by Laptopcorei7 (#68).
- The Stop hook no longer reports "no semantic summary was written" on every
  session. `countSemanticEntries()` looked for a UTC date prefix that no writer
  ever emits; it now counts entries under the newest session heading. This also
  fixes sessions that cross midnight looping forever on the reminder. Reported
  by statik1 (#62) and Laptopcorei7 (#68).
- End-of-turn reminders now fire at most twice per session, so a reminder whose
  condition cannot be cleared degrades into a stale message instead of a
  non-terminating loop (#68).
- The buglog reminder now checks buglog.json's modification time. The old check
  read a session list that buglog.json could never appear in, so the reminder
  fired even right after the file was updated (#68).
- On Windows, files on a different drive than the project are no longer indexed
  into anatomy (#68).
- Auto-detected buglog entries now name the file they refer to. Error-handling
  detection requires a real catch/except construct instead of a substring match,
  so a comment containing the word "catch" no longer files a bug, and test
  files are skipped by the error-handling and guard-clause rules. Reported with
  verified repros by spignataro (#73).
- The anatomy store now preserves anatomy.md lines it does not recognize, such
  as prose notes or entries sized in GB/MB instead of tokens, instead of
  silently deleting them on the next write. Reported with a proposed patch by
  prghbla (#61).
- The repeated-read notice only fires when the file is unchanged since the last
  read. A file modified during the session, by the agent or externally, can be
  re-read without a false warning, and writing a file clears its read record.
  The notice wording now leaves the gist-vs-exact decision to the model.
  Reported by 1re2turn1 (#41).
- `openwolf cron list` and `openwolf status` now say when the scheduler cannot
  run (pm2 missing, daemon not running, or heartbeat stale) instead of showing
  tasks as enabled that will never fire. Reported by Esturban (#75).

### Added

- `openwolf daemon status` shows whether the daemon is running.
- `openwolf cron enable <id>` and `openwolf cron disable <id>` toggle tasks
  without hand-editing cron-manifest.json.

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
