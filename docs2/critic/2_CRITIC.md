# Critique: docs2/PLAN.md

## Summary

PLAN.md is an **implementation plan** for the hippocampus system, breaking Phase 1 into concrete tasks with file paths, code snippets, and verification commands. It is well-structured as a to-do list but raises concerns given the system is **not started** despite prior design docs existing.

---

## What the Plan Contains

- **Phase 1 (MVP)**: 1 session — types, core module, event-store, template, wire 2 hooks
- **Phase 2**: 2 sessions — recall scoring, cue-index, valence detection
- **Phase 3**: 3-4 sessions — neocortex, decay, daemon
- **Files to create**: 5 new files in `src/hippocampus/`
- **Files to modify**: 3 existing hook/CLI files
- **Verification commands**: Build check, runtime test, trauma warning test

---

## Quality Assessment

**Strong points:**
- Concrete file paths and line-by-line code for Phase 1
- Verification criteria defined per task ("Build passes", "Check .wolf/hippocampus.json")
- Phases have time estimates (1 session, 2 sessions, 3-4 sessions)
- Lists exactly which files to create and modify
- Addresses practical concerns: error boundaries, batch vs real-time, session ID format

**Weaknesses:**

1. **The plan is orphaned** — it was written after the 5 design docs (`00-04`) but neither preceded nor triggered implementation. There is no evidence anyone acted on it.

2. **Verification assumes implementation exists** — `openwolf init` is referenced to create `hippocampus.json`, but `src/cli/init.ts` is not modified in any prior commit to support this.

3. **Duplicate types.ts listing** — The file list shows `src/hippocampus/types.ts` twice (line 351 and 355).

4. **No dependency on existing code** — The plan imports from `../hippocampus/index.js` in hooks, but the hooks directory uses ES2022 Node16 modules. Has TypeScript module compatibility been verified?

5. **Hippocampus class is stub code** — `addEvent()`, `recall()`, `getTraumas()` are shown with `// Implementation` or `// Basic location-based recall` comments. These are not implemented.

---

## Key Observations

| Aspect | Status |
|--------|--------|
| Plan exists | Yes |
| Implementation started | **No** |
| Verification commands runnable | **No** — requires implementation first |
| Matches design docs | Yes — follows 00-04 faithfully |
| Realistic scope for Phase 1 | Reasonable (6 tasks, 1 session) |

---

## Verdict on PLAN.md

PLAN.md is a **competent implementation plan** that correctly decomposes the hippocampus design into executable tasks. The problem is not the plan — it is that **the plan was never executed**.

This is a common failure mode: documentation of a future feature without accountability for delivery. PLAN.md could live in `docs2/` indefinitely as aspirational content.

**Recommendation**: If this plan is to be taken seriously:
1. Assign it to a specific session/branch
2. Create the Phase 1 files before moving on to design docs for Phase 2+
3. Run the verification commands and commit the results
4. Add a CI check that `src/hippocampus/` exists

Without execution, PLAN.md is just more design debt alongside `00-04`.

---

*Generated: 2026-05-06*
