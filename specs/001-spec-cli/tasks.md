# Tasks: spec CLI — list + next auto-complete

**Input**: `specs/001-spec-cli/plan.md` + `data-model.md` + `research.md`

## Task Format Legend
- **T###**: sequential id; **[P]**: parallel-safe; **←**: depends on; **→**: unlocks.

## Phase 3.2: Tests First (T100-T199) ⚠️ MUST FAIL FIRST
**GATE: all tests written and failing before ANY implementation (T200+).**

- [x] T101 - [P] Test `spec list` lists specs and marks the active one ← (existing) → T201
- [x] T102 - [P] Test `spec list` empty specs dir exits 0 with "No specs" ← → T201
- [x] T103 - [P] Test `spec list` ignores dirs without spec.md ← → T201
- [x] T104 - [P] Test `spec next` auto-completes (status → complete) when all checked ← → T202
- [x] T105 - [P] Test `spec next` is idempotent when already complete (no crash) ← → T202
- [x] T106 - [P] Test `spec next` advances currentTask when tasks remain (regression guard) ← → T202

## Phase 3.3: Core Implementation (T200-T299)
**GATE: only after all T100s fail.**

- [x] T201 - Implement `spec list` in `src/cli/spec-cmd.ts` ← T101,T102,T103
- [x] T202 - Implement `spec next` auto-complete in `src/cli/spec-cmd.ts` ← T104,T105,T106

## Phase 3.5: Polish (T400-T499)
**GATE: only after all tests green.**

- [x] T401 - Run `node --test tests/*.test.ts` full suite green ← T201,T202

## 🔴 Critical Path
```
T101..T106 (tests) → T201 → T202 → T401
```

## 🟢 Parallel Groups
- Group A: T101-T106 all independent (different test cases, same file is fine — no
  two [P] tasks modify the same production file; tests append to `tests/specs.test.ts`
  in separate describes).

## Phase Gates (TDD)
1. Test gate: T101-T106 written and failing before T201/T202.
2. Green gate: T201/T202 make tests pass before T401.

## Progress
- [x] 3.2 Tests (6/6) · [x] 3.3 Core (2/2) · [x] 3.5 Polish (1/1)
