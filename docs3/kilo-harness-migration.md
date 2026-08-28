# Kilo harness adapter — design

> **Status**: Plan only. No code yet. Critiqued 2026-08-25 ([critic](./critic/kilo-harness-migration.md)).
> **Goal**: Wire OpenWolf's `.wolf/` brain into Kilo as an `AgentAdapter` — the same product as OpenCode, not a Claude-style subprocess hook install.
> **Companion**: [PLAN.md](./PLAN.md)

## 背景

OpenWolf already ships three activation paths for one brain:

- Claude / Codex: out-of-process `src/hooks/*.ts` (`readStdin` → stderr → `exit 0`).
- OpenCode: in-process plugin under `.opencode/plugin/` (`src/agents/opencode.ts` + `src/templates/opencode-plugin/`).
- Gemini / Cursor / Antigravity: context-file only (no lifecycle hooks).

Kilo is an OpenCode fork with a rebranded plugin API (`@kilocode/plugin`) and config dir (`.kilo/`). A Kilo user who only has the OpenCode plugin installed sees nothing: Kilo's system prompt forbids writing *new* project config to `.opencode/` or `.kilocode/` (`packages/opencode/src/kilocode/system-prompt.ts:29`).

**结论：Phase 1 is a clone of the thin OpenCode plugin into `.kilo/plugin/`, plus five load-bearing deltas (path, module shape, types package, idle hook, event envelope). Do not copy `src/hooks/*.ts`. Do not create a second brain. The clone that skips the event envelope will load and then silently skip every session event.**

---

## 是什么 / 不是什么

| Layer | 是什么 | 不是什么 |
|---|---|---|
| Product | `.wolf/` files + the same lifecycle *behaviors* the OpenCode plugin already performs | `.claude/settings.json`, `HOOK_SETTINGS`, `$CLAUDE_PROJECT_DIR` |
| Claude / Codex | Out-of-process command hooks, JSON on stdin | The brain |
| OpenCode (shipped) | In-process plugin mapping those behaviors onto `.wolf/` | A second brain |
| Kilo | Same plugin *shape* as OpenCode, different install path + types + event envelope | A Claude-style `settings.json`; a Kilo-repo patch |
| Persistence | `.wolf/` rows/files, shared with every agent | A Kilo session-log fold, a Codex goal row, a `.kilo/state/` store |
| Phase 1 plugin | Thin OpenCode clone: anatomy lock/store, `_session.json`, `memory.md`, cerebrum warn, token-ledger | Hippocampus, claims, session-digest injection, measured transcript usage |

---

## Five deltas vs OpenCode (all required)

1. **Install path**: `.kilo/plugin/`, never `.opencode/plugin/` or `.kilocode/plugin/`.
2. **Module shape**: default-export `{ id: "openwolf", server }`. Do not `export { OpenWolf }`. Kilo's loader requires `mod.default.server` (`packages/opencode/src/plugin/shared.ts:272-303`). Named-export fallback exists for legacy modules; do not rely on it.
3. **Types**: `import type { Plugin } from "@kilocode/plugin"` — **type-only**. A value import can fail before Kilo auto-creates `.kilo/package.json`.
4. **Stop mapping**: Claude `Stop` / OpenCode `stop` → Kilo `event` of type `session.idle`. `Hooks` has no `stop` field (`packages/plugin/src/index.ts:222-335`).
5. **Event envelope** (the one the original draft missed): Kilo dispatches

   ```ts
   hook["event"]?.({ event: { id, type, properties: event.data } })
   ```

   (`packages/opencode/src/plugin/index.ts:267`). Session id is **not** on the event object.

   | Event | Session id lives at |
   |---|---|
   | `session.created` / `session.deleted` | `event.properties.info.id` |
   | `session.idle` | `event.properties.sessionID` |

   OpenCode plugin today: `(event as any).session_id \|\| (event as any).sessionID` then `if (!sessionId) return` (`src/templates/opencode-plugin/index.ts:18-19`). Copy that line into Kilo and session start / delete / idle never run.

Tool hooks are a different channel: `tool.execute.before/after` receive `input.sessionID` at the top level. Those do not need the envelope helper. Event hooks do.

---

## Event id helper (required in `index.ts`)

