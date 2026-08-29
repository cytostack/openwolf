---
description: OpenWolf SDD — create a feature specification (specs/NNN-name/spec.md) from a user description
argument-hint: [feature description]
---

Arguments: $ARGUMENTS

Create a feature specification following OpenWolf's spec-driven development (SDD)
convention. The spec describes WHAT and WHY, never HOW.

1. If no description was given, ask the user what feature to specify.
2. Find the next feature number: list `specs/`, take the highest `NNN-*` and add 1
   (zero-padded; `001` when empty).
3. Derive a name slug from the description (lowercase, hyphenated, 2-3 words), e.g.
   `001-user-auth`.
4. Read `.wolf/spec-templates/spec-template.md` as the base and write
   `specs/NNN-name/spec.md`, filling:
   - Primary user story, acceptance scenarios (Given/When/Then), edge cases
   - Functional requirements `FR-001 …`
   - Key entities (only if data is involved)
   Mark every assumption you would otherwise guess with `[NEEDS CLARIFICATION: …]`.
5. Record the spec as the active work: run `openwolf spec set NNN-name`.
6. Update `.wolf/STATUS.md` → `## 🚀 Next phase` to reference this spec.
7. Report a summary (story count, scenario count, requirement count) and the next
   step (`/plan`).

Guardrails:
- No implementation details (languages, frameworks, APIs, code structure).
- Requirements must be testable and unambiguous; leave `[NEEDS CLARIFICATION]`
  markers rather than guessing.
