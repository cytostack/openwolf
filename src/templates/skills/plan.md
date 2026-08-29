---
description: OpenWolf SDD — turn the active spec into a technical plan (plan/research/data-model/contracts/quickstart)
argument-hint: [tech choices, e.g. "TypeScript + PostgreSQL + node:test"]
---

Arguments: $ARGUMENTS

Turn the active spec into an implementation plan. The plan resolves WHAT into HOW.

1. Read the active spec id: `openwolf spec status`. Then read `specs/<id>/spec.md`.
2. Read `.wolf/cerebrum.md` (Do-Not-Repeat + Decision Log) for project constraints.
3. Extract tech choices from the arguments; ask a follow-up question if a choice
   (language, framework, storage, testing) is unclear.
4. Write these artifacts under `specs/<id>/`, using `.wolf/spec-templates/plan-template.md`
   as the base:
   - `plan.md` — summary, technical context, constitution check, architecture,
     task-generation strategy
   - `research.md` — one decision per row: choice / rationale / alternatives
   - `data-model.md` — entities, fields, relationships, validation rules
   - `contracts/` — one API contract per user action
   - `quickstart.md` — how to run and validate
5. Advance the phase: `openwolf spec phase plan`.
6. Report the artifacts and next step (`/tasks`).

Guardrail: resolve every `[NEEDS CLARIFICATION]` from the spec in `research.md`;
do not proceed with unresolved unknowns. Update `.wolf/STATUS.md` if the plan
changes the active work.
