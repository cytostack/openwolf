# Kilo harness adapter — Implementation Plan

> **Status**: Phase 1 implemented. §A merge gate green (103/103). §B live Kilo dogfood remaining.
> **Goal**: `openwolf init --agent kilo` installs an in-process Kilo plugin that maintains the same `.wolf/` files the OpenCode plugin already maintains.
> **Design**: [kilo-harness-migration.md](./kilo-harness-migration.md)
> **Critic**: [critic/PLAN.md](./critic/PLAN.md)
> **Merge gate**: §A automated checks. **Dogfood**: §B live Kilo. Not "Kilo can see `.wolf/` files."

---

## Slice rule

Phase 1 only. Thin OpenCode clone + event-envelope helper + idle + compact snapshot + `multiedit`.

**不是什么** (if you built it, stop):

- `src/runtime/` extract
- hippocampus / claims inside the plugin
- edits under `D:\GitRepo-AI\kilocode\`
- `chat.message` / `bash` post-test
- `kilo.json` `plugin: []` entries
- writes to `.opencode/`, `.kilocode/`, or `~/.config/kilo/plugin/`
- blocking tool calls / mutating `output.args` to deny
- a `stop:` hook key
- assigning compacting `output.prompt`
- copying OpenCode `index.ts` or OpenCode's `export { OpenWolf }` entry

---

## Phase 1 — Adapter + thin plugin

**Target**: 1 coding session + 1 live Kilo dogfood in a throwaway project.
**Merge when**: §A green. Do not block merge on §B.4 (TUI warn visibility).

### 1.1 Templates — copy handlers, write `index.ts`

Do **not** `cp -r opencode-plugin kilo-plugin`. That copies the P0 bug.

- [x] Create `src/templates/kilo-plugin/`.
- [x] Copy **only** these files from `src/templates/opencode-plugin/`, byte-identical:

  `session.ts`, `pre-read.ts`, `pre-write.ts`, `post-read.ts`, `post-write.ts`, `stop.ts`, `fs.ts`, `anatomy.ts`, `types.ts`

- [x] Add `handlePrecompact(directory, sessionId)` to `session.ts` (filesystem only): read `.wolf/hooks/_session.json` if present, write `.wolf/hooks/_precompact-snapshot.json` as `{ at, trigger: "compacting", session }`. Same intent as `src/hooks/precompact.ts`. Do not import `src/hooks/*`. Snapshot is faithful to disk — do **not** inject `session_id` when `_session.json` is missing (`session` stays `{}`), matching `src/hooks/precompact.ts`.
- [x] **Write** `src/templates/kilo-plugin/index.ts` from scratch (do not copy OpenCode `index.ts`):

  - `import type { Plugin } from "@kilocode/plugin"` (type-only; no value import)
  - `export function sessionIdOf(event: { type: string; properties?: Record<string, unknown> } & Record<string, unknown>): string` as in the design ( `properties.info.id` → `properties.sessionID` → top-level fallbacks → `""` )
  - `export const server: Plugin = async ({ directory }) => { ... }` so the installed entry can `import { server } from "./openwolf/index.js"`
  - do **not** `export { OpenWolf }`
  - do **not** default-export from this file (the top-level `.kilo/plugin/openwolf.ts` is the default-export)

- [x] Event handler body:

  ```ts
  event: async ({ event }) => {
    if (event.type === "session.created" && !wolfDirExists(directory)) return
    const sessionId = sessionIdOf(event as { type: string; properties?: Record<string, unknown> })
    if (!sessionId) return
    if (event.type === "session.created") handleSessionStart(directory, sessionId)
    if (event.type === "session.deleted") deleteSession(sessionId)
    if (event.type === "session.idle") handleStop(directory, sessionId)
  }
  ```

- [x] Compacting is a **trigger** hook, not an event. `input.sessionID` is top-level. Do **not** run `sessionIdOf` here:

  ```ts
  "experimental.session.compacting": async (input, output) => {
    if (!wolfDirExists(directory)) return
    handlePrecompact(directory, input.sessionID)
    // never: output.prompt = ...
  }
  ```

- [x] `tool.execute.before` / `after`: keep `read` / `write` / `edit`; add `multiedit` next to `edit`. Do **not** add `bash`. Keep snake+camel arg names.
- [x] Keep `experimental.chat.system.transform` injecting `OPENWOLF.md`.
- [x] Warn never block. Do not mutate `output.args` to deny tools.
- [x] No `chat.message`. No `stop` field on the returned hooks object.

### 1.2 Adapter

- [x] Add `src/agents/kilo.ts` mirroring `src/agents/opencode.ts` **except** the ENTRY string and dest path:

  - `name: "kilo"`, `displayName: "Kilo"`
  - copy `src/templates/kilo-plugin/*.ts` → `<project>/.kilo/plugin/openwolf/`
  - write `<project>/.kilo/plugin/openwolf.ts` with this ENTRY (do **not** reuse OpenCode's `export { OpenWolf }`):

    ```ts
    // OpenWolf plugin entry — installed by `openwolf init --agent kilo`.
    import { server } from "./openwolf/index.js"
    export default { id: "openwolf", server }
    ```

  - `upsertMarkerBlock(AGENTS.md, readSnippet(...))`
  - if `kilo-plugin` templates missing: warning, write nothing else

- [x] Register in `src/agents/index.ts` `ADAPTERS`.
- [x] `detectInstalledAgents()`: `fs.existsSync(path.join(os.homedir(), ".config", "kilo")) || onPath("kilo")`. Do **not** treat a project-local `.kilo/` as installed.
- [x] `src/cli/index.ts` `--agent` help: add `kilo` to the list. `resolveAgents` error string follows `availableAgents()` automatically.

`install()` does **not** copy skills. `init` / `update` already call `installSkills`.

### 1.3 Skills

- [x] In `src/agents/skills.ts`, if `agents.includes("kilo")`, also copy to `.kilo/command/`.
- [x] Do not write `.opencode/command/` for kilo-only installs.

### 1.4 Tests

Do not spin up Kilo. `templatesDir` = `path.resolve(import.meta.dirname, "../src/templates")`.

- [x] `tests/kilo-adapter.test.ts`:

  **`sessionIdOf`** (exported from `index.ts`; the test imports the template by copying it to a temp dir and rewriting `./x.js` → `./x.ts` specifiers — Node cannot resolve the template's internal ESM specifiers to `.ts`):

  | payload | expected |
  |---|---|
  | `{ type: "session.created", properties: { info: { id: "ses_1" } } }` | `"ses_1"` |
  | `{ type: "session.idle", properties: { sessionID: "ses_1" } }` | `"ses_1"` |
  | `{ type: "session.created", sessionID: "ses_1" }` | `"ses_1"` |
  | `{ type: "session.created" }` | `""` |

  Plus fallback/precedence extras: top-level `session_id`, `info.id` wins over `properties.sessionID` and top-level, empty `info.id` falls through, non-object `info` falls through.

  **`handlePrecompact`** (imported from the same temp copy): no-op when `.wolf/` missing; snapshots an existing `_session.json` as `{ at, trigger: "compacting", session }`; writes `session: {}` when `_session.json` is missing (no `session_id` injection).

  **`kiloAdapter.install({ projectRoot: tmp, wolfDir, templatesDir })`**:

  - creates `.kilo/plugin/openwolf.ts` and `.kilo/plugin/openwolf/{index,session,...}.ts`
  - does **not** create `.kilo/command/`
  - `AGENTS.md` contains `<!-- openwolf:begin -->`; second `install()` does not duplicate the block
  - installed `openwolf.ts` matches `/export default/` and `/id: "openwolf"/` and does **not** match `/export \{ OpenWolf \}/`
  - installed `index.ts` fail-closed greps (whole file):

    | must match | must not match |
    |---|---|
    | `import type` + `@kilocode/plugin` | `@opencode-ai/plugin` |
    | `export const server` | `export { OpenWolf }` |
    | `session.idle` | `chat.message` |
    | `properties.info` and `properties.sessionID` | `bash` as a tool branch |
    | `experimental.session.compacting` | `output.prompt` assignment |
    | | a hooks key `stop:` (`/^\s*stop\s*:/` in `index.ts` only — `handleStop` / `stop.ts` / `stop_count` are allowed) |

  **`installSkills(tmp, templatesDir, ["kilo"])`**:

  - writes `.kilo/command/reframe.md` and `security-audit.md`
  - does **not** write `.opencode/command/`

  **Registry** (no PATH stub):

  - `resolveAgents(["kilo"])` returns one adapter named `kilo`
  - `resolveAgents(["claude"])` returns `[]` (claude is always-on, skipped by resolve)
  - unknown-agent error string includes `kilo` after registry insert
  - do **not** test `detectInstalledAgents` (`onPath` is private)

- [x] In `tests/anatomy-lock.test.ts`, duplicate the OpenCode lock-protocol assertion for `src/templates/kilo-plugin/anatomy.ts`.
- [x] Optional one-liner: `resolveAgents` with a fixture `config.openwolf.agents = ["kilo"]` — documents that `update.ts` 5c needs no new branch. Skip if it duplicates the registry test.

### 1.5 Docs / CLI copy

- [x] `README.md`, `docs/commands.md`, `docs/getting-started.md`, `docs/hooks.md`: mention Kilo next to OpenCode.
- [x] `CHANGELOG.md` entry.
- [x] Help text in `src/cli/index.ts` (already in 1.2).

---

## Phase 1 verification

Throwaway project, **not** this source tree (`init` skips registering a project named `openwolf`). Temp dir needs a `package.json` or `.wolf/` so `findProjectRoot` stops there; git is optional.

### A. Automated (merge gate)

```bash
pnpm build
pnpm test
```

Then in a temp dir (or via the adapter unit test, which is the same assertion):

1. `kiloAdapter.install` + `installSkills(..., ["kilo"])` write the footprint in the design (plugin entry + handlers + AGENTS.md marker + `.kilo/command/*.md`).
2. Re-install is idempotent (one AGENTS.md block).
3. Fail-closed greps in §1.4 pass (envelope helper present; no OpenCode entry; no `stop:` hook; no `output.prompt` assign).
4. `sessionIdOf` fixtures in §1.4 pass.
5. `openwolf init --agent claude` in another temp dir does **not** write `.kilo/`.
6. Existing Claude/Codex/OpenCode tests still pass; anatomy-lock assertion covers `kilo-plugin/anatomy.ts`.

CLI smoke (same temp dir, after `pnpm build`):

```bash
node dist/bin/openwolf.js init --agent kilo
```

### B. Live Kilo (dogfood; same day; not CI)

Do not set `KILO_PURE=1`.

1. Starting Kilo in the temp repo loads plugin id `openwolf`.
2. Write a project file → `anatomy-index.json` / `anatomy.md` update + `memory.md` append.
3. Session start → `.wolf/hooks/_session.json` created. **Envelope test.** If missing, `sessionIdOf` was not used (OpenCode top-level id was copied).
4. Read a file already in anatomy → anatomy warning **or** note “warn channel invisible” and still pass B. (Design: TUI visibility is not a Phase 1 fail.)
5. Session idle after activity → `token-ledger.json` updated (per-turn; a second idle with more activity appends another row).
6. If a compact happens: no throw, `_precompact-snapshot.json` appears. If the session never compacted, skip — do not fail Phase 1.

---

## Phase 2 — Hook-gap hardening (after Phase 1 dogfood)

Only if Phase 1 is in use and a gap hurts.

- [ ] Port `user-prompt.ts` extras onto `chat.message` (hippocampus, or a filesystem-only subset if one appears).
- [ ] Port `post-test.ts` onto `tool.execute.after` for `bash`.
- [ ] Measured token usage from idle / message events if the payload exposes it. Fail open if not.
- [ ] Confirm `multiedit` / `bash` tool ids against a live Kilo session.
- [ ] `session.status` (`status.type === "idle"`) backup if `session.idle` is removed; `session.compacted` backup if compacting does not fire.
- [ ] Visible warn channel if `console.warn` is invisible in Kilo TUI.
- [ ] `directory` vs `worktree` for Agent Manager children; per-session `_session.json`.

---

## Phase 3 — Shared runtime (do not start)

Extract `src/runtime/` so Claude subprocesses and in-process plugins call the same handlers. Trigger: OpenCode **and** Kilo both need hippocampus/claims parity. Until then, two thin copies are cheaper than a third abstraction.

---

## Action items (execution order)

| # | Item | Files | Verify |
|---|---|---|---|
| 1 | Copy **handlers only** into `src/templates/kilo-plugin/` | nine files listed in 1.1 | done |
| 2 | Write `index.ts` + `handlePrecompact` | `kilo-plugin/index.ts`, `session.ts` | done — greps + `sessionIdOf` fixtures |
| 3 | `src/agents/kilo.ts` + ENTRY | `src/agents/kilo.ts` | done — `export default`, not `export { OpenWolf }` |
| 4 | Registry + detect + CLI help | `src/agents/index.ts`, `src/cli/index.ts` | done |
| 5 | Skills destination | `src/agents/skills.ts` | done |
| 6 | Adapter + lock tests | `tests/kilo-adapter.test.ts`, `tests/anatomy-lock.test.ts` | done — `pnpm test` 103/103 |
| 7 | Docs + changelog | `README.md`, `docs/*`, `CHANGELOG.md` | done |
| 8 | §A CLI smoke in a temp dir | temp dir + `node dist/bin/openwolf.js init --agent kilo` | done — footprint + claude-only negative |
| 9 | §B live Kilo session | temp repo + this machine's Kilo | remaining |

Do **not** edit `D:\GitRepo-AI\kilocode\` for this slice.

Do **not** add kilo to `ALWAYS_OVERWRITE` / Claude `HOOK_SETTINGS`.

Do **not** implement a goal/idle-self-start subsystem.

Do **not** copy OpenCode `index.ts` or OpenCode ENTRY.

Do **not** add `chat.message` or `bash` handlers this slice.

---

## Closed decisions

- Source of truth remains `.wolf/`. One brain, many adapters.
- First ship is OpenCode-plugin fidelity, not Claude-hook fidelity.
- Plugin v1 hooks, not v2 transforms.
- Project-local `.kilo/plugin/` only; directory auto-load, no `kilo.json` patch.
- Warn never block.
- `openwolf update` reuses existing adapter replay.
- Two template dirs. Copy handlers; write `index.ts` from scratch.
- Event session id is `sessionIdOf` (`properties.info.id` / `properties.sessionID` + fallbacks).
- Compacting is a trigger hook (`input.sessionID`); never set `output.prompt`.
- Skip `chat.message` and `bash` post-test in Phase 1 (hippocampus-only).
- `session.idle` wrap-up is per-turn; multiple ledger rows per session are expected.
- Do not test `detectInstalledAgents` this slice (`onPath` is private).
- TUI `console.warn` visibility is not a merge gate.
- `sessionIdOf` is exported from `index.ts`; the test imports the template via a temp copy with `.js` → `.ts` specifier rewrite (no sibling `session-id.ts` needed).
- Compacting snapshot is faithful to disk: `session: {}` when `_session.json` is missing, no `session_id` injection.

## Open decisions (do not block Phase 1)

- Whether `console.warn` is visible in Kilo logs/TUI (note it in §B.4).
- Publishing an npm plugin later. Local files first.
- `session.status` idle backup (Phase 2).
