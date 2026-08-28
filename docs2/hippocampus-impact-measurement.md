# Hippocampus impact measurement

> **Status**: Implemented — recurrence counter (slice 1) + real outcome detectors (user corrections, test failures) replace the noisy edit-count heuristic; A/B harness pending
> **Parent**: [00-hippocampus-memory-system.md](./00-hippocampus-memory-system.md)
> **Goal**: Define how to measure whether hippocampus makes OpenWolf "better," instead of only proving the memory system is healthy.

## 1. Why measurement today stops short of "better"

The repo already measures a lot, but every existing number is a *process* metric, not an *outcome* metric:

| Existing signal | What it proves | What it cannot prove |
| --- | --- | --- |
| `repeated_reads_blocked`, `anatomy_hits/misses` (`token-ledger.json`) | The anatomy / repeated-read machinery fires | That saved tokens changed the result |
| Measured usage from harness transcripts (`readTranscriptUsage`, `src/hooks/shared.ts`) | Real API cost per session | Which cost is attributable to memory |
| Event valence counts, consolidation, decay, drift repair | The brain stores and retrieves | That the agent behaved better |
| Recall `confidence` scores (`src/hippocampus/cue-recall.ts`) | Ranked relevance at retrieval time | Whether the agent acted on the injection |

The missing pieces are **outcome attribution** and **a control arm**. Everything below is designed so a change is only called an improvement when it moves a downstream outcome, not when it merely fires a hook.

## 2. Metric hierarchy

### 2.1 Primary: recurrence rate (the "it learns" signal)

A recurrence is a new negative event for a path and error signature where a matching past trauma/penalty already existed. Today `post-write` already:

- recalls past learnings before appending the current write (`src/hooks/post-write.ts:224`), and
- flags `is_recurring: editCount >= 3` per session.

Neither is a durable signal. The durable one is: at event-creation time, compare the current write against existing trauma/penalty events for the same canonical path and a normalized error signature. If a match exists and the current write is itself a negative outcome, increment a durable recurrence counter instead of relying on the per-session edit count.

Formula: `recurrence_rate = recurrences / negative_writes` where negative writes are events whose valence is `penalty` or `trauma`. A declining trend over sessions is the primary claim that the brain is learning.

### 2.2 Secondary: correction rate (the ground-truth signal)

The schema already has `correct`/`reject` action types and a `user_correction` field, but nothing produces those events automatically. Per `docs2/truth-maintenance.md:110`, automatic producers were deferred pending deterministic event-generation contracts and dogfood measurements. This design proposes the minimal contract:

- A `correct` event is created when a session ends and the user rejected or corrected an agent edit, keyed to the affected path.
- A session-level count is stored in `token-ledger.json` as `corrections`.
- The measurable claim is: corrections per task stay flat or fall as memory accumulates, controlling for task difficulty (below).

### 2.2a Implemented outcome detectors (2026-08)

The edit-count heuristic (`editCount >= 3` => trauma) was retired: on dogfood data it produced 51 fake "File edited N times" traumas and zero real signal. Negative valence now comes only from:

- **`src/hooks/user-prompt.ts`** (Claude Code `UserPromptSubmit`): reads the user prompt, runs `detectCorrection` (`src/hooks/shared.ts`), and writes a `penalty` event (`action.type: "correct"`) with the affected path when the user explicitly corrects the agent. Conservative: requires a correction verb *and* a target (path with known extension, or backtick/quoted identifier).
- **`src/hooks/post-test.ts`** (Claude `PostToolUse` + Codex `PostToolUse` for Bash/execute): runs `extractTestFailures` on the tool output and writes a `penalty` event (`action.type: "execute"`, `subtype: "test-failure"`) when tests fail. Passing output produces nothing.

Both are wired into `HOOK_SETTINGS` in `src/cli/init.ts` and `buildCodexHooks` in `src/agents/codex.ts`. OpenCode's plugin has no `UserPromptSubmit` event, so only the test hook applies there.

`post-write` still records every write as `neutral` (so the denominator of edits is preserved), and `recordRecurrence()` now fires on any fix-shaped edit (removed-code signature) that matches a past trauma/penalty for the same path — no edit-count gate.

Tests: `tests/hippocampus-outcomes.test.ts` (10 cases) covers detector precision and both hooks' event persistence.

Cross-repo aggregation: openwolf survey [paths...] (src/cli/survey.ts) reads .wolf/ from any repos (or the global registry when no paths are given) and prints a comparable table: hook version, sessions, reads, blocked re-reads, event counts, recurrence rate, and buglog count. It derives negative writes from the buffer for legacy stores missing the new stats fields, so pre-upgrade repos still count. Tests: 	ests/survey.test.ts.
### 2.3 Cost axis: measured, not estimated

Token numbers in the report are estimated (char-ratio) plus measured (transcript). Only measured numbers belong in an improvement claim. The hippocampus-specific slice is: tokens spent after a recall injection for the same path vs. tokens spent without one. Because the harness and `token-ledger.json` already capture measured usage, this is the least speculative part of the design.

