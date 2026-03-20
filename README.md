<p align="center">
  <img src="demo.gif" alt="OpenWolf demo" width="820" />
</p>

<h1 align="center">OpenWolf</h1>

<p align="center">
  <strong>A second brain for Claude Code.</strong><br />
  Project intelligence, token tracking, and invisible enforcement through 6 hook scripts. Zero workflow changes.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/openwolf"><img src="https://img.shields.io/npm/v/openwolf.svg" alt="npm version" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-blue.svg" alt="License: AGPL-3.0" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node.js-20%2B-green.svg" alt="Node.js" /></a>
</p>

---

## Why OpenWolf Exists

Claude Code is powerful but it works blind. It doesn't know what a file contains until it opens it. It can't tell a 50-token config from a 2,000-token module. It reads the same file multiple times in one session without noticing. It has no index of your project, no memory of your corrections, and no awareness of what it already tried.

OpenWolf gives Claude a second brain: a file index so it knows what files contain before reading them, a learning memory that accumulates your preferences and past mistakes, and a token ledger that tracks everything. All through 6 invisible hook scripts that fire on every Claude action.

## Real Numbers

Tested on a large active project. Same codebase, same prompts, different setups:

```
OpenClaw + Claude          ██████████████████████████████████████  ~3.4M tokens
Claude CLI (no OpenWolf)   ████████████████████████████████        ~2.5M tokens
OpenWolf + Claude CLI      ████████                                ~425K tokens
```

**OpenWolf saved ~80% of tokens** compared to bare Claude CLI on the same project.

Across 20 projects, 132+ sessions: average token reduction of 65.8%, with 71% of repeated file reads caught and blocked. These are numbers from real usage, not benchmarks. Your results will vary by project size and usage patterns.

## Quick Start

```bash
npm install -g openwolf
cd your-project
openwolf init
```

That's it. Use `claude` normally. OpenWolf is watching.

## What It Creates

`openwolf init` creates a `.wolf/` directory in your project:

| File | Purpose |
|------|---------|
| `anatomy.md` | Project file map with descriptions and token estimates |
| `cerebrum.md` | Learned preferences, corrections, Do-Not-Repeat list |
| `memory.md` | Chronological action log with token estimates |
| `buglog.json` | Bug fix memory, searchable, prevents re-discovery |
| `token-ledger.json` | Lifetime token tracking and session history |
| `hooks/` | 6 Claude Code lifecycle hooks (pure Node.js) |
| `config.json` | Configuration with sensible defaults |
| `identity.md` | Agent persona for this project |
| `OPENWOLF.md` | Instructions Claude follows every session |

## How It Works

Before Claude reads a file, OpenWolf tells it what the file contains and how large it is. If Claude already read that file this session, OpenWolf warns it. Before Claude writes code, OpenWolf checks your `cerebrum.md` for known mistakes. After every write, it auto-updates the project map and logs token usage. You see none of this. It just happens.

```
You type a message
    ↓
Claude decides to read a file
    ↓
OpenWolf: "anatomy.md says this file is ~380 tokens. Description: Main entry point."
    ↓
Claude reads the file
    ↓
OpenWolf: logs the read, estimates tokens, checks for repeated reads
    ↓
Claude writes code
    ↓
OpenWolf: checks cerebrum.md - no known mistakes matched
    ↓
Claude finishes
    ↓
OpenWolf: updates anatomy.md, appends to memory.md, updates token ledger
```

## The .wolf/ Files

<details>
<summary><strong>cerebrum.md</strong> - the learning memory</summary>

Claude updates this file when you correct it, express a preference, or make a decision. The Do-Not-Repeat list prevents the same mistake across sessions.

```markdown
## Do-Not-Repeat

- 2026-03-10: Never use `var` - always `const` or `let`
- 2026-03-11: Don't mock the database in integration tests - use the real connection
- 2026-03-14: The auth middleware reads from `cfg.talk`, not `cfg.tts` - got burned twice

## User Preferences

- Prefers functional components over class components
- Always use named exports, never default exports
- Tests go in `__tests__/` next to the source file

## Key Learnings

- This project uses pnpm workspaces with strict hoisting
- The API rate limiter uses a sliding window, not fixed buckets
- Auth middleware reads from env.JWT_SECRET, not config file
```

</details>

<details>
<summary><strong>anatomy.md</strong> - the project map</summary>

Every file gets a description and token estimate. Claude reads this instead of opening files when the summary is enough.

