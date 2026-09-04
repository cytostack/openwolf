# How It Works

OpenWolf is invisible middleware between you and your coding agent. It has
three layers: the `.wolf/` directory (state), lifecycle hooks (enforcement
and measurement), and optional extras (dashboard, daemon, skills).

## The `.wolf/` directory

| File | Purpose |
|------|---------|
| `anatomy-index.json` | Durable project index: descriptions, token estimates, content hashes, symbols with line ranges, and the import graph |
| `anatomy.md` | Human-readable render of the index, kept in sync automatically |
| `cerebrum.md` | Learned preferences, conventions, and the Do-Not-Repeat list. Budgeted at 2k tokens |
| `memory.md` | Chronological action log, one block per session |
| `STATUS.md` | Session handoff. Regenerate with `/handoff`. Budgeted at 1k tokens |
| `buglog.json` | Bug and fix memory with full-text search |
| `token-ledger.json` | Measured, estimated, and transcript-verified usage |
| `config.json` | Configuration: governor, budgets, cadences, ports |
| `hooks/` | The compiled hook scripts, session state, and health heartbeats |
| `cache/bash/` | Verbatim copies of every governed Bash output |
| `.gitignore` | Splits committed state from machine-local runtime |
| `OPENWOLF.md` | The operating protocol, for agents without a skill surface |

The split matters: cerebrum, STATUS, buglog, and the index are meant to be
committed. They travel through git and code review, so conventions and known
fixes reach every teammate and every agent. Ledgers, caches, and hook state
stay machine-local.

## Hooks

OpenWolf registers 12 lifecycle hooks through the agent's own hook system
(`.claude/settings.json` for Claude Code, `.codex/hooks.json` for Codex, a
native plugin for OpenCode):

```
SessionStart  ──→ session-start.js  Self-test, state index injection, compaction restore
UserPromptSubmit → user-prompt-submit.js  Delivers queued reminders with the next prompt
PreToolUse    ──→ pre-read.js       Duplicate-read advisories, anatomy and symbol hints
PreToolUse    ──→ pre-write.js      Do-Not-Repeat checks, relevant past bug fixes
PreToolUse    ──→ pre-bash.js       Suggests output caps for flood-prone commands
PostToolUse   ──→ post-read.js      Records real read sizes
PostToolUse   ──→ post-write.js     Index update under a lock, action log, state budgets
PostToolUse   ──→ post-bash.js      The output governor and bash-channel read dedupe
PostToolBatch ──→ post-batch.js     Rule re-injection every N batches
PreCompact    ──→ precompact.js     Session snapshot before compaction
Stop          ──→ stop.js           Ledger flush with measured and verified numbers
SessionEnd    ──→ session-end.js    Final flush and session summary
```

Design rules that hold everywhere:

- Hooks are pure Node.js file I/O. No network, no AI calls, no dependencies.
- Hooks never auto-approve tool calls. Output is condensed after execution;
  permission decisions stay with you.
- Nudges are factual statements delivered through the platform's context
  channel, not warnings shouted into a log.
- Every hook writes a heartbeat, so a broken hook is visible within one
  session instead of weeks later.
- Session state is keyed by the harness session id, so concurrent sessions
  in one project never contaminate each other's tracking.

## The Bash output governor

Bash results are the largest single source of context waste: grep floods,
`git show` dumps, test logs, whole files printed with `cat`. In our audit of
16 live projects, Bash carried 48% of all tool-result tokens, and results
over 2,000 tokens made up a quarter of that channel.

When a Bash result exceeds the threshold, the governor condenses it by
command family before it reaches the model:

- **grep / rg floods**: first matches per file, per-file counts, a total.
- **git show / git log -p / git diff**: commit header and per-file diff
  stats; hunks are elided with counts.
- **File re-prints** (`cat`, `sed -n`): a head-and-tail window.
- **Test and build output**: never replaced by default. Those families get a
  suggestion, because failure detail is worth more than tokens. stderr is
  never modified by any family.

The full output is always preserved at `.wolf/cache/bash/<id>.log` and every
condensed result ends with a pointer to it. Condensation only happens when
it saves at least 30%. Every family has its own switch in
`openwolf.bash.governor`.

