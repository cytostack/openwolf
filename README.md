<h1 align="center">OpenWolf</h1>

<p align="center">
  <strong>Keep project memory across your coding agents.</strong>
</p>

<p align="center">
  OpenWolf keeps task context, project maps and known fixes in one local folder.<br />
  Help Claude Code, Codex and OpenCode continue saved work and find relevant code.<br />
  Reduce repeated context and review recorded token usage by agent and model.<br />
  Memory and indexing run locally without extra model calls.
</p>

<p align="center">
  <sub><b>Hooks:</b> Claude Code, Codex CLI, Antigravity &nbsp;·&nbsp; <b>Plugin:</b> OpenCode &nbsp;·&nbsp; <b>Compatible hooks:</b> Grok Build &nbsp;·&nbsp; <b>Context only:</b> Cursor, Gemini CLI</sub>
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
| A new session may need the same project explanation again | Saved task context, project notes and known fixes remain in `.wolf/` |
| Switching agents can leave unfinished work in the previous conversation | Explicit Claude and Codex handover packets carry selected saved context |
| Usage records are spread across agent sessions | Available token counters and API cost estimates are grouped by agent and model |
| Older session notes make useful information harder to find | Eligible old notes are archived with verified restore pointers |
| Repeated file reads and large command results use session space | Read guidance and supported output controls help reduce repeated context |

## What it does

A coding session produces useful context: the task objective, files changed,
failed tests and the next action. That information can be difficult to recover
after compaction, a restart or a change of agent. Large file reads and command
results can also fill a session with repeated text.

OpenWolf stores selected context beside your project and connects to the
session and tool events your coding agent supports:

- Keep the objective, completed work, unresolved problems and next action in
  a checkpoint. Supported Claude and Codex hooks can restore saved context.
- Find files and symbols through a project map with descriptions, line ranges
  and import relationships. Partial scans preserve earlier entries.
- Save project notes and known fixes for later sessions. Archive eligible old
  session notes while retaining active, latest and pinned notes.
- Identify repeated reads of unchanged files. Supported Claude hooks can
  shorten selected large Bash results and retain the original output locally.
- Review available provider token counters, model cost estimates, hook health
  and completed OpenWolf activity in the dashboard.

## Quick start

```bash
npm install -g openwolf
cd your-project
openwolf init
```

`init` detects installed agents and sets up their project integration.
Complete any project or hook trust review shown by your agent, then start a
new session. You can select agents with `--agent claude codex opencode antigravity`.

## Supported agents

| Agent | Integration |
|-------|-------------|
| Claude Code | Lifecycle hooks, read guidance, Bash output controls and skills |
| Codex CLI | Project hooks and `AGENTS.md`: saved task recovery and supported session and tool events |
| OpenCode | Native plugin and `AGENTS.md`: session and tool events, usage records and activity toasts |
| Grok Build | Enabled Claude-compatible hook discovery; activity notices stay in the dashboard |
| Antigravity | Bridged project hooks (`.agents/hooks.json`) and `AGENTS.md`: session start, read/write/bash tool events and stop |
| Cursor | Rules file (context only) |
| Gemini CLI | `GEMINI.md` block (context only) |

Agents use the project's `.wolf/` directory. The generated `.gitignore`
excludes local runtime data. Review notes, bug records and indexed content
before sharing them. Hook coverage depends on the installed agent version.
See the [integration guide](docs/hooks.md) for details.

## How it works

`openwolf init` creates `.wolf/` and registers supported hooks or a plugin.
Memory, indexing and usage processing run locally without extra model calls.
The optional background update worker contacts npm to check for new runtimes.

| File | Purpose |
|------|---------|
| `anatomy-index.json` | Project index: file descriptions, sizes, symbols and imports |
| `cerebrum.md` | Candidate preferences, conventions and recurring corrections |
| `STATUS.md` | Current project status and unfinished work |
| `buglog.json` | Searchable records of problems and fixes |
| `memory.md` | Session notes and outcomes |
| `token-ledger.json` | Operational records and separate content-size estimates |
| `hooks/` | Installed lifecycle hooks and session state |
| `cache/bash/` | Preserved originals of shortened Bash output |
| `handoff/` | Task checkpoints, source references and handover packets |
| `archive/` | Older session notes with verified restore pointers |
| `usage/`, `activity/` | Recorded usage and completed OpenWolf actions |

During a session:

- **Session start.** Load a short project index and available saved task
  evidence. New sessions can select a verified compatible runtime update.
- **Before reads.** Identify eligible repeated reads and offer symbol guidance
  for large indexed files. Changed files and ranged reads are handled separately.
- **After Bash.** Supported Claude hooks can shorten selected output above an
  estimated size threshold. The original stays in a local cache. Test and
  build output are advisory-only by default.
- **Every 25 tool batches.** Supported Claude events can repeat selected
  approved rules within a size budget. Durable instruction injection requires
  an independently protected installation and administrator review.
- **On compaction.** Save a checkpoint for supported recovery paths. Recovery
  uses persisted task evidence; it cannot reproduce every part of live context.
- **On stop.** Record available usage and session observations. Eligible
  activity notices report completed work within the configured message limit.

## Measurement

```bash
openwolf report
```

