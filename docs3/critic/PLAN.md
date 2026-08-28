# Critique: `docs3/PLAN.md`

> Against the rewritten design (`kilo-harness-migration.md`) and live OpenWolf sources, 2026-08-25.

## Verdict

The slice is right (thin clone, no hippocampus, no Kilo-repo edits). An implementer following the current checkboxes **in order** can still ship a plugin that loads and then never writes `_session.json`. The holes are procedural, not product.

| Aspect | Assessment |
|---|---|
| Slice / 不是什么 | Correct |
| Event-envelope requirement | Stated, not gated as a fail-closed test |
| Copy step | **Unsafe** — copies the P0 file (`index.ts`) then hopes a later rewrite happens |
| Tests | Mix adapter install, skills, and private `onPath`; weasel on detection |
| Compacting | Named, but hook *shape* omitted (`input.sessionID`, not the event envelope) |
| Verification | 11 mixed unit/live items; item 4 can fail Phase 1 on a TUI visibility issue the design already declared non-blocking |
| Action table | 8 rows hide that 1 and 2 must be the same commit |

---

## P0 — copy-then-rewrite copies the bug

§1.1: “Add `src/templates/kilo-plugin/` as a copy of `src/templates/opencode-plugin/`” then “Rewrite `index.ts`”.

The OpenCode `index.ts` is the file that reads top-level `session_id`/`sessionID` (`src/templates/opencode-plugin/index.ts:18-19`). A copy that lands in git before the rewrite is a working-looking plugin with the silent no-op. If the rewrite is skipped, forgotten, or partially applied (`session.idle` added but id still top-level), unit tests that only check *files exist* go green.

**Fix:** copy handler files only (`session`, `pre-read`, `pre-write`, `post-read`, `post-write`, `stop`, `fs`, `anatomy`, `types`). **Write `index.ts` from scratch.** Do not copy OpenCode `index.ts` at all. Same for the adapter ENTRY string: OpenCode’s ENTRY is `export { OpenWolf }` (`src/agents/opencode.ts:18`) — copying that into Kilo means the loader never sees `default.server`.

---

## P0 — tests never execute `sessionIdOf`

§1.4 greps the installed `index.ts` for `properties.info` / `properties.sessionID`. That is necessary and not sufficient. A comment containing those strings would pass. No test constructs a Kilo-shaped event `{ type, properties: { info: { id } } }` and asserts `handleSessionStart` would see the id.

PLAN says “do not spin up Kilo” — correct. The missing piece is a **pure function test** of `sessionIdOf` (export it from `index.ts`, or put it in a tiny `session-id.ts` next to the handlers). Three fixtures:

| Input | Expected |
|---|---|
| `{ type: "session.created", properties: { info: { id: "ses_1" } } }` | `"ses_1"` |
| `{ type: "session.idle", properties: { sessionID: "ses_1" } }` | `"ses_1"` |
| `{ type: "session.created", sessionID: "ses_1" }` (OpenCode flatten fallback) | `"ses_1"` |
| `{ type: "session.created" }` | `""` |

Without this, the live “session start → `_session.json`” check is the only envelope test, and it is manual.

---

## P1 — `install()` vs `installSkills()` mixed in one assertion

`kiloAdapter.install()` mirrors OpenCode: plugin files + AGENTS.md. It does **not** copy skills. `installSkills` is called by `init.ts` / `update.ts` with the agents list.

§1.4 says `kiloAdapter.install(tmp)` creates `.kilo/command/reframe.md` **after** `installSkills(["kilo"])`. Easy to implement as “install() should write commands” and then duplicate `init`’s skill path inside the adapter.

**Fix:** two tests. `install()` must **not** write `.kilo/command/`. `installSkills(tmp, templatesDir, ["kilo"])` must. Also assert kilo-only skills do not write `.opencode/command/`.

---

## P1 — detection test is a weasel

`onPath` is a private function in `src/agents/index.ts`. PLAN: “if the test harness can stub `onPath`; otherwise skip detection”. That is an un-owned checkbox.

**Fix:** do not test `detectInstalledAgents` in Phase 1. Test `resolveAgents(["kilo"])` returns the kilo adapter once registered. Detection is a one-line `existsSync(homedir/.config/kilo) \|\| onPath("kilo")` next to the OpenCode check — verify by reading source or a comment in the adapter test, not by stubbing PATH.

Do **not** treat a project-local `.kilo/` as installed (leftover config). PLAN currently omits that negative.

---

## P1 — compacting hook shape is wrong if copied from the event handler

