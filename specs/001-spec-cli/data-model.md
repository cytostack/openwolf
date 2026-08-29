# Data Model: spec CLI

## Entities

### Spec directory (`specs/NNN-name/`)
- `spec.md` — required marker; a directory is a spec iff this file exists.
- `tasks.md` — the numbered checklist (T001…), source of truth for `next`.

### Spec state (`.wolf/specs-state.json`)
- `activeSpec: string | null` — the spec `spec list` marks with ` * active`.
- `phase: specify | plan | tasks | implement`
- `currentTask: string | null`
- `status: active | paused | blocked | complete`

## Relationships
- `spec list` reads the filesystem (`specs/`) cross-referenced with `activeSpec`.
- `spec next` reads `tasks.md` and mutates `currentTask` / `status`.

## Validation Rules
- `spec next` auto-completes only from `status === "active"` (state machine constraint).
- A directory without `spec.md` is not listed.
