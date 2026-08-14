# Critique: Hippocampus Memory System Extension

## Summary

The `docs2/` directory contains a well-structured but **unimplemented** design specification for a neuroscience-inspired episodic/spatial memory system. The effort produced 5 detailed markdown documents (~700+ lines total) but **zero source code changes**.

---

## What Was Produced

| File | Purpose | Status |
|------|---------|--------|
| `00-hippocampus-memory-system.md` | High-level design, core concepts, architecture | Documentation only |
| `01-event-model.md` | Event schema (WolfEvent, valence, consolidation) | Documentation only |
| `02-cue-system.md` | Location/Question/State cue retrieval system | Documentation only |
| `03-consolidation.md` | Hippocampus-to-neocortex transfer logic | Documentation only |
| `04-implementation-spec.md` | File structures, JSON schemas, data flow | Documentation only |
| `05-hook-integration.md` | Integration points with existing hooks | Documentation only |

---

## The Problem: No Source Code

**Confirmed absence:**
- No `src/hippocampus/` directory exists
- No `src/hooks/hippocampus*` files
- No imports of hippocampus modules in any hook
- No changes to `src/cli/`, `src/daemon/`, `src/scanner/`, `src/tracker/`
- `grep -r "hippocampus" src/` returns nothing

The design documents describe a complete system with:
- Event capture from 6 hooks
- Short-term buffer (hippocampus.json)
- Long-term storage (neocortex.json)
- Fast lookup index (cue-index.json)
- Consolidation daemon
- Recall API with similarity scoring

**None of it is implemented.**

---

## Quality of the Documentation

**Strong points:**
- Comprehensive schema definitions (TypeScript interfaces in 01, 04)
- Clear separation: Event (atomic) → Cue (trigger) → Consolidation (transfer)
- Specific file paths and JSON schemas — implementation-ready
- Detailed hook integration examples with actual code snippets
- Config options (buffer size, retention, decay rates)
- Open questions documented with recommendations

**The documentation reads like a specification that could be handed to a developer to implement.** It is not vague brainstorming — it has concrete schemas, file paths, function signatures, and example code.

---

## Why This Is a Problem

1. **Design drift**: The docs describe behavior the system doesn't have. A developer reading `docs2/` would expect hippocampus-powered warnings in hooks. The hooks do nothing of the sort.

2. **Maintenance burden**: These 5 docs must be kept in sync with any future implementation. As-is, they are orphaned design documents.

3. **False signal**: The presence of `docs2/` with detailed implementation specs implies the feature exists or is in progress. It is neither.

4. **Opportunity cost**: The effort to write this level of documentation could have been partial implementation code, demonstrating the core idea.

---

## Verdict

| Aspect | Assessment |
|--------|------------|
| Documentation quality | High — detailed, structured, implementation-ready |
| Implementation completeness | **0%** — no code exists |
| Integration with existing codebase | **None** — hooks unchanged |
| Feature functional | **No** — design only |

**The hippocampus extension is a design document, not a feature.**

---

## Recommendations

1. **Either implement or remove the docs**: If hippocampus is a future roadmap item, move these docs to a `docs/roadmap/` directory with explicit status "not started". If abandoned, delete `docs2/` entirely.

2. **Implement incrementally**: Start with Phase 1 from `00-hippocampus-memory-system.md`:
   - Define Event schema in `src/hippocampus/types.ts`
   - Create `src/hippocampus/index.ts` with basic `addEvent()` / `recall()`
   - Add hippocampus.json to `.wolf/templates/`
   - Wire only `post-write.ts` to capture events

3. **Don't let docs替你說話**: If a feature isn't implemented, don't have detailed docs that describe what it would do. The docs2/ folder is currently lying about the system's capabilities.

---

*Generated: 2026-05-06*