Example from a checked Codex session, shown in a shortened format:

```
  Recorded provider usage
    Input tokens:           50,393
      Cached input:         28,800
      Fresh input:          21,593
    Output tokens:             146
      Reasoning tokens:         80
    Total tokens:           50,539

  Cost calculation
    Fresh input:            model input rate
    Cached input:           model cached-input rate
    Output:                 model output rate

  Coverage
    Cached input is included in input tokens.
    Reasoning is included in output tokens in this record.
    Content-size estimates are reported separately.
```

How to read the reports:

1. Recorded usage comes from available Claude transcripts, Codex session
   records and OpenCode plugin records. Repeated records are reconciled.
   Missing counters remain unavailable rather than being reported as zero.
2. Cost estimates use the relevant provider and model rates, including
   separate cache categories where available. They represent API list prices,
   not subscription charges. Unknown models and pricing assumptions are shown.
3. Local estimates describe content size and output changes. They are separate
   from provider counters and do not prove a fixed amount of token savings.

`openwolf usage report --json` provides the recorded-usage report.
`openwolf bench --repo <fixture> --yes` compares supported coding tasks with
and without OpenWolf. It uses real model access and can consume paid usage.

## Reliability

Hook heartbeats, runtime checks and dashboard health help identify missing
or failing integrations. Project updates check installed hook modules and
report errors. Concurrent writes use journals or locks where required, and
incomplete project scans retain entries they did not reach.

Compatible stable hook and plugin updates can be prepared in the background
for new sessions. Major upgrades are notification-only by default. A running
session keeps its selected runtime. This does not replace the global CLI or
a running dashboard daemon. See [automatic updates](docs/automatic-updates.md).

## Security

- The dashboard binds to `127.0.0.1` by default and requires a project token.
- Hooks do not approve tool calls. Permissions remain with the agent and user.
- Handover imports check project identity, source records and repository drift.
- Sensitive-file exclusions and path checks reduce accidental exposure. Review
  saved content before sharing it; automatic filtering has limits.
- Saved notes do not approve themselves. Automatic durable instruction
  injection requires independent administrator review and a protected runtime.

## Skills

Available through the supported agent integration:

- `/handoff` helps update `STATUS.md` with current work and open items.
- `/security-audit` guides a project review and records findings in the bug log.
- `/reframe` guides interface review, framework selection and migration work.

Skills guide your coding agent and use its normal model budget. For an explicit
Claude and Codex transfer, use the [handover commands](docs/commands.md).
OpenWolf can read supported local session records used for Claude recovery;
it does not run Claude's `/resume` inside Codex or access private reasoning.

## Dashboard

```bash
openwolf dashboard
```

The local dashboard shows project memory, the code index, handover records,
recorded token usage and API cost estimates by agent and model. Usage coverage
and missing data remain visible.

Activity history shows completed OpenWolf work, such as saved checkpoints,
restored context and archived notes. Hook health and update status show which
runtime is installed and whether a newer compatible runtime is ready. Data
refreshes while the dashboard is open. Restart the daemon after a package
upgrade to load updated dashboard code.

## Commands

```
openwolf init               Set up .wolf/ and detected agents
openwolf status             Check installation and hook health
openwolf scan               Refresh the project index
openwolf scan --check       Check index freshness without writing
openwolf find <query>       Find an indexed symbol or file
openwolf find --file <p>    Show one file's description and symbol map
openwolf map                Show a focused project overview
openwolf report             Review operational records and usage
openwolf usage report       Report available provider token counters
openwolf handoff list       Find saved Claude, Codex and Antigravity sessions
openwolf handoff search <q> Search saved task evidence
openwolf finalize           Manually close a session for agents with no auto session-end
openwolf memory archive     Archive eligible older session notes
openwolf bench              Compare supported tasks (--yes required)
openwolf bug search <term>  Search known problems and fixes
openwolf dashboard          Open the local dashboard
openwolf cron list          List scheduled maintenance tasks
openwolf update             Refresh registered projects from the installed package
openwolf self-update        Check npm and prepare a compatible project runtime
openwolf restore [backup]   List backups or restore the selected snapshot
```

## Requirements

Node.js 20 or later and at least one supported agent. OpenWolf runs on macOS,
Linux and Windows. Bug-log search uses Node's built-in SQLite where available
and falls back to a simpler matcher otherwise.

## Limitations

- Recorded usage is limited to the counters each agent saves. Local
  character-ratio estimates are not exact provider token counts.
- Hook and display support differ by agent and version. Claude output controls
  are not available through every other integration.
- Handover transfers selected saved evidence. A full live Claude to Codex to
  Claude coding handover and broader token-efficiency comparisons remain
  unverified. See the [validation record](docs/release-2.5.2.md).
- Protected durable memory needs independent administrator setup. Ordinary
  project maps, checkpoints, archival and activity reporting work without it.

[Report a problem](https://github.com/cytostack/openwolf/issues).

## Contributors

Contributor acknowledgements are retained below. The [credits](CREDITS.md)
and [issue and PR audit](docs/audit/README.md) distinguish reporters, PR
submitters, original authors and co-authors. Adapted work is identified
separately from merged contributions.

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

Created by Farhan Palathinkal, [Cytostack](https://github.com/cytostack)
