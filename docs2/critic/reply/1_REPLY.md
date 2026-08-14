# Response to Critique: Hippocampus Memory System

## Acknowledgment

The critique is valid. The `docs2/` output was **design documentation only** — no source code was produced. The critic correctly identifies the gap between documented intent and actual implementation.

---

## Actionable Items

### Phase 1: Minimum Viable Hippocampus (Target: 1 session)

**Owner:** Implementation developer
**Prerequisite:** None
**Status:** Not started

| # | Action | File(s) | Verification |
|---|--------|---------|--------------|
| 1.1 | Create `src/hippocampus/types.ts` with `WolfEvent` interface | `src/hippocampus/types.ts` | TypeScript compiles without errors |
| 1.2 | Create `src/hippocampus/index.ts` with `addEvent()` method | `src/hippocampus/index.ts` | `addEvent()` returns `WolfEvent` with generated UUID |
| 1.3 | Create `src/hippocampus/event-store.ts` for hippocampus.json CRUD | `src/hippocampus/event-store.ts` | `load()` / `save()` roundtrip preserves data |
| 1.4 | Add hippocampus template to `src/templates/` | `src/templates/hippocampus.json` | Template file exists in `src/templates/` |
| 1.5 | Wire `post-write.ts` to call `hippocampus.addEvent()` | `src/hooks/post-write.ts` | Build passes, new event appears in `.wolf/hippocampus.json` |

### Phase 2: Basic Recall (Target: 2 sessions)

**Owner:** Implementation developer
**Prerequisite:** Phase 1 complete
**Status:** Not started

| # | Action | File(s) | Verification |
|---|--------|---------|--------------|
| 2.1 | Add `recall()` method with location-based lookup | `src/hippocampus/index.ts` | `recall()` returns matching events from buffer |
| 2.2 | Create `cue-index.json` builder | `src/hippocampus/cue-recall.ts` | Index contains path → event ID mappings |
| 2.3 | Wire `pre-read.ts` to check for trauma warnings | `src/hooks/pre-read.ts` | Claude receives warning for files with trauma events |
| 2.4 | Add valence detection in `post-write.ts` | `src/hooks/post-write.ts` | Events have correct valence (reward/penalty/trauma) |

### Phase 3: Consolidation (Target: 3-4 sessions)

**Owner:** Implementation developer
**Prerequisite:** Phase 2 complete
**Status:** Not started

| # | Action | File(s) | Verification |
|---|--------|---------|--------------|
| 3.1 | Create `neocortex.json` store | `src/hippocampus/consolidation.ts` | High-access events promoted to neocortex |
| 3.2 | Add decay logic | `src/hippocampus/consolidation.ts` | Low-access events decay over time |
| 3.3 | Wire daemon to run consolidation | `src/daemon/` | Consolidation runs during off-peak hours |

---

## Immediate Fix (No Implementation Required)

If implementation cannot start immediately, apply **one** of:

| Option | Action | Effect |
|--------|--------|--------|
| **A** | Move `docs2/` to `docs/roadmap/hippocampus/` | Signals "future work", not current feature |
| **B** | Add `## Status: Not Implemented` header to each doc | Removes false signal |
| **C** | Delete `docs2/` entirely | Removes orphaned docs |

**Recommended:** Option A — move to `docs/roadmap/hippocampus/` with Phase 1-6 status set to `not_started`.

---

## What Was Actually Produced

The documentation is a **valid specification** (per critic's own assessment: "implementation-ready"). The gap is:
- Documentation: ~700 lines of TypeScript interfaces, schemas, code examples
- Implementation: 0 lines of actual hippocampus code in `src/`

The docs describe a system that could be implemented by following the doc order (00 → 05). The next step is not more documentation — it is **implementing Phase 1**.

---

*Response to: [1_CRITIC.md](./1_CRITIC.md)*
*Date: 2026-05-06*
