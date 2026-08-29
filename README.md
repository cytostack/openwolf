<h1 align="center">OpenWolf</h1>

<p align="center">
  <strong>Your agents change. Your project memory shouldn't.</strong>
</p>

<p align="center">
  openwolf keeps one project memory across Claude Code, Codex and OpenCode,<br />
  intercepts the reads and command output that quietly fill your context,<br />
  and reports what each session actually cost, read from the harness transcript.<br />
  Pure local file I/O: no API calls, no telemetry, no added latency.
</p>

<p align="center">
  <sub><b>Full lifecycle hooks:</b> Claude Code, Codex CLI, OpenCode &nbsp;·&nbsp; <b>Context integration:</b> Cursor, Gemini CLI, Antigravity</sub>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/openwolf"><img src="https://img.shields.io/npm/v/openwolf?color=cb3837&label=npm" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/openwolf"><img src="https://img.shields.io/npm/dm/openwolf?color=2ea44f&label=downloads" alt="npm downloads" /></a>
  <a href="https://github.com/cytostack/openwolf/stargazers"><img src="https://img.shields.io/github/stars/cytostack/openwolf?color=444&label=stars" alt="GitHub stars" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="License" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D20-2ea44f" alt="Node.js" /></a>
</p>

<p align="center">
  <img src="assets/openwolf-dashboard.png" alt="" width="900" />
</p>

| Without OpenWolf | With OpenWolf |
|------------------|---------------|
| Each agent starts cold and learns your project separately | One `.wolf/` brain, shared across Claude Code, Codex and OpenCode |
| Switching agents means losing everything the last one learned | Corrections, bug fixes and project map follow you across tools |
| Your token usage is a monthly invoice with no line items | Real usage read from the transcript, per session, per agent |
| Nobody can tell you what broke the prompt cache | Attributed: model switch, compaction, version change, expiry |
| The agent rereads a file it already saw | Repeated reads caught; oversized Bash output condensed before it enters context |

## What it does

Coding agents waste tokens in predictable ways. A `grep -rn` dumps 40,000
tokens into context, and the session re-reads them from cache on every later
API call. The same file gets printed three times with `cat`. Conventions you
taught the agent last week are gone today. When context compacts, the agent
forgets what it already did.

OpenWolf installs lifecycle hooks into your agent and fixes this underneath
your normal workflow:

- Oversized Bash output is condensed before it enters context. The full text
  stays on disk with a pointer. Test failures are never touched.
- Your project gets a durable index. `openwolf find` locates any symbol in
  under 1k tokens. Large files carry exact line ranges so the agent reads one
  function, not the whole file.
- Corrections, conventions, and bug fixes are written to files that survive
  sessions, travel through git, and reach every agent and teammate.
- After compaction, OpenWolf restores what was lost: in-flight state, your
  rules, and the path-scoped instructions the platform drops.
- Everything is measured. Real usage from transcripts, hook delivery verified
  against the harness's own records, and savings counted only where OpenWolf
  can prove them.

## Quick start

```bash
npm install -g openwolf
cd your-project
openwolf init
```

`init` detects the agents installed on your machine and wires each of them.
Then use your agents as normal.

## Supported agents

| Agent | Integration |
|-------|-------------|
| Claude Code | Full: 12 hooks, output governor, skills, verified measurement |
| Codex CLI | Lifecycle hooks via `.codex/hooks.json` + `AGENTS.md` |
| OpenCode | Native plugin + `AGENTS.md` |
| Cursor | Rules file (context only) |
| Gemini CLI | `GEMINI.md` block (context only) |
| Antigravity | `AGENTS.md` block (context only) |

All agents share the same `.wolf/` directory. It ships with a `.gitignore`
that commits the useful state (conventions, handoff, bug log, index) and
ignores the machine-local runtime (ledgers, caches). On Claude Code the
learned conventions also sync with native auto-memory, in both directions.

## How it works

`openwolf init` creates `.wolf/` and registers hooks with your agent. The
hooks are plain Node.js scripts: no network, no AI calls, no dependencies.

| File | Purpose |
|------|---------|
| `anatomy-index.json` | Project index: descriptions, sizes, symbols, import graph |
| `cerebrum.md` | Preferences, conventions, and a Do-Not-Repeat list |
| `STATUS.md` | Session handoff. Regenerate with `/handoff` |
| `buglog.json` | Searchable memory of bugs and their fixes |
| `memory.md` | Action log per session |
| `token-ledger.json` | Measured, estimated, and verified usage |
| `hooks/` | The 12 lifecycle hooks, with health heartbeats |
| `cache/bash/` | Verbatim copies of every condensed Bash output |

