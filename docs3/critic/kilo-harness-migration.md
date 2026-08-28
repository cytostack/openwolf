# Critique: `docs3/kilo-harness-migration.md`

> Against live OpenWolf + Kilo sources, 2026-08-25. The improved design absorbs these findings.

## Verdict

The original design is **right about the product** (one `.wolf/` brain, in-process plugin, clone the thin OpenCode adapter, no Claude subprocesses, no `src/runtime/` yet) and **wrong about the load-bearing event contract**. A Phase 1 clone that only changes path / types / `export default` / `session.idle` would install, load, and then silently do nothing on session start, session delete, and stop/idle.

| Aspect | Assessment |
|---|---|
| Product / layering | Correct |
| Install layout / glob / module shape | Correct, evidenced |
| Hook *names* | Mostly correct |
| Hook *payloads* | **Fail closed** — not specified |
| Thin-plugin fidelity description | Understated (lock/store already exist) vs overstated (lists hippocampus-only gaps as Phase 1 targets) |
| PLAN.md alignment | Diverges on `chat.message` / `bash` |

---

## P0 — silent no-op if OpenCode `index.ts` is copied

Kilo does **not** put `sessionID` on the event object. Plugin `event` hooks receive:

```ts
{ event: { id, type, properties: event.data } }
```

(`packages/opencode/src/plugin/index.ts:267`)

| Event | Real payload | OpenCode plugin reads |
|---|---|---|
| `session.created` / `session.deleted` | `properties.info.id` (`sdk/js/src/gen/types.gen.ts:562-580`) | `(event as any).session_id \|\| (event as any).sessionID` then `if (!sessionId) return` (`src/templates/opencode-plugin/index.ts:18-19`) |
| `session.idle` | `properties.sessionID` (`types.gen.ts:475-479`) | same top-level read |

Copying the OpenCode handler into Kilo → every session event returns immediately. Anatomy/pre-read/post-write can still run (tool hooks pass `input.sessionID` at the top level). The “stop → session.idle” delta is then a comment, not a behavior.

This is the fifth delta. It is more important than the types package.

---

## P1 — `session.idle` is turn-idle, not session-end

- `Hooks` has no `stop` field (`packages/plugin/src/index.ts:222-335`). Mapping to `event: session.idle` is the right *name*.
- Schema marks `session.idle` **deprecated** in favor of `session.status` (`packages/schema/src/session-status-event.ts:52-58`), but `SessionStatus.set` still publishes Idle when status becomes idle (`packages/opencode/src/session/status.ts:42-44`).
- Idle fires **per assistant turn**, same cadence as Claude `Stop` / OpenCode `stop`. The original design’s “token ledger / wrap-up” wording reads like process-exit. It is not.
- `handleStop` is not session-idempotent: each call with activity **appends** a `token-ledger.json` row and a `memory.md` line. That matches Claude `stop.js`. Multiple rows per Kilo session are expected. Do not “fix” this into one row per `session.deleted`.

Prefer `session.idle` for Phase 1 (payload is `{ sessionID }`). `session.status` with `status.type === "idle"` is a Phase 2 backup, not a replacement this slice.

---

## P1 — hippocampus-only gaps listed as Phase 1 targets

| Gap | Claude does | Thin plugin can do in-process | Phase |
|---|---|---|---|
| `UserPromptSubmit` / `chat.message` | `user-prompt.ts` writes a hippocampus *penalty* event | nothing filesystem-only | **2** |
| `post-test.js` / `bash` after | hippocampus penalty from test failures | nothing without hippocampus | **2** |
| `PreCompact` | snapshot `_session.json` | same snapshot; must **not** set `output.prompt` (that *replaces* Kilo’s compaction prompt, `session/compaction.ts:377-382`) | **1** (snapshot only) |

The original hook table put `chat.message` and `bash` in the Kilo target column. PLAN.md already hedges (“TODO rather than invent”). Close it: skip both in Phase 1.

---

## P2 — incomplete “four deltas”

Missing from the original list, all evidenced:

1. **Event envelope** (P0).
2. `session.idle` deprecated-but-published; `session.status` is the current sibling.
3. PluginInput has `directory` **and** `worktree`. Agent Manager child sessions can have `.wolf/` only at the worktree root. OpenCode plugin keys off `directory`. Inherited limitation.
4. `KILO_PURE=1` skips all external plugins (`kilo-docs/.../plugins.md:110-113`). Directory auto-load is not enough if the user debugs with PURE.
5. `@kilocode/plugin` must be `import type` — it is a type package; a value import can fail before Kilo writes `.kilo/package.json`.
6. Plugin glob is **non-recursive** `{plugin,plugins}/*.{ts,js}`; command glob **is** recursive `{command,commands}/**/*.md`. Skills at `.kilo/command/reframe.md` are fine.
7. Detection via `~/.config/kilo` or `kilo` on PATH misses **VS Code-only** Kilo users and must **not** treat a project `.kilo/` as “Kilo is installed” (false positive on leftover config).

---

## P2 — thin plugin is not “anatomy.md parse + console.warn”

`src/templates/opencode-plugin/` already has: anatomy lock + `anatomy-index.json` store, `extractDescription`, `_session.json`, `memory.md` headers, cerebrum Do-Not-Repeat, buglog heuristic, token-ledger. What it lacks vs Claude: hippocampus, claims, session digest injection, measured transcript usage, user-correction events, test-failure events.

Phase 1 fidelity bar = **today’s OpenCode plugin + working session id + idle + compact snapshot**. Not Claude parity.

---

## P2 — other holes

- “7 lifecycle behaviors” is never enumerated; the hook table has 11 rows. Drop the number.
- `handleSessionStart` overwrites a single `.wolf/hooks/_session.json`. Kilo Agent Manager child sessions will clobber the parent. Inherited from OpenCode; document, don’t fix this slice.
- `console.warn` from tool hooks may not surface in Kilo TUI. Phase 1 verification must check a human-visible channel; if none, the thin plugin is silent.
- Compacting hook can inject `output.context` (safe) or replace `output.prompt` (unsafe). Snapshot on disk; optional short digest in `context`; never set `prompt`.
- Skill frontmatter `argument-hint` is not in Kilo’s command schema (`packages/core/src/v1/config/command.ts`). Ignored. `$ARGUMENTS` works (`session/prompt.ts:2353`).
- `openwolf update` replaying adapters is correct (`src/cli/update.ts` step 5c) **only after** `"kilo"` is in `config.openwolf.agents`. First-time dogfood of this *source* repo will not run it: init skips registering a project named `openwolf`.

---

## What to keep

- One brain in `.wolf/`. Plugin is activation, not a second store.
- Clone OpenCode templates; do not copy `src/hooks/*.ts`.
- Default export `{ id: "openwolf", server }`; no `export { OpenWolf }`.
- Project-local `.kilo/plugin/` only; no `kilo.json` `plugin: []`; no `.opencode/` / `.kilocode/` writes.
- Warn never block; do not mutate `output.args` to deny tools.
- No `src/runtime/` extract this slice.
- `--agent claude` skips extras; `--agent kilo` still always-on Claude (init.ts:376).
- Anatomy lock protocol must stay identical to the OpenCode template (test already asserts OpenCode; extend to kilo-plugin).
