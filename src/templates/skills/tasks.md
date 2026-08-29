---
description: OpenWolf SDD — generate a numbered TDD task list (T001-T499) with phase gates from the active plan
argument-hint: ""
---

Generate the numbered task breakdown from the active plan.

1. Read the active spec id: `openwolf spec status`. Load `specs/<id>/plan.md`,
   `specs/<id>/data-model.md`, and `specs/<id>/contracts/`.
2. Write `specs/<id>/tasks.md` using `.wolf/spec-templates/tasks-template.md`:
   - T001-T099 setup, T100-T199 tests (MUST fail first), T200-T299 core
     implementation, T300-T399 integration, T400-T499 polish.
   - Mark independent tasks `[P]`; mark dependencies with `←` (depends on) and
     `→` (unlocks).
   - Phase gates: every test task precedes its implementation; no implementation
     task before its failing test; integration only after green.
3. Advance the phase: `openwolf spec phase tasks`.
4. Report the critical path, parallel groups, and the TDD gates.

Guardrail: each task names an exact file path; two `[P]` tasks never modify the
same file.