`experimental.session.compacting` is a **trigger** hook (`plugin.trigger(name, input, output)`), not an `event` bus payload.

- Input: `{ sessionID: string }` at the top level (`packages/plugin/src/index.ts:305-308`).
- Output: `{ context: string[]; prompt?: string }`.
- Do **not** run `sessionIdOf(event)` here — there is no envelope.

PLAN never says this. An implementer who “adds compacting next to idle in the event handler” will never see it fire.

Snapshot helper belongs in `session.ts` (e.g. `handlePrecompact(directory, sessionId)`), not inlined as a 40-line dump inside `index.ts`. Never assign `output.prompt`. Optional: `output.context.push(...)`.

---

## P1 — `session.created` guard order

OpenCode today:

```ts
if (event.type === "session.created" && !wolfDirExists(directory)) return
const sessionId = ...
if (!sessionId) return
```

PLAN lists `sessionIdOf` but not this guard. Keep it: no `.wolf/` → no session start. `handleStop` / `handleSessionStart` already bail if wolf dir is missing; still match OpenCode so created does not mkdir a brain the user never initialized.

---

## P2 — verification list will fail Phase 1 for the wrong reason

Item 4: “anatomy warning in Kilo logs / plugin `console.warn`”. Design already closed this as non-blocking if the TUI swallows `console.warn`. A live session that writes anatomy + memory but shows no warn would be a **pass** with a noted gap, not a Phase 1 fail.

Items 1–2, 9–11 are install/unit. Items 3, 5–8 are live Kilo. Mix them and “must all pass” blocks merging on a machine without a Kilo GUI session.

**Fix:** split **A. Automated** (merge gate) vs **B. Live Kilo** (dogfood the same day, not a CI gate). Envelope test is B.6; automated grep + `sessionIdOf` unit test is the merge-gate substitute.

Item 8 “if compacting hook shipped” is leftover hedge — Phase 1 **does** ship it. Require `_precompact-snapshot.json` after a compact, or skip B.8 if the session never compacted (cannot force compact in every dogfood).

---

## P2 — other holes

- `templatesDir` in tests must be `path.resolve(import.meta.dirname, "../src/templates")`. `findTemplatesDir` lives in `init.ts`/`update.ts` and is not exported. Unstated, tests will pass a missing dir and the adapter will warn-and-return.
- Throwaway “git repo” is over-specified. `findProjectRoot` accepts `package.json` or `.wolf/` (`src/scanner/project-root.ts`). A temp dir with `package.json` is enough.
- Action row 1 “files exist” is not a verify for the envelope. Row 2 grep is the real gate and must also **reject** `@opencode-ai/plugin`, `export { OpenWolf }`, and `event.session_id || event.sessionID` without `properties`.
- `stop.ts` filename and `handleStop` must remain — the forbidden pattern is a Hooks key `stop:`. Grep for `stop:` will false-positive `handleStop` / `stop.ts` / `stop_count`. Match `^\s*stop:` or `"stop":` in `index.ts` only.
- `--agent` help in `src/cli/index.ts:40` currently lists `codex, opencode, gemini, cursor, all` — add `kilo`. `resolveAgents` error string uses `availableAgents()`, so registry insert is enough for the error path.
- Init always-on Claude (`installedAgents = ["claude"]`) is inherited; kilo-only still writes Claude hooks. Do not “fix” that this slice.
- No step says to add `kilo` to `src/cli/init.ts` comment on line 367 (cosmetic). Not a task.

---

## What to keep

- Phase 1 slice rule and 不是什么 list.
- `session.idle` → `handleStop(directory, sessionId)`; per-turn; no `stop` hook.
- Skip `chat.message` / `bash`.
- Never set compacting `output.prompt`.
- Anatomy-lock source assertion extended to `kilo-plugin/anatomy.ts`.
- No Kilo-repo edits; no `ALWAYS_OVERWRITE` / `HOOK_SETTINGS` changes.
- `openwolf update` needs no new branch.
- Two template dirs.

---

## Required PLAN changes

1. Copy handlers; write `index.ts` from scratch; write adapter ENTRY from scratch.
2. Export `sessionIdOf` (or sibling module) and unit-test Kilo payloads.
3. Split `install()` vs `installSkills()` tests; skip `detectInstalledAgents`.
4. Specify compacting as a trigger hook with `input.sessionID`; helper in `session.ts`.
5. Split verification A (merge) / B (live). Soft-fail TUI warn.
6. Fail-closed greps: no `@opencode-ai/plugin`, no `export { OpenWolf }`, no top-level-only session id read, no `stop` hook key.
