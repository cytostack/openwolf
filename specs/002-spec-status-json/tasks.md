# Tasks: spec status --json

**Input**: `specs/002-spec-status-json/spec.md`

## Phase 3.2: Tests First (T100-T199) ⚠️ MUST FAIL FIRST
- [x] T101 - Test `spec status --json` emits valid JSON with activeSpec/phase/currentTask/status
- [x] T102 - Test `spec status --json` with no active spec emits `activeSpec: null` (exit 0)

## Phase 3.3: Core Implementation (T200-T299)
- [x] T201 - Implement `--json` flag in `openwolf spec status`
- [x] T202 - Regression: text output unchanged without `--json`

## Progress
- [x] 3.2 Tests (2/2) · [x] 3.3 Core (2/2)