```ts
function sessionIdOf(event: { type: string; properties?: Record<string, unknown> } & Record<string, unknown>): string {
  const props = (event.properties ?? {}) as Record<string, unknown>
  const info = props.info as { id?: string } | undefined
  return String(
    info?.id ||
    props.sessionID ||
    event.sessionID ||
    event.session_id ||
    "",
  )
}
```

Use this for `session.created`, `session.deleted`, and `session.idle`. Keep the OpenCode top-level fallbacks so a future payload flatten does not break us.

---

## Hook map

| OpenWolf behavior | Claude / Codex | OpenCode plugin today | Kilo Phase 1 |
|---|---|---|---|
| Session digest files, `_session.json`, `memory.md` header | `SessionStart` → `session-start.js` | `event: session.created` (top-level id — **broken on Kilo**) | same event, **via `sessionIdOf`** |
| User-prompt extras (hippocampus penalty) | `UserPromptSubmit` → `user-prompt.js` | missing | **skip** (needs hippocampus) |
| Repeated-read warning + anatomy hint | `PreToolUse` matcher `Read` | `tool.execute.before` if `read` | same |
| Cerebrum Do-Not-Repeat | `PreToolUse` matcher `Write\|Edit\|MultiEdit` | `tool.execute.before` if `write`/`edit` | same; also match `multiedit` |
| Token estimate after read | `PostToolUse` `Read` | `tool.execute.after` if `read` | same |
| Anatomy store + memory log | `PostToolUse` `Write\|Edit\|MultiEdit` | `tool.execute.after` if `write`/`edit` | same; also `multiedit` |
| Test-outcome tracking (hippocampus) | `PostToolUse` `Bash\|…` → `post-test.js` | missing | **skip** (needs hippocampus) |
| Compaction snapshot | `PreCompact` → `precompact.js` | missing | `experimental.session.compacting`: snapshot `_session.json` to `hooks/_precompact-snapshot.json`; optional short digest in `output.context`; **never set `output.prompt`** |
| Token ledger / wrap-up | `Stop` → `stop.js` | **`stop` hook** (ignored by Kilo) | `event: session.idle` via `sessionIdOf`. Per-turn, same as Claude Stop. Multiple ledger rows per session are expected. |
| Inject `OPENWOLF.md` | Claude rules + `CLAUDE.md` snippet | `experimental.chat.system.transform` | same **plus** `AGENTS.md` marker |
| Skills `/reframe`, `/security-audit` | `.claude/commands/*.md` | `.opencode/command/*.md` | `.kilo/command/*.md` |

Kilo tool names are camelCase (`filePath`, `oldString`). The OpenCode plugin already accepts both snake and camel. Keep that.

Kilo `tool.execute.before` can mutate `output.args`. OpenWolf policy is **warn never block**. Do not start denying reads/writes because the API allows it.

`session.idle` is marked deprecated in schema (`session-status-event.ts:52`) but still published when status becomes idle (`session/status.ts:42-44`). Phase 1 uses idle. Phase 2 may also listen to `session.status` with `status.type === "idle"` as a backup. Do not collapse wrap-up onto `session.deleted` — that is process-end, not turn-idle.

---

## Kilo load constraints (load-bearing)

Kilo scans config dirs with a **non-recursive** glob (`packages/opencode/src/config/plugin.ts:21`):

```
{plugin,plugins}/*.{ts,js}
```

So the OpenCode two-file layout is required:

```
.kilo/plugin/openwolf.ts          # loaded (top-level .ts)
.kilo/plugin/openwolf/*.ts        # NOT loaded; imported by the entry
```

Commands **are** recursive (`{command,commands}/**/*.md` in `config/command.ts:32`). `.kilo/command/reframe.md` is the right destination.

Directory sources Kilo actually reads (after built-ins):

- Global: `~/.config/kilo/plugin/` (XDG; Windows: `%USERPROFILE%\.config\kilo`)
- Project: `.kilo/plugin/` (legacy `.kilocode/plugin/` also works; **do not write there**)

`KILO_PURE=1` skips all external plugins. Directory auto-load is not a workaround.

Module shape:

```ts
import type { Plugin } from "@kilocode/plugin"

const server: Plugin = async ({ directory }) => ({ /* hooks */ })

export default { id: "openwolf", server }
```

Use plugin **v1** runtime hooks (`event`, `tool.execute.*`, `experimental.*`). Do not use `@kilocode/plugin/v2/*`.

Kilo auto-creates `.kilo/package.json` and installs `@kilocode/plugin` when a `plugin/` folder exists. That is why the type import resolves at *Kilo* load time — OpenWolf init itself does not run `bun install`.