During a session:

- **Session start.** A ~400-token index of your project state is injected:
  what each file holds, the top rules, the current handoff. Pointers, not
  content.
- **Before reads.** Duplicate reads get a note. Large files get their symbol
  map so the agent can read a slice.
- **After Bash.** Output over 2,000 tokens is condensed by command family:
  grep floods keep the first matches per file plus counts, `git show` keeps
  the header and diff stats, file re-prints keep head and tail. Original
  preserved, delta recorded. Test and build output is suggested-only by
  default because failure detail matters more than tokens.
- **Every 25 tool batches.** The top rules are repeated in one short note.
  Instruction compliance decays as sessions get longer (the one controlled
  study of this, across 1,650 sessions, found the decay and found that file
  size does not matter). Cadence is the fix.
- **On compaction.** State, rules, and scoped instructions are re-injected.
- **On stop.** The ledger records real usage per model and verifies against
  the transcript which hooks fired, which failed, and which injected context
  actually reached the model.

## Measurement

```bash
openwolf report
```

```
  Measured (all project transcripts, scanned now)
    API calls:              814
    Output tokens:          737,952
    Cache reads:            238,172,904
    Cache writes:           3,323,678

  Bash governor (measured at the rewrite point)
    Governed calls:         12
    Original output:        96,410
    Entered context:        14,867
    Kept out of context:    81,543

  Cache rebuilds (last 7 days): 6 events, 1,942,520 tokens re-written
    model_switch         3 events  929,737 tok
    cache_expired        1 events  524,661 tok
    unattributed         2 events  488,122 tok
```

Three things worth knowing about these numbers:

1. The governor delta is measured where nothing else can measure it. The
   platform's telemetry logs tool output before hooks run, so only the hook
   that rewrites the output knows what actually entered context.
2. Cache rebuilds are the most expensive events in an agent session: a full
   rebuild re-pays your entire context at the write rate instead of the 0.1x
   read rate. OpenWolf names the trigger and the cost.
3. Earlier releases reported estimated savings from a heuristic that counted
   tokens that were actually spent. That math is gone. OpenWolf also reports
   its own injection cost next to any saving it claims. If a context tool
   cannot show you measured numbers including its own overhead, doubt it.

`openwolf bench --repo <fixture> --yes` runs the same tasks with and without
OpenWolf and reports each token dimension separately, plus completion rate
and the bash re-run rate. It spends real API budget, so it requires `--yes`.

## Reliability

Invisible tools need proof of life. Every hook writes a heartbeat. Session
start verifies the installed hooks can load. `openwolf update` runs a
selfcheck on every hook after install and fails loudly instead of leaving a
broken install. The dashboard shows failing hooks with the error. This
exists because a hook once crashed silently 440 times over three weeks
before anyone noticed.

## Security

- Dashboard binds to 127.0.0.1 with per-project token auth.
- No shell interpolation anywhere; every process call uses argument arrays.
- Hooks never auto-approve tool calls. Permission decisions stay yours.
- Secret-bearing files (`.env`, keys, credentials) never enter any index.
- Path traversal guards on all cron file access.

## Skills

Installed for every wired agent:

- `/handoff` regenerates `STATUS.md` from git, the action log, and open items.
- `/security-audit` runs a layered audit and files results into the bug log.
- `/reframe` picks or migrates a UI framework from a curated comparison of
  13, with an anti-generic design mandate.

On Claude Code, the operating protocol ships as a proper skill so CLAUDE.md
stays a five-line stub.

## Dashboard

```bash
openwolf dashboard
```

Local, token-authenticated, live. The hero number is tokens verifiably kept
out of context. Around it: measured vs estimated usage, cache rebuild
attribution, per-agent breakdown, hook health, the anatomy browser, activity,
and cron control.

## Commands

```
openwolf init              Set up .wolf/ and wire detected agents
openwolf status            Health, stats, file integrity
openwolf scan              Rebuild the project index
openwolf scan --check      CI check: does the index match the tree
openwolf find <query>      Locate a symbol or file (ranked, ~1k tokens max)
openwolf find --file <p>   One file's description, size, and symbol map
openwolf map               Token-budgeted overview of the important files
openwolf report            Measured, verified, governed, attributed usage
openwolf bench             A/B benchmark with and without OpenWolf (--yes)
openwolf bug search <term> Full-text search over the bug memory
openwolf dashboard         Open the dashboard
openwolf cron list         Scheduled maintenance tasks
openwolf update            Update every registered project (backup first)
openwolf restore [backup]  Roll back .wolf/ from a backup
```