```markdown
## src/

- `index.ts` - Main entry point. Exports createProgram() for CLI. (~180 tok)
- `server.ts` - Express HTTP server with middleware chain. (~520 tok)

## src/api/

- `auth.ts` - JWT validation middleware. Reads from env.JWT_SECRET. (~340 tok)
- `users.ts` - CRUD endpoints for /api/users. Pagination via query params. (~890 tok)
```

</details>

<details>
<summary><strong>token-ledger.json</strong> - the receipt</summary>

Every session gets a line item. Lifetime totals tell you if OpenWolf is actually saving tokens.

```json
{
    "lifetime": {
        "total_tokens_estimated": 503978,
        "total_reads": 287,
        "total_writes": 269,
        "total_sessions": 15,
        "anatomy_hits": 198,
        "anatomy_misses": 89,
        "repeated_reads_blocked": 106,
        "estimated_savings_vs_bare_cli": 2066959
    }
}
```

</details>

<details>
<summary><strong>buglog.json</strong> - the bug memory</summary>

Before fixing anything, Claude checks if the fix is already known. After fixing, it logs the solution.

```json
{
    "id": "bug-012",
    "error_message": "TypeError: Cannot read properties of undefined (reading 'map')",
    "file": "src/components/UserList.tsx",
    "root_cause": "API response was null when users array was expected",
    "fix": "Added optional chaining: data?.users?.map() and fallback empty array",
    "tags": ["null-check", "api-response", "react"]
}
```

</details>

## Commands

```
openwolf init              Initialize .wolf/ and register hooks
openwolf status            Show health, stats, file integrity
openwolf scan              Refresh the project structure map
openwolf scan --check      Verify anatomy matches filesystem (exits 1 if stale)
openwolf dashboard         Open the real-time web dashboard
openwolf daemon start      Start background task scheduler
openwolf daemon stop       Stop the scheduler
openwolf daemon restart    Restart the scheduler
openwolf daemon logs       View scheduler logs
openwolf cron list         Show all scheduled tasks
openwolf cron run <id>     Trigger a task manually
openwolf cron retry <id>   Retry a dead-lettered task
openwolf designqc          Capture full-page screenshots for design evaluation
openwolf bug search <term> Search bug memory for known fixes
openwolf update            Update all registered projects to latest version
openwolf restore [backup]  Restore .wolf/ from a timestamped backup
```

## Design QC

Capture full-page screenshots of your running app and let Claude evaluate the design.

```bash
openwolf designqc
```

Auto-detects your dev server, captures viewport-height JPEG sections of every route, and saves them to `.wolf/designqc-captures/`. Then tell Claude to read the screenshots and evaluate. Requires `puppeteer-core`.

## Reframe

Ask Claude to help you pick a UI framework. OpenWolf ships a curated knowledge base of 12 frameworks (shadcn/ui, Aceternity, Magic UI, DaisyUI, HeroUI, Chakra, Flowbite, Preline, Park UI, Origin UI, Headless UI, Cult UI) with battle-tested migration prompts. Claude reads `.wolf/reframe-frameworks.md`, asks you a few questions, and executes the migration with the right prompt for your project.

## How OpenWolf Compares

OpenWolf is not an AI wrapper. It is 6 hook scripts and a `.wolf/` directory. It doesn't run your AI for you or change your workflow. It gives Claude Code what it lacks: a project map so it reads less, a memory so it learns faster, and a ledger so you see where tokens go.

## Requirements

- Node.js 20+
- Claude Code CLI
- Windows, macOS, or Linux
- Optional: PM2 for persistent background tasks
- Optional: `puppeteer-core` for Design QC screenshots

## Limitations

- Claude Code hooks are a relatively new feature. OpenWolf falls back to `CLAUDE.md` instructions when hooks don't fire.
- Token tracking is estimation-based (character-to-token ratio), not exact API counts. Accurate to within ~15%.
- `cerebrum.md` depends on Claude following instructions to update it after corrections. Compliance is ~85-90%, not 100%.
- This is v1.0.4. Things may break. [File issues](https://github.com/cytostack/openwolf/issues).

## Origin Story

We were building products with Claude Code at Cytostack when we noticed something off. Sessions were eating through tokens faster than they should. When we dug in, we found Claude re-reading the same files multiple times, scanning entire directories to find one function, and having no way to know what a file contained without opening it. There was no project map, no read awareness, no token visibility. So we built the tooling we wished existed -- a file index so Claude reads less, a learning memory so it gets smarter, and a ledger that tracks every token. That became OpenWolf.

## License

[AGPL-3.0](LICENSE)

## Author

Built by Farhan Palathinkal Afsal - [Cytostack](https://github.com/cytostack)
