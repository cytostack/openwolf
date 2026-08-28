# Kilo goal persistence — native design

> **Status**: Implemented in `D:\GitRepo-AI\kilocode\packages\opencode\src\kilocode\goal\`. Critiqued 2026-08-25 ([critic](./critic/goal-persistence.md)).
> **Not this repo**: OpenWolf Phase 1 does not grow a goal row. Stickiness in the plugin remains STATUS.md + session digest until a later phase.

## 是什么 / 不是什么

| Layer | 是什么 | 不是什么 |
|---|---|---|
| Product | One durable objective per Kilo session until genuinely complete | A retry queue, a timer, “please continue” in the prompt |
| Persistence | SQLite row `kilo_goal` keyed by `session_id` | A `goal/change` event log (Kilo’s session log is not the product log) |
| Phase | `active` / `paused` / `blocked` / `complete`, written to the row | Process-local “may auto-continue” |
| Activation | `armed` / `disarmed` in-process; create/resume/admit arm; pause/complete/block/clear/fail disarm | Re-arm on process restart because the row is `active` |
| Round | Idle + completed TurnClose + active + armed + remaining rounds → one continuation that re-injects the full objective | Drive on `error` / `interrupted`; busy-loop; queue of followups |
| Budget | Round cap (`maxRounds`); exhausted → `blocked` with `round-limit` | Codex token/time `BudgetLimited` until Kilo exposes turn usage here |
| OpenWolf | Later consumer of this harness via plugin, not a second store | `.wolf/` goal row in Phase 1 |

## Tree

```
kilo_goal row                         树根
    └── GoalService fold + CAS        主干
            ├── phase                 durable
            ├── activation            process-local armed set
            ├── authority             direct human vs synthetic <goal_round>
            └── round                 evaluateDrive + pending slot
```

Legal pair: `phase=active` and `activation=disarmed` (restore, fail-stop, user interrupt).

## Idle protocol (load-bearing)

`TurnClose` of `SessionPrompt.loop` fires **while** `prompt()` is still awaited. The re-entrancy lock must therefore:

1. Hold `driving` across `prompt()` (serialize duplicate events of the same idle).
2. If `TurnClose` arrives while driving, store **one** pending `{sessionID, reason}` (last reason wins, no queue).
3. After `prompt()` returns, release `driving` and, if pending, call `driveGoal` again with that reason.

`error` / `interrupted` → disarm, do not admit. `superseded` → skip (queued user turn owns the session). `completed` or omitted → evaluate.

## CAS

Every mutation is `{id, revision}` in JS **and** `UPDATE ... WHERE session_id AND id AND revision`. Create-after-complete deletes the completed row in the same transaction, then inserts.

## Authority

- Mutate objective / pause / resume / create: last user message has a non-synthetic text part.
- Complete / blocked from the model: that, **or** a synthetic text part containing `<goal_round>`.
- Human text that quotes the tag is still a human turn.

## Tests prove the loop by state transitions

Drive the store/service against the real DB; drive `evaluateDrive` and the lock without `SessionPrompt`. No live model.
