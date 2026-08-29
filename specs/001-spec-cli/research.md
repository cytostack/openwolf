# Technical Research: spec CLI

## Enumerating specs
**Choice**: `fs.readdirSync(specsDir, { withFileTypes: true })` + filter directories
that contain `spec.md`.
**Rationale**: the spec unit of existence is the `spec.md` (FR-001); a bare directory
without it is not a spec.
**Alternatives considered**: glob all `.md` (too loose), parse a manifest (overkill).

## Detecting "all tasks checked"
**Choice**: reuse `nextTask()` from `src/specs/tasks-parse.ts`; `null` means no
unchecked task remains.
**Rationale**: already the single parser for the `- [ ] T###` convention; no second
parser.
**Alternatives considered**: count `[x]` vs `[ ]` (duplicates logic).

## Auto-complete guard
**Choice**: only auto-`complete` when `status === "active"`; otherwise print a message.
**Rationale**: `setStatus` rejects `paused/blocked → complete` and `complete → *`
(no-op throws). Auto-completing only from `active` keeps the state machine legal.
**Alternatives considered**: allow any status → complete (would violate the machine).
