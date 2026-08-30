# Feature Specification: spec status --json

**Feature id**: `002-spec-status-json`
**Created**: 2026-08-29
**Status**: Draft
**Input**: Machine-readable `openwolf spec status --json` output

## User Scenarios & Testing

### Primary User Story
As a tool/script author, I want `openwolf spec status --json` so I can read the
active spec programmatically without parsing human text.

### Acceptance Scenarios
1. **Given** an active spec, **When** I run `openwolf spec status --json`, **Then**
   stdout is a valid JSON object with `activeSpec`, `phase`, `currentTask`, `status`.
2. **Given** no active spec, **When** I run `openwolf spec status --json`, **Then**
   stdout is JSON with `activeSpec: null` (exit 0, not an error).
3. **Given** no `--json`, **When** I run `openwolf spec status`, **Then** the human
   text output is unchanged.

### Edge Cases
- `--json` combined with other output going to stdout must stay machine-parseable.

## Requirements

### Functional Requirements
- **FR-001**: `openwolf spec status --json` MUST emit a single JSON object.
- **FR-002**: With no active spec, `--json` MUST emit `activeSpec: null` and exit 0.
- **FR-003**: Without `--json`, text output MUST be unchanged.

### Key Entities
- **Spec state**: `.wolf/specs-state.json` (`activeSpec`, `phase`, `currentTask`, `status`).

## Review & Acceptance Checklist
- [x] No implementation details
- [x] Testable and unambiguous
- [x] No `[NEEDS CLARIFICATION]`
- [x] Scope clearly bounded
