# Implementation Plan: [FEATURE]

**Branch/spec**: `[NNN-name]` | **Date**: [DATE] | **Spec**: `specs/[NNN-name]/spec.md`

## Summary
[Primary requirement + technical approach in 1-2 sentences.]

## Technical Context
**Language/Version**: [or NEEDS CLARIFICATION]
**Primary Dependencies**: [or NEEDS CLARIFICATION]
**Storage**: [or N/A]
**Testing**: [or NEEDS CLARIFICATION]
**Target Platform**: [or NEEDS CLARIFICATION]

## Constitution Check
*GATE: pass before research; re-check after design.*

- Simplicity: minimal projects / direct framework use / no speculative patterns.
- Testing (NON-NEGOTIABLE): RED-GREEN-Refactor; tests committed before implementation.
- Observability: structured logging; enough error context.
- Deviations from the above must be justified in Complexity Tracking below.

## Project Structure
```
specs/[NNN-name]/
├── plan.md              # this file
├── research.md          # decisions
├── data-model.md        # entities
├── quickstart.md        # how to validate
├── contracts/           # API contracts
└── tasks.md             # /tasks output (not created here)
```

## Phase 0: Research
- Each `NEEDS CLARIFICATION` → a research decision (choice / rationale / alternatives)
  in `research.md`.

## Phase 1: Design & Contracts
- Entities → `data-model.md`; user actions → `contracts/`; validation → `quickstart.md`.

## Complexity Tracking
| Violation | Why needed | Simpler alternative rejected because |
|---|---|---|

## Progress Tracking
- [ ] Phase 0 research complete
- [ ] Phase 1 design complete
- [ ] Constitution re-check passed