`PluginInput` exposes both `directory` (session cwd) and `worktree` (git root). The OpenCode plugin keys off `directory`. Agent Manager child sessions may have `.wolf/` only at the worktree root — inherited limitation, not a Phase 1 fix. `handleSessionStart` also overwrites a single `_session.json`; concurrent parent+child sessions clobber. Same inherited limit.

---

## Where logic lives

Three copies of hook *logic* already exist. Do not create a fourth fork of hippocampus.

| Copy | Path | Fidelity |
|---|---|---|
| Claude/Codex subprocesses | `src/hooks/*.ts` | Full: hippocampus, claims, anatomy lock, symbol hints, measured transcript usage |
| OpenCode in-process plugin | `src/templates/opencode-plugin/*.ts` | Thin but not empty: anatomy lock + `anatomy-index.json`, `extractDescription`, `_session.json`, `memory.md`, cerebrum Do-Not-Repeat, buglog heuristic, token-ledger. No hippocampus/claims/digest/transcript |
| Installed OpenCode copy | `.opencode/plugin/openwolf/` in this repo | Copy of the thin plugin |

**Phase 1 choice:** clone the OpenCode plugin (thin). Same fidelity as today's OpenCode integration, **plus** the event-envelope helper, `session.idle`, compact snapshot, and `multiedit` matching.

**Later (not this slice):** extract shared handlers into `src/runtime/` and point Claude scripts + in-process plugins at it. Only worth it if OpenCode **and** Kilo both need hippocampus/claims parity. Two thin copies are cheaper than a third abstraction until then. Anatomy lock strings in `kilo-plugin/anatomy.ts` must stay identical to `opencode-plugin/anatomy.ts` (extend the existing source assertion).

---

## Adapter contract

Reuse `AgentAdapter` (`src/agents/types.ts`):

```ts
install(ctx: { projectRoot, wolfDir, templatesDir }): { actions, warnings }
```

Must be idempotent. `openwolf update` already re-runs every adapter listed in `config.openwolf.agents` (`src/cli/update.ts` step 5c). Once `kilo` is in the registry **and** recorded in that config field, update refreshes the plugin with no extra update-path code.

This *source* repo is named `openwolf`; `init` skips registering it (`src/cli/init.ts:358-360`). Dogfood verification must use a **throwaway repo**, not this tree.

Detection (add next to the OpenCode check in `detectInstalledAgents`):

- `path.join(os.homedir(), ".config", "kilo")` exists, or
- `kilo` is on PATH (`where` / `which`, same as existing `onPath`)

Do **not** treat a project-local `.kilo/` as “Kilo is installed” (leftover config false positive). VS Code-only Kilo users without CLI/config dir will not auto-detect — `--agent kilo` still works. Do not block Phase 1 on VS Code detection.

`--agent claude` continues to skip extras. `--agent kilo` wires only Kilo (+ always-on Claude, `init.ts:376`). `--agent all` includes Kilo. No `--agent` flag auto-detects.

---

## Install footprint

```
.kilo/plugin/openwolf.ts                 # default-export entry
.kilo/plugin/openwolf/{index,session,pre-read,pre-write,
                       post-read,post-write,stop,fs,anatomy,types}.ts
AGENTS.md                                # upsert OpenWolf marker block
.kilo/command/{reframe,security-audit}.md
```

Entry file (written by the adapter, not copied from templates):

```ts
// OpenWolf plugin entry — installed by `openwolf init --agent kilo`.
import { server } from "./openwolf/index.js"
export default { id: "openwolf", server }
```

`index.ts` must **export `server`**, not only default-export it, so this entry compiles.

Do not write `kilo.json` `plugin: []` entries. Directory auto-load is enough.

Do not write `.opencode/`, `.kilocode/`, or `~/.config/kilo/plugin/` from `openwolf init`. Project-local only.

Skill markdown keeps `$ARGUMENTS`. Frontmatter `argument-hint` is ignored by Kilo's command schema (`packages/core/src/v1/config/command.ts`) — leave it; no harm.

---

## Out of scope

