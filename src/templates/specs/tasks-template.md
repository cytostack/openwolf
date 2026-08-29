# Tasks: [FEATURE NAME]

**Input**: `specs/[NNN-name]/plan.md` + `data-model.md` + `contracts/`

## Task Format Legend
- **T001**: sequential id; **[P]**: parallel-safe; **←**: depends on; **→**: unlocks.

## Phase 3.1: Setup (T001-T099)
- [ ] T001 - Create project structure per plan.md → ALL
- [ ] T002 - Initialize [language/framework] project ← T001

## Phase 3.2: Tests First (T100-T199) ⚠️ MUST FAIL FIRST
**GATE: all tests written and failing before ANY implementation (T200+).**

- [ ] T101 - [P] Contract test for [endpoint] in tests/... ← T002 → T201

## Phase 3.3: Core Implementation (T200-T299)
**GATE: only after all tests fail.**

- [ ] T201 - [entity/model] in src/... ← T100s → T3xx

## Phase 3.4: Integration (T300-T399)
- [ ] T301 - Connect [service] to [storage] ← T2xx → T4xx

## Phase 3.5: Polish (T400-T499)
**GATE: only after integration green.**

- [ ] T401 - Refactor with green tests ← T3xx

## 🔴 Critical Path
```
T001 → T002 → … → final
```

## 🟢 Parallel Groups
- Group A: … (independent files only)

## Phase Gates (TDD)
1. Test gate: all T100s fail before T200s.
2. Green gate: all tests pass before integration.
3. Refactor gate: only with green tests.

## Progress
- [ ] 3.1 Setup (0/n) · [ ] 3.2 Tests (0/n) · [ ] 3.3 Core (0/n) · [ ] 3.4 Integration (0/n) · [ ] 3.5 Polish (0/n)