## Requirements

Node.js 20+ and at least one supported agent. Works on macOS, Linux, and
Windows. Bug-log full-text search uses Node's built-in SQLite on 22.5+ and
falls back to a simpler matcher below that.

## Limitations

- Estimates use a character-ratio heuristic. Measured and verified numbers
  come from transcripts and the rewrite point.
- The Bash governor and decay re-injection currently run on Claude Code.
  Codex and OpenCode get the core lifecycle hooks; Gemini and Cursor are
  context-only.
- Protocol compliance still depends on the model. Hooks enforce what can be
  enforced and measure the rest.

Found something broken? [File an issue](https://github.com/cytostack/openwolf/issues).

## Contributors

OpenWolf is better because people fixed it. Every merged contribution is credited here. Kindly let us know if we have missed a contribution. 

| | | | | |
|:-:|:-:|:-:|:-:|:-:|
| [<img src="https://github.com/fsener.png" width="60"/>](https://github.com/fsener)<br/>**fsener** | [<img src="https://github.com/albertomenache.png" width="60"/>](https://github.com/albertomenache)<br/>**albertomenache** | [<img src="https://github.com/whydoyouwork.png" width="60"/>](https://github.com/whydoyouwork)<br/>**whydoyouwork** | [<img src="https://github.com/mann1x.png" width="60"/>](https://github.com/mann1x)<br/>**mann1x** | [<img src="https://github.com/GordongWang.png" width="60"/>](https://github.com/GordongWang)<br/>**GordongWang** |
| [<img src="https://github.com/WeathermanTony.png" width="60"/>](https://github.com/WeathermanTony)<br/>**WeathermanTony** | [<img src="https://github.com/goashem.png" width="60"/>](https://github.com/goashem)<br/>**goashem** | [<img src="https://github.com/bryandent.png" width="60"/>](https://github.com/bryandent)<br/>**bryandent** | [<img src="https://github.com/levnikmyskin.png" width="60"/>](https://github.com/levnikmyskin)<br/>**levnikmyskin** | [<img src="https://github.com/svanack404.png" width="60"/>](https://github.com/svanack404)<br/>**svanack404** |
| [<img src="https://github.com/riverwolf67.png" width="60"/>](https://github.com/riverwolf67)<br/>**riverwolf67** | [<img src="https://github.com/nottyjay.png" width="60"/>](https://github.com/nottyjay)<br/>**nottyjay** | [<img src="https://github.com/alfasin.png" width="60"/>](https://github.com/alfasin)<br/>**alfasin** | [<img src="https://github.com/ChasLui.png" width="60"/>](https://github.com/ChasLui)<br/>**ChasLui** | [<img src="https://github.com/JarrodAI.png" width="60"/>](https://github.com/JarrodAI)<br/>**JarrodAI** |
| [<img src="https://github.com/meketreve.png" width="60"/>](https://github.com/meketreve)<br/>**meketreve** | [<img src="https://github.com/Laptopcorei7.png" width="60"/>](https://github.com/Laptopcorei7)<br/>**Laptopcorei7** | [<img src="https://github.com/statik1.png" width="60"/>](https://github.com/statik1)<br/>**statik1** | [<img src="https://github.com/spignataro.png" width="60"/>](https://github.com/spignataro)<br/>**spignataro** | [<img src="https://github.com/Esturban.png" width="60"/>](https://github.com/Esturban)<br/>**Esturban** |
| [<img src="https://github.com/prghbla.png" width="60"/>](https://github.com/prghbla)<br/>**prghbla** | [<img src="https://github.com/1re2turn1.png" width="60"/>](https://github.com/1re2turn1)<br/>**1re2turn1** | [<img src="https://github.com/aevnar.png" width="60"/>](https://github.com/aevnar)<br/>**aevnar** | [<img src="https://github.com/davdittrich.png" width="60"/>](https://github.com/davdittrich)<br/>**davdittrich** | [<img src="https://github.com/krsfer.png" width="60"/>](https://github.com/krsfer)<br/>**krsfer** |
| [<img src="https://github.com/kantorcodes.png" width="60"/>](https://github.com/kantorcodes)<br/>**kantorcodes** | | | | |

## License

[AGPL-3.0](LICENSE)

## Author

Built by Farhan Palathinkal, [Cytostack](https://github.com/cytostack)