- Codex-style goal persistence / idle self-start loop. OpenWolf stickiness is STATUS.md + session digest + cerebrum, not a goal row.
- Patching Kilo itself (`D:\GitRepo-AI\kilocode\`). This work lives in OpenWolf.
- Extracting `src/runtime/` (Phase 3).
- Raising OpenCode/Kilo plugin fidelity to Claude's hippocampus/claims level.
- Blocking tool calls.
- npm-publishing `@openwolf/kilo-plugin`. Local files under `.kilo/plugin/` are the product.
- `chat.message` user-correction events (hippocampus).
- `bash` post-test hippocampus penalties.
- Per-session `_session.json` for Agent Manager children.
- VS Code-only Kilo auto-detect.
- Making `console.warn` appear in Kilo TUI (verify in Phase 1; if invisible, log path is a Phase 2 gap, not a blocker for filesystem side effects).

---

## Closed decisions

- Source of truth remains `.wolf/`. One brain, many adapters.
- First ship is OpenCode-plugin fidelity, not Claude-hook fidelity.
- Plugin v1 hooks, not v2 transforms.
- Project-local `.kilo/plugin/` only; directory auto-load, no `kilo.json` patch.
- Warn never block.
- `openwolf update` reuses existing adapter replay.
- Two template dirs (`opencode-plugin` + `kilo-plugin`). Duplication is cheaper than a generator.
- Skip `chat.message` and `bash` post-test in Phase 1.
- Never set `experimental.session.compacting` `output.prompt`.
- `session.idle` wrap-up is per-turn; do not dedupe down to one ledger row per session.

## Open decisions (do not block Phase 1)

- Whether `console.warn` is visible in Kilo logs/TUI. If not, filesystem assertions still pass.
- Publishing an npm plugin later. Local files first.
- Listening to `session.status` as an idle backup (Phase 2).

---

## Evidence (read these, do not re-derive)

| Fact | Where |
|---|---|
| AgentAdapter + registry | `src/agents/types.ts`, `src/agents/index.ts` |
| OpenCode install | `src/agents/opencode.ts` |
| OpenCode plugin body + broken-on-Kilo session id | `src/templates/opencode-plugin/index.ts:18-19` |
| Claude hook table | `src/cli/init.ts` `HOOK_SETTINGS` |
| Update re-runs adapters | `src/cli/update.ts` ~5c |
| Init always-on Claude + skip self-register | `src/cli/init.ts:358-376` |
| Skills destinations | `src/agents/skills.ts` |
| AGENTS.md marker | `src/agents/markers.ts`, `src/templates/agents-md-snippet.md` |
| Kilo Plugin / Hooks (no `stop`) | `D:\GitRepo-AI\kilocode\packages\plugin\src\index.ts` |
| Kilo plugin glob | `D:\GitRepo-AI\kilocode\packages\opencode\src\config\plugin.ts` `load()` |
| Kilo event envelope | `D:\GitRepo-AI\kilocode\packages\opencode\src\plugin\index.ts:267` |
| Default-export `{id,server}` | `D:\GitRepo-AI\kilocode\packages\opencode\src\plugin\shared.ts` `readV1Plugin` |
| Session created/deleted/idle payloads | `D:\GitRepo-AI\kilocode\packages\sdk\js\src\gen\types.gen.ts` |
| Idle still published | `D:\GitRepo-AI\kilocode\packages\opencode\src\session\status.ts:42-44` |
| Compacting `output.prompt` replaces default | `D:\GitRepo-AI\kilocode\packages\opencode\src\session\compaction.ts:377-382` |
| Kilo plugin docs | `D:\GitRepo-AI\kilocode\packages\kilo-docs\pages\automate\extending\plugins.md` |
| Kilo forbids `.opencode/` | `D:\GitRepo-AI\kilocode\packages\opencode\src\kilocode\system-prompt.ts` |
| Command glob recursive | `D:\GitRepo-AI\kilocode\packages\opencode\src\config\command.ts:32` |

---

## Phase 1 done when

Authoritative checklist: [PLAN.md](./PLAN.md) §A (merge gate) and §B (live dogfood). Summary:

- **Merge**: handler-only copy + handwritten `index.ts`; `sessionIdOf` unit fixtures; fail-closed greps; `install()` vs `installSkills()` split; anatomy-lock assertion on `kilo-plugin/anatomy.ts`; `--agent claude` does not write `.kilo/`.
- **Dogfood**: plugin id `openwolf` loads (`KILO_PURE` unset); write updates anatomy/memory; session start creates `_session.json` (envelope test); idle after activity appends a ledger row. TUI `console.warn` visibility is not a fail. Compact snapshot only if a compact actually happens.
