# Feature Specification: spec CLI — list + next auto-complete

**Feature id**: `001-spec-cli`
**Created**: 2026-08-29
**Status**: Draft
**Input**: `openwolf spec list` command + `spec next` auto-complete when all tasks checked

## User Scenarios & Testing

### Primary User Story
As an OpenWolf user driving spec-driven development, I want to list every spec in
flight and have `openwolf spec next` finish the spec for me when the task list is
done, so I don't need to remember a separate `complete` command.

### Acceptance Scenarios
1. **Given** `specs/` contains `001-a` and `002-b` with `001-a` active, **When** I
   run `openwolf spec list`, **Then** both are listed and `001-a` is marked active.
2. **Given** `specs/` is empty, **When** I run `openwolf spec list`, **Then** it
   reports "no specs" and exits 0 (not an error).
3. **Given** the active spec's `tasks.md` has every task checked, **When** I run
   `openwolf spec next`, **Then** the spec status becomes `complete`.
4. **Given** the active spec's `tasks.md` still has unchecked tasks, **When** I run
   `openwolf spec next`, **Then** `currentTask` advances to the first unchecked task
   (existing behavior, unchanged).

### Edge Cases
- A directory under `specs/` that lacks `spec.md` — list should ignore it.
- `spec next` when no `tasks.md` exists — keep the current error, no auto-complete.
- `spec next` when already `complete` — must not re-complete (idempotent, no crash).

## Requirements

### Functional Requirements
- **FR-001**: `openwolf spec list` MUST list every `NNN-name` directory under
  `specs/` that contains a `spec.md`.
- **FR-002**: `openwolf spec list` MUST mark the active spec as reported by
  `.wolf/specs-state.json`.
- **FR-003**: `openwolf spec next` MUST transition `status` to `complete` when
  `tasks.md` has no unchecked task.
- **FR-004**: `openwolf spec next` MUST preserve existing advance-to-next-unchecked
  behavior when tasks remain.

### Key Entities
- **Spec directory**: `specs/NNN-name/`, identified by its `spec.md`.
- **Spec state**: `.wolf/specs-state.json` (`activeSpec`, `phase`, `currentTask`, `status`).

## Review & Acceptance Checklist
- [x] No implementation details (languages, frameworks, APIs)
- [x] User-focused, written for stakeholders
- [x] Every requirement testable and unambiguous
- [x] No `[NEEDS CLARIFICATION]` markers remain
- [x] Scope clearly bounded
