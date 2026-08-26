# Commands

Complete reference for the OpenWolf CLI.

## `openwolf init`

Initialize OpenWolf in the current project.

```bash
openwolf init                          # auto-detect installed agents (default)
openwolf init --agent codex opencode   # wire exactly these agents
openwolf init --agent all              # wire every supported agent
openwolf init --agent claude           # Claude Code only, skip detection
```

What it does:

1. Detects the project root (`.git`, `package.json`, `Cargo.toml`, and so on)
2. Creates `.wolf/` with the state files, the durable index, and a
   `.gitignore` splitting committed state from machine-local runtime
3. Copies the hook scripts to `.wolf/hooks/` and registers 12 hooks in
   `.claude/settings.json`
4. Auto-detects other installed agents (Codex, OpenCode, Gemini CLI, Cursor)
   and wires each one
5. Installs the skills (`/handoff`, `/security-audit`, `/reframe`,
   `/designqc`) for every wired agent, plus the `openwolf` protocol skill
   for Claude Code
6. Writes a five-line `CLAUDE.md` stub and `.claude/rules/openwolf.md`
7. Runs the initial anatomy scan (descriptions, symbols, import graph)

Re-running init is safe: templates refresh, learned data is preserved, and
existing hook entries in `.claude/settings.json` are merged, not replaced.

---

## `openwolf status`

Health, stats, and file integrity: core files present, all hook scripts
present, agent registrations, token stats, index size, daemon state.

---

## `openwolf scan`

Force a full anatomy rescan.

```bash
openwolf scan
```

Rescans descriptions, token estimates, tree-sitter symbols, and the import
graph. Lockfiles, caches, minified files, and agent-config directories are
excluded automatically. Normally you never need this: the post-write hook
updates entries incrementally, and the daemon rescans when the index is
actually stale.

### `openwolf scan --check`

Exits 1 if the index no longer matches the tree. CI-friendly:

```bash
openwolf scan --check || echo "index out of date"
```

---

## `openwolf find <query>`

Locate a symbol or file from the index alone. Results are ranked by match
quality, then import-graph importance, and the output is capped near 1,000
tokens so agents can use it instead of grepping the tree.

```bash
openwolf find validateToken
```

```
src/auth/token.ts:82-140 method Auth.validateToken ~450 tok
src/auth/token.ts:5-160 class Auth ~1,240 tok
src/middleware/verify.ts file ~380 tok Token verification middleware
```

### `openwolf find --file <path>`

Full index detail for one file: description, size, importance, and every
symbol with its line range. The cheap replacement for reading the file, or
the index, whole.

---

## `openwolf map`

A token-budgeted overview of the most important files, ranked by
personalized PageRank over the import graph. The ranking is seeded by files
your recent sessions touched and by `--focus` terms, then fitted to the
budget by binary search.

```bash
openwolf map                    # ~1k tokens (2k when no session seeds exist)
openwolf map --focus auth,jwt   # bias the ranking toward these terms
openwolf map --budget 500       # explicit output budget
```

---

## `openwolf report`

The token report, hardest numbers first:

- **Measured**: real usage scanned from every project transcript right now,
  per model, subagent sidechains included
- **Bash governor**: original output versus what entered context, measured
  at the rewrite point
- **Cache rebuilds**: the last 7 days of prompt-cache invalidations with
  their triggers (model switch, compaction, version change, expiry) and
  token cost
- **Estimates**: clearly labeled heuristics, including OpenWolf's own
  injection cost

```bash
openwolf report
```

---

## `openwolf bench`

The A/B benchmark: the same task set against two fresh clones of a fixture
repo, one with OpenWolf and one bare, via headless runs.

```bash
openwolf bench --repo /path/to/fixture --yes
openwolf bench --repo <git-url> --task bugfix --repeats 5 --yes
```

Reports medians per token dimension (input, output, cache read, cache
write), task completion, and the bash re-run rate. Spends real API budget;
refuses to run without `--yes`. Raw results are written to a JSON file.

---

## `openwolf bug search <term>`

Full-text search over the bug memory, relevance ranked (SQLite FTS on Node
22.5+, substring fallback below).

```bash
openwolf bug search "cannot read properties"
```

---

## `openwolf dashboard`

Open the dashboard. Starts the daemon automatically if it is not running; no
PM2 required. Each project gets its own port and token.

---

## `openwolf daemon`

```bash
openwolf daemon start     # persistent daemon via PM2
openwolf daemon stop      # stop this project's exact PM2 registration
openwolf daemon restart   # restart this project's exact PM2 registration
openwolf daemon logs      # last 50 lines
```

Stop and restart control only the current project's PM2 registration. They
do not discover or terminate processes by dashboard port.

The daemon handles stale-gated anatomy rescans, measured-usage refresh,
memory consolidation, and the dashboard server. It makes no network calls.

---

## `openwolf cron`

```bash
openwolf cron list        # tasks, schedules, last runs
openwolf cron run <id>    # trigger now (works without the daemon)
openwolf cron retry <id>  # clear a task from the dead letter queue
```

---

## `openwolf update`

Update every registered project to the installed OpenWolf version.

```bash
openwolf update                   # all projects
openwolf update --project my-app  # one project (partial match)
openwolf update --dry-run         # preview
openwolf update --list            # show registered projects
```

Each update takes a timestamped backup first, merges new config defaults
without touching your values, removes dead weight only when it is verifiably
untouched template content, and then verifies the hook install with a
per-hook selfcheck. A failed verification fails the update loudly instead of
leaving a broken install.

---

## `openwolf restore [backup]`

List backups (no argument) or restore `.wolf/` from one:

```bash
openwolf restore
openwolf restore 2026-08-20T1655
```

---

## `openwolf --version`

```bash
openwolf --version
```
