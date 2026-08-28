# Critique: Kilo goal persistence

> Against live `D:\GitRepo-AI\kilocode\packages\opencode\src\kilocode\goal\` plus `goal-persistence` and `goal-design-principles`, 2026-08-25.
> OpenWolf Phase 1 (`docs3/PLAN.md`) stays out of this: no goal loop in the plugin.

## Verdict

The module is the right *shape* (one Goal service, SQLite row keyed by session, process-local `armed`, idle drive, anti-drift prompt, branded `GoalId`, CAS on `{id, revision}` in JS). It is **not** a working multi-round idle loop. A Phase-1 dogfood of “create a goal and walk away” will run **one** autonomous continuation, then stop, while looking healthy in unit tests.

| Aspect | Assessment |
|---|---|
| Seam (one service, consumers) | Correct |
| Persistence choice (row store, not event-sourced) | Correct for Kilo (session log is not the product log) |
| Phase vs activation split | Correct — `armed` is process-local; restore/fork stay disarmed |
| Anti-drift prompt | Present |
| Idle self-start | **Fail closed** — re-entrancy lock spans the model turn |
| SQL CAS | JS check only; UPDATE keys `session_id` alone |
| Create-after-complete | **Broken** — INSERT hits PRIMARY KEY |
| Authority | Mostly right; `<goal_round>` is spoofable without `synthetic` |
| Blocked audit | Floor on `roundsStarted`, not “same condition N times” |
| Token/time accounting | Absent (round cap is the budget analog — acceptable this slice) |
| Tests | Service happy-path only; no driver / authority / create-after-complete |

---

## P0 — `driving` spans `prompt()`, so the loop dies after one round

`driveGoal` (`driver.ts:18-67`):

```ts
if (driving.has(sessionID)) return
driving.add(sessionID)
try {
  // idle check, admitRound, then:
  await AppRuntime.runPromise(svc.prompt({ ... }))
} finally {
  driving.delete(sessionID)
}
```

Bootstrap subscribes to `KiloSession.Event.TurnClose` and calls `driveGoal`.

`SessionPrompt.loop` publishes `TurnClose` in `Effect.onExit` of `ensureRunning` (`session/prompt.ts` ~1916). That fires **while** `prompt()` is still awaited, **before** `driving.delete`.

Sequence:

1. Human turn closes (`reason: "completed"`) → `driveGoal` admits round 1 and awaits `prompt()`.
2. Goal turn finishes → `TurnClose` → `driveGoal` sees `driving.has` → **return**.
3. `prompt()` resolves → `driving.delete`.
4. No further event → **armed + active + idle, and stuck.**

The comment “exactly one continuation per idle” was implemented as “exactly one continuation ever after the human turn.” The skill means: at most one in flight; when that turn goes idle again, start the next.

Existing tests never call `driveGoal`, so 95/95 OpenWolf and the current `goal.test.ts` stay green.

**Fix:** keep `driving` across `prompt()` (it still serializes duplicate events of the *same* idle). When `TurnClose` arrives while driving, record `{sessionID, reason}` as a single pending slot (no queue). After `prompt()` returns and `driving` is released, if pending, call `driveGoal` again with that reason. Filter `error` / `interrupted` to disarm-and-stop; `superseded` skips without disarm (queued user turn owns the session).

---

## P0 — `create` after `complete` cannot insert

`store.create` allows replacing a completed goal, then `INSERT`s a new row. `session_id` is `PRIMARY KEY`. The completed row is still there. SQLite unique-constraint error.

No test covers create-after-complete. The service test completes and stops.

**Fix:** `DELETE` the completed row in the same transaction, then `INSERT`. Do not `INSERT OR REPLACE` without an explicit delete — a replace on the wrong schema revision is harder to read in the log.

---

## P0 — `TurnClose` reason is ignored

`driveGoal(sessionID)` does not receive `evt.properties.reason`. An `interrupted` or `error` close still admits a round if the session is idle and armed. User-stop then auto-continues. Fail-stop is only the `catch` around `prompt()`, which interrupt may not throw (`onInterrupt` can resolve).

**Fix:** pass `reason` from bootstrap. `error` / `interrupted` → `GoalService.disarm`, no admit. `superseded` → skip. `completed` (or omitted, back-compat) → evaluate.

---

## P1 — UPDATE is not SQL CAS

`mutate` checks `{id, revision}` in JS, then:

```sql
UPDATE kilo_goal SET ... WHERE session_id = ${sessionID}
```

No `id`, no `revision` in `WHERE`. SQLite immediate transactions serialize one writer, so this is safe *today* on a single connection. It is not the CAS the design checklist asked for, and it will not stay safe if a second writer or a skipped JS check appears.

**Fix:** `WHERE session_id = ? AND id = ? AND revision = ?`, then `SELECT` and throw if `revision` did not advance.

---

## P1 — `edit` can set `maxRounds` below `roundsStarted`

`resume` / `admitRound` / `blockRoundLimit` all assume `maxRounds >= roundsStarted`. `edit` only `normalizeMaxRounds` (positive integer). After 4 admitted rounds, `maxRounds: 1` leaves an active goal that can never admit and will trip `blockRoundLimit` on the next idle — surprising vs a hard reject at edit.

**Fix:** reject `maxRounds < roundsStarted`.

---

## P1 — `goalRound()` is a substring

```ts
part.type === "text" && part.text.includes("<goal_round>")
```

A human (or injected) message containing the tag is treated as the autonomous channel. `complete` / `blocked` then skip `directHuman`.

**Fix:** require `synthetic === true` **and** the tag. Human text that quotes the tag remains a human turn (`directHuman` already treats non-synthetic text as human).

---

## P1 — config swallows illegal env

`positiveInt("0", 256)` returns `256`. `KILO_GOAL_MAX_ROUNDS=0` looks set and is ignored. Design checklist: tunables throw at load.

**Fix:** if the env var is *present* and not a positive safe integer, throw. Unset → default.

---

## P1 — blocked audit is a round floor, not same-condition streak

`blockedAfterConsecutiveRounds` (default 3) is compared to `roundsStarted`. That is “must have started N rounds,” not “the same blocking condition recurred N times.” Schema has no last-block code / streak. Do **not** add columns this slice — OpenWolf integration is not the place to grow the row. Keep the floor; name it honestly in the prompt/tool error. Same-condition streak is a follow-up with a migration.

---

## P2 — other holes

- `CREATE TABLE IF NOT EXISTS kilo_goal` is duplicated in `get` and `create`. Extract one helper.
- `JSON.parse(row.blocked_reason)` is unvalidated; a corrupt payload throws inside `get`. Run `normalizeBlockReason`.
- `GoalService.arm` is public and unused by the driver (create/resume/admit already arm). Leave it; tests use `isArmed`.
- No token delta / wall-clock / `BudgetLimited` / `UsageLimited`. Round cap is the budget. Do not invent Codex token accounting until something in Kilo exposes turn usage to this module.
- No teardown on process exit (admit in-flight, cancel, await quiescence). Inherited; not this slice.
- `driveGoal` is untested because it imports `SessionPrompt`. Extract `evaluateDrive` + the driving/pending protocol as pure functions and test those. Do not mock the session loop.

---

## What to keep

- Row store keyed by `session_id`. Do not add a `goal/change` log in Kilo.
- `armed` process-local. Do **not** re-arm on process restart because the row is `active` (Codex resume). That is the DSH cut: phase durable, activation not. A restored session must `/goal resume` or a human `update_goal action=resume`.
- Four consumers: store/service, tools, `/goal` command, round driver.
- `complete` is terminal; `paused` cannot `block`.
- Prompt re-injects the full objective every round.
- OpenWolf plugin does **not** grow a goal row. Stickiness there remains STATUS.md + session digest until a later phase.

---

## Required changes (this slice, kilocode only)

1. Pending-slot re-entry so a `TurnClose` during `prompt()` schedules the next drive with its reason.
2. Pass `TurnClose.reason` into `driveGoal`.
3. Delete-then-insert on create-after-complete.
4. SQL `WHERE` includes `id` and `revision`; verify after UPDATE.
5. Reject `maxRounds < roundsStarted`.
6. `synthetic && <goal_round>` for the autonomous channel.
7. Config throws on illegal env.
8. Extract `evaluateDrive` + drive-lock helpers; unit-test them plus the store/service gaps above.

Do **not** edit OpenWolf `src/templates/kilo-plugin/` for this.
