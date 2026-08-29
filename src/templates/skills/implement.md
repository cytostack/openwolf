---
description: OpenWolf SDD — execute the active task list with TDD (red → green → refactor), advancing via openwolf spec next
argument-hint: ""
---

Execute the active task list following TDD.

1. Read `openwolf spec status` for the active spec, phase, and current task.
2. Open `specs/<id>/tasks.md` and start at the first unchecked task.
3. For each task, follow TDD in order:
   - Test tasks (T100-T199): write the failing test first — verify it fails (red).
   - Implementation tasks (T200-T299): write the minimal code to pass (green).
   - Polish/refactor (T400+): improve only while tests stay green.
4. After a task passes, check its box in `tasks.md` (`- [x] T###`) and run
   `openwolf spec next` to advance.
5. When every task is checked, run `openwolf spec complete`.
6. Update `.wolf/STATUS.md` (move the work to ✅ Done) and append a line to
   `.wolf/memory.md`.

Guardrails:
- Never write implementation before its test fails.
- Commit after each task completion.
- Report blockers with the task number (e.g. "T203 blocked by …").
