# Implementation Plan: spec CLI — list + next auto-complete

**Branch/spec**: `001-spec-cli` | **Date**: 2026-08-29 | **Spec**: `specs/001-spec-cli/spec.md`

## Summary
Add `openwolf spec list` (enumerate specs under `specs/`, mark the active one) and
make `openwolf spec next` auto-transition `status → complete` when every task in
`tasks.md` is checked.

## Technical Context
**Language/Version**: TypeScript 5.7 / ES2022, Node 20+
**Primary Dependencies**: commander (CLI), node:test (tests)
**Storage**: `.wolf/specs-state.json` (atomic write) + `specs/NNN-name/` markdown
**Testing**: node:test (`node --test tests/*.test.ts`)
**Target Platform**: Node CLI, Windows/macOS/Linux

## Constitution Check
- Simplicity: touch only `src/cli/spec-cmd.ts` + `tests/specs.test.ts`; reuse
  `tasks-parse.ts` `nextTask`; no new abstraction.
- Testing (NON-NEGOTIABLE): tests first (red), then implementation (green).
- Observability: CLI prints active marker + completion to stdout.

## Project Structure
```
specs/001-spec-cli/
├── plan.md              # this file
├── research.md          # decisions
├── data-model.md        # entities
├── quickstart.md        # how to validate
└── tasks.md             # /tasks output (next step)
```

## Phase 0: Research
- How to enumerate specs: `fs.readdirSync(specsDir, { withFileTypes: true })`,
  keep dirs containing `spec.md` (FR-001 edge case).
- How to detect "all checked": reuse `nextTask()` returning `null` (already exists).
- Auto-complete guard: only from `status === "active"`; avoid `setStatus` no-op throw
  on `complete` (edge case in spec.md).

## Phase 1: Design & Contracts
- `spec list`: list sorted dir names; append ` * active` to the active one; empty → "No specs".
- `spec next`: unchanged fast path; when `nextTask` is null and status is `active`,
  `setStatus(state, "complete")` + save.

## Progress Tracking
- [x] Phase 0 research complete
- [x] Phase 1 design complete
- [ ] Phase 2 tasks generated (/tasks)