### 2.4 Guardrail: injection precision

Every pre-write / pre-read recall injection should be counted. Two numbers matter:

- `injections` 鈥?number of times hippocampus surfaced a past learning.
- `follow-through` 鈥?number of times the agent avoided a repeated edit or a correction followed.

If precision is low (most injections ignored), hippocampus is a token tax, not a benefit. This is the counterweight to the primary metric, and it prevents gaming by simply injecting more memory.

### 2.5 Subtle metric: learning-curve slope

Plot per-session measured cost (tokens and correction count) against cumulative event count. If the brain works, cost per task *decreases* as events accumulate, holding task difficulty constant. A flat slope means hippocampus is storage, not learning. This is the metric that makes the case without needing a control group, though the control group is the rigorous version.

## 3. Recurrence-counter instrumentation (implementation sketch)

### 3.1 Storage

Extend `HippocampusStore.stats` (currently in `src/hippocampus/types.ts` and created in `src/hippocampus/event-store.ts`) with:

```ts
recurrences: number;        // durable count of repeated negative outcomes
negative_writes: number;    // denominator
```

And keep a `signature -> event_id` map on the cue index so the match is O(1) instead of a full scan.

### 3.2 Event creation

In `src/hooks/post-write.ts`, before `hippocampus.addEvent(...)`:

```ts
const signature = normalizeErrorSignature(relFile, newStr, oldStr);
const past = hippocampus.recall({
  cue: { type: "location", path: relFile, match_mode: "parent" },
  filters: { valence: ["trauma", "penalty"], min_intensity: 0.5 },
  limit: 3,
});
const isRecurrence =
  past.events.length > 0 &&
  signature !== null &&
  (valence === "trauma" || valence === "penalty");
if (isRecurrence) hippocampus.incrementRecurrence(signature);
```

`normalizeErrorSignature` extracts a stable key from the edit: for a fix-shaped edit (removing a catch, changing an error message), use the old error string; otherwise `null`. This deliberately avoids counting every re-edit of a file as a recurrence.

### 3.3 Report

Extend `openwolf report` (`src/cli/report.ts`) with a new section:

```text
Hippocampus learning
  Recurrences / negative writes:  3 / 12  (25%)
  Trend (last 5 sessions):        [4, 3, 2, 1, 1]  -> improving
  Recall injections / follow-through: 10 / 4 (40%)
```

The trend is computed from per-session deltas already present in the ledger.

## 4. A/B harness design (the rigorous version)

### 4.1 Task corpus

A benchmark set of small, self-contained coding tasks, each with an intentional trap: a known mistake that the project's own memory should prevent (e.g., "use `cfg.talk`, not `cfg.tts`", "tests live in `__tests__/`, not `test/`"). Tasks must be automatable and have a deterministic success check (a test that passes or fails, or a diff that must match).

### 4.2 Arms and control

- **Arm A**: fresh `.wolf/` with a pre-seeded hippocampus containing the trap learnings.
- **Arm B**: fresh `.wolf/` with hippocampus disabled (hooks installed but recall suppressed).
- Both arms run the same tasks in the same order, in a fresh checkout, with the same model and agent harness.

The counterfactual is the key property: Arm B is the "what if the brain were not there" baseline, which is exactly what a single-arm dogfood session cannot provide.

### 4.3 Measurements

Per task, per arm:

- Measured tokens (input, output, cache-read) from the transcript.
- Time to completion and number of turns.
- Task success (deterministic check).
- Correction count (user-correction events).
- For Arm A only: injections and follow-through.

### 4.4 Analysis

- Compare medians (not means) of tokens and turns per task across arms; report distributions, not single numbers.
- Compare success rate per task; a task is "memory-sensitive" if Arm B fails it and Arm A passes it.
- Compare recurrence rate across the corpus.
- Repeat each arm at least 3 times per task to get variance; label the run with model, date, and repo revision.

### 4.5 Guardrails

- No network-dependent steps inside tasks.
- Tasks must not touch `.wolf/` internals.
- Fresh checkout per run, identical task order, identical model.
- If the harness cannot produce transcripts, fall back to estimated tokens and say so in the report.

## 5. Open questions

1. Should recurrence counting require the signature, or fall back to path-only when no signature is extractable? (Path-only is noisier but much easier.)
2. Should correction events be produced by the stop hook from session state, or only from an explicit `openwolf claim record`-style CLI? The stop-hook version is automatic but risks false corrections.
3. What is the minimum corpus size for a meaningful A/B claim? Ten tasks with three repeats is a reasonable starting point.
4. Should injections be logged with the transcript line so follow-through can be attributed to a specific warning?

## 6. Definition of done

- `HippocampusStore.stats` includes `recurrences` and `negative_writes`, updated by `post-write`.
- `openwolf report` prints the learning section with trend and precision.
- The A/B harness runs at least one trap task through both arms and records measured tokens, success, and corrections.
- No metric is reported as an improvement without a comparison (trend or control arm).