For every governed call the ledger records original tokens versus tokens
that entered context. This delta is unique ground truth: the platform's own
telemetry captures tool output before hooks run, so only the hook doing the
rewriting can measure what the model actually received.

The same hook also parses simple `cat`/`head`/`tail`/`sed` commands and
registers those reads in session tracking, because that is the channel where
duplicate reads actually happen.

## The anatomy system

The index maps every file with a description, a token estimate, a content
hash, and (for larger files) its symbols with exact line ranges, parsed with
tree-sitter on scan. Supported for symbol extraction: TypeScript,
JavaScript, Python, Go, Rust, Java, Ruby, PHP. Lockfiles, caches, minified
files, and agent-config directories are never indexed.

Agents consume the index three ways:

1. **Hints.** Before a read, the pre-read hook surfaces the description and
   the symbol map, so the agent can skip the read or fetch one function with
   `offset`/`limit`. For big files it can serve a signature outline instead.
2. **`openwolf find <query>`.** A ranked shortlist of matching symbols and
   paths, capped near 1k tokens. `find --file <path>` prints one file's full
   entry.
3. **`openwolf map`.** A token-budgeted overview of the most important
   files, ranked by personalized PageRank over the import graph. The ranking
   is seeded by what this session has already touched and by `--focus`
   terms, then fitted to the budget by binary search.

Freshness is handled without nagging the model: the index stores a root hash
over every (path, content hash) pair, and a fast stat sweep answers "does
this index still describe this tree". The daemon rescans only when the
answer is no, or when git HEAD moved.

## The cerebrum and the decay problem

`cerebrum.md` holds user preferences, key learnings, a dated Do-Not-Repeat
list, and a decision log. When you correct your agent, it writes the
correction here. The pre-write hook then checks every edit against the
Do-Not-Repeat list, and recalls relevant past bug fixes from `buglog.json`
before the same mistake is re-made.

Two mechanisms keep this working over long sessions:

- **Re-injection cadence.** The only controlled study of instruction
  adherence (1,650 sessions) found that compliance decays as the session
  gets longer, and that instruction-file size has no measurable effect. So
  instead of growing the file, OpenWolf re-surfaces the top rules in one
  short note every 25 tool batches (configurable).
- **Compaction restore.** The platform documents that path-scoped rules and
  nested instructions are dropped at compaction until a matching file is
  read again. When a session continues after compaction, OpenWolf re-injects
  those rules for the files in flight, along with the top Do-Not-Repeat
  rules and the list of files already modified.

State files have budgets (cerebrum 2k tokens, STATUS 1k). Writing past the
budget produces one factual warning per session, the same
measure-after-write enforcement the platform's native memory uses.

On Claude Code, the cerebrum also syncs with native auto-memory in both
directions: learned rules reach Claude's own recall, and topics recorded
natively become visible in the committed cerebrum for other agents and
teammates.

## Measurement

Three levels, from softest to hardest:

1. **Estimates**: character-ratio heuristics (3.5 chars per token for code,
   4.0 for prose). Always labeled as estimates.
2. **Measured**: real input, output, cache read, and cache write tokens from
   the harness transcripts, per model, including subagent sidechains.
3. **Verified**: the transcript records every hook invocation, so the ledger
   knows which hooks fired, which failed, and which injected context
   provably entered the conversation.

The ledger also attributes prompt-cache rebuilds. A full rebuild re-pays
your entire context at the cache-write rate instead of the 0.1x read rate,
which makes it the most expensive event in an agent session. OpenWolf
detects rebuilds from the usage sequence and names the trigger: model
switch, compaction, version change, cache expiry, or honestly unattributed.

## The daemon

An optional background process for scheduled maintenance and the live
dashboard:

- **Stale-gated rescans**: the anatomy index is rescanned only when the stat
  sweep or a git HEAD move says it is actually stale.
- **Measured-usage refresh**: scans all project transcripts into the ledger.
- **Memory consolidation**: compresses session blocks older than the
  configured window. Pure file rewriting, no model involved.
- **Dashboard server** with WebSocket live updates, bound to localhost with
  per-project token auth.

Start it with `openwolf dashboard` (auto-fork, no extra tools) or
`openwolf daemon start` (PM2, survives reboots). OpenWolf works fully
without it; hooks are the primary layer.
