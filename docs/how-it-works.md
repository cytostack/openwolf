# How It Works

OpenWolf operates as invisible middleware between you and your coding agent (Codex, OpenCode, Claude Code, and others). It has three layers: the `.wolf/` directory (state), lifecycle hooks (enforcement), and optional features (Reframe, bundled skills, daemon).

## The `.wolf/` Directory

Every OpenWolf project has a `.wolf/` folder containing:

| File | Purpose |
|------|---------|
| `OPENWOLF.md` | Master instructions your agent follows every turn |
| `anatomy-index.json` | Durable project index: descriptions, token estimates, content hashes, and per-file symbols |
| `anatomy.md` | Human-readable render of the index, kept in sync automatically |
| `cerebrum.md` | Learned preferences, conventions, and Do-Not-Repeat list |
| `memory.md` | Chronological action log (append-only per session) |
| `identity.md` | Project name, agent role, constraints |
| `STATUS.md` | Session handoff: resume in one small read |
| `config.json` | OpenWolf configuration |
| `token-ledger.json` | Lifetime token usage statistics |
| `buglog.json` | Bug encounter/resolution memory |
| `cron-manifest.json` | Scheduled task definitions |
| `cron-state.json` | Cron execution state and dead letter queue |
| `suggestions.json` | AI-generated project improvement suggestions |
| `reframe-frameworks.md` | UI framework knowledge base for Reframe |

The durable JSON stores are the source of truth; the Markdown files are human-readable renders and logs kept in sync by the hooks.

## Hooks, The Enforcement Layer

OpenWolf registers 7 lifecycle hooks via the agent's own hook system (`.claude/settings.json` for Claude Code, `.codex/hooks.json` for Codex, a native plugin for OpenCode). These fire automatically:

```
SessionStart ──→ session-start.js    Injects the budgeted context digest, flags stale anatomy
PreToolUse   ──→ pre-read.js         Warns on repeated reads, shows anatomy and symbol hints
PreToolUse   ──→ pre-write.js        Checks cerebrum Do-Not-Repeat patterns
PostToolUse  ──→ post-read.js        Estimates and records token usage
PostToolUse  ──→ post-write.js       Updates the anatomy store under a cross-process lock
PreCompact   ──→ precompact.js       Snapshots session state before context compaction
Stop         ──→ stop.js             Reads measured token usage from the transcript
```

**Key design decisions:**

- Hooks are **pure Node.js file I/O**. No network calls, no AI, no dependencies beyond Node stdlib
- Hooks **warn but never block**. A pre-read warning about a repeated read still allows the read
- Each hook has a **timeout** (5-10 seconds). They must be fast
- Atomic writes (write to `.tmp`, rename) prevent corruption

## The Anatomy System

`anatomy.md` is a structured index of every file in your project:

```markdown
## src/

- `index.ts`, Main entry point. startServer() (~380 tok)
- `server.ts`, Express HTTP server configuration (~520 tok)
```

When your agent is about to read a file, the pre-read hook tells it:
> "`server.ts` is 'Express HTTP server configuration' at ~520 tokens. Symbols: startServer L12-40 ~180 tok."

If the description is enough, the agent skips the full read. If it needs one function, it reads that line range with offset/limit instead of the whole file. This is how OpenWolf saves tokens.

The anatomy index lives in `anatomy-index.json` (the source of truth) and is rendered to `anatomy.md`. It is:
- **Generated** by `openwolf scan` or `openwolf init`
- **Updated incrementally** by the post-write hook, under a cross-process lock so concurrent writes never lose entries
- **Rescanned** every 6 hours by the daemon cron
- **Self-healing**: markdown edited by hand or by an older hook is absorbed back into the store by content hash

## The Cerebrum, Learning Memory

`cerebrum.md` has four sections:

- **User Preferences**, how you like things done (code style, tools, patterns)
- **Key Learnings**, project-specific conventions discovered during development
- **Do-Not-Repeat**, mistakes that must not recur, with dates
- **Decision Log**, significant technical decisions with rationale

When you correct your agent or express a preference, it updates the cerebrum. The pre-write hook then enforces Do-Not-Repeat rules on every subsequent write.

The cerebrum is populated with your project's name and description during `openwolf init`, and is automatically reviewed and cleaned by the weekly AI reflection task.


## Reframe

Reframe helps you choose a UI component framework. It ships as a `/reframe` skill and a knowledge file your agent reads when you ask about framework selection.

### How it works

1. **Knowledge file**, `.wolf/reframe-frameworks.md` contains a structured comparison of 13 UI component frameworks: shadcn/ui, Aceternity UI, Magic UI, DaisyUI, HeroUI, Chakra UI, Flowbite, Preline UI, Park UI, Origin UI, Headless UI, Cult UI, and Astryx. It leads with an anti-generic design mandate so results do not look AI-generated.

2. **Decision tree**, When you ask your agent to help pick a framework, it reads the knowledge file and asks targeted questions: What is your current stack? What is your priority (animations, speed, control, accessibility, enterprise)? Do you use Tailwind? What pages are you building?

3. **Comparison matrix**, The file includes a feature matrix covering styling approach, animation capabilities, setup complexity, best use case, and cost for each framework.

4. **Migration prompts**, Once a framework is selected, the file provides ready-made prompts tailored to that framework. Your agent adapts these to your actual project structure using `anatomy.md`.

### Why a knowledge file?

Framework selection is a conversation, not a command. Different projects have different constraints, and the best framework depends on context that only emerges through questions. A knowledge file lets your agent have that conversation naturally while drawing on structured, up-to-date comparison data.

## The Daemon

An optional background process that handles:

- **Cron tasks**, anatomy rescans, memory consolidation, token audits, AI reflections
- **File watching**, broadcasts `.wolf/` changes to the dashboard via WebSocket
- **Dashboard server**, serves the web dashboard at `http://localhost:18791`
- **Health monitoring**, heartbeat tracking, dead letter queue management

### Starting the daemon

There are two ways to run the daemon:

1. **`openwolf dashboard`**, starts the daemon automatically via `fork()`. No extra tools needed. The daemon runs as long as the parent process lives.

2. **`openwolf daemon start`**, starts via [PM2](https://pm2.keymetrics.io/) for persistent operation. Survives terminal closures and can auto-start on boot.

The daemon is optional. OpenWolf works without it, hooks are the primary layer. The daemon adds scheduled maintenance and the live dashboard.

### AI tasks and credentials

The daemon's optional AI tasks (`cerebrum-reflection` and `project-suggestions`) invoke the Claude CLI with `claude -p`, using your **Claude subscription credentials** from `~/.claude/.credentials.json`, not API credits. These maintenance tasks are Claude-CLI-specific; the core hooks and index work with every supported agent regardless.

If `ANTHROPIC_API_KEY` is set in your environment, OpenWolf automatically strips it when spawning `claude -p` to ensure the subscription OAuth token is used instead.

## Token Tracking

Every file read/write is estimated using character-to-token ratios:
- Code files: **3.5 characters per token**
- Prose files: **4.0 characters per token**
- Mixed: **3.75 characters per token**

These estimates are complemented by **measured** usage: at the end of every session the stop hook reads the real input, output, and cache token counts from the agent's transcript into the ledger, so `openwolf report` shows measured numbers next to the estimates. The waste detector looks for patterns like repeated reads, large reads where anatomy sufficed, and stale cerebrum files.
