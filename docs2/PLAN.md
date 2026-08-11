# Hippocampus Memory System — Implementation Plan

> **Status**: Phases 1–3 ✅ | Hardening ✅ | Truth maintenance in progress
> **Goal**: Maintain immutable historical events and a provenance-aware, revisable current-knowledge projection.
> **Docs**: [truth-maintenance.md](./truth-maintenance.md) and [hippocampus-hardening-overview.md](./hippocampus-hardening-overview.md)

> **Architecture note:** `hippocampus`, `neocortex`, and `trauma` are implementation metaphors, not a scientifically faithful brain simulation. Importance, repetition, access count, emotional intensity, and recency are retrieval/retention signals—not proof of truth.

---

## Overview

The hippocampus system extends OpenWolf's flat, append-only memory with:
- **Events**: Context × Action × Outcome triplets with valence (reward/penalty/trauma)
- **Cues**: Location/Question/State triggers that recall relevant past events
- **Consolidation**: Short-term (hippocampus) → Long-term (neocortex) memory transfer

## Truth-maintenance phase

### Implemented

- [x] Claim, evidence, scope, and provenance types in `src/hippocampus/types.ts`.
- [x] Deterministic NFKC statement/scope identity and capped evidence reinforcement.
- [x] Explicit `confirms`, `contradicts`, and `refines` observations.
- [x] Append-only correction evidence with dispute/supersession links.
- [x] Authoritative `.wolf/claims.json` and derived `.wolf/claim-index.json` persistence.
- [x] Lock-protected Hippocampus claim record/recall APIs.
- [x] Explicit `openwolf claim record` and `openwolf claim recall` commands.
- [x] Claim templates and init/update preservation.
- [x] Sensitive path-scope rejection at the CLI boundary.
- [x] Regression coverage for identity, correction, dispute, refinement, evidence ranking, recovery, concurrency, and CLI behavior.

### Acceptance rules

1. Historical event payloads and evidence provenance are immutable.
2. Newer or repeated low-quality inference cannot outrank stronger test-backed evidence.
3. Contradiction and refinement require an explicit target; free-form semantic opposition is not guessed.
4. Active claims are the default recall surface; disputed/superseded history is opt-in.
5. The authoritative claim store is persisted before the derived index.
6. Corrupt or stale derived data is backed up and rebuilt from authoritative data.
7. Normal post-write hooks remain event-only.

## Completed historical phases

The original three phases remain complete:

- **Phase 1:** event model, event store, hook integration, and initial templates.
- **Phase 2:** cue index, location/question/state recall, and recall CLI.
- **Phase 3:** neocortex persistence, consolidation, decay, daemon wiring, and integration tests.

The hardening work added Windows-safe containment, atomic persistence, directory locks, full index repair, transfer journaling, consolidation ordering/budget fixes, and OpenCode template parity. See the hardening docs for detailed invariants and dogfood results.

---


**Target**: 1 session to complete
**Verification**: Build passes, `openwolf init` creates hippocampus.json, 98 tests passing

### Phase 1.1 — Create Type Definitions ✅
- [x] `src/hippocampus/types.ts` — WolfEvent + all interfaces

### Phase 1.2 — Create Hippocampus Core Module ✅
- [x] `src/hippocampus/index.ts` — Hippocampus class with addEvent(), recall(), getTraumas()

### Phase 1.3 — Create Event Store ✅
- [x] `src/hippocampus/event-store.ts` — hippocampus.json CRUD operations

### Phase 1.4 — Add Hippocampus Template ✅
- [x] `src/templates/hippocampus.json` — Template for `openwolf init`

### Phase 1.5 — Wire post-write.ts Hook ✅
- [x] `src/hooks/post-write.ts` — Call `hippocampus.addEvent()` on file writes

### Phase 1.6 — Wire pre-read.ts Hook ✅
- [x] `src/hooks/pre-read.ts` — Show trauma warnings before reading files

### Phase 1.7 — Modify init.ts ✅
- [x] `src/cli/init.ts` — Create `.wolf/hippocampus.json` on `openwolf init`

### Phase 1.8 — Build and Verify ✅
- [x] `pnpm build` passes
- [x] `openwolf init` creates hippocampus.json
- [x] File edit creates event in hippocampus.json (runtime tested)
- [x] Pre-read shows trauma warning (runtime tested)
- [x] Test suite: 98 tests passing

---

## Phase 2: Basic Recall

**Target**: 2 sessions (1 complete, 1 for tests)
**Prerequisite**: Phase 1 complete
**Status**: Implementation complete | Tests passing (109 assertions)

### Phase 2.1 — Cue Index System ✅
- [x] `src/hippocampus/cue-index.ts` — CueIndex type and build logic
- [x] `src/templates/cue-index.json` — Template for cue-index.json
- [x] Index is rebuilt and atomically persisted during every locked event transaction
- [x] Wire into init.ts to create cue-index.json

### Phase 2.2 — Recall API ✅
- [x] `Hippocampus.recall(cue, filters)` — Main recall entry point
- [x] Location cue scoring (exact, prefix, glob, parent, sibling)
- [x] Recency scoring with exponential decay (half-life 30 days)
- [x] Valence/intensity scoring boost

### Phase 2.3 — Question/Semantic Cue (Light) ✅
- [x] Tag-based matching fallback (via tag_index)
- [ ] Entity extraction from question cues — **Deferred** (QuestionCue.entities exists as optional field; caller must populate manually)

### Phase 2.4 — State Cue Integration ✅
- [x] Error pattern matching from action.error_message
- [ ] Recent valence sequence detection — **Deferred** (StateCue uses error pattern matching only)

### Phase 2.5 — Enhance pre-write Hook ✅
- [x] Check for trauma patterns before editing
- [x] Show warnings for high-intensity trauma events

### Phase 2.6 — CLI: `openwolf recall` Command ✅
- [x] `openwolf recall <query>` — CLI to trigger recall
- [x] Pretty-print recall results
- [x] JSON output option

### Phase 2.7 — Tests ✅
- [x] T9_cue-index.test.ts (37 assertions)
- [x] T10_recall.test.ts (57 assertions)
- [x] T11_recall-cli.test.sh (9 assertions)
- [x] T12_integration.sh (6 assertions)

---

## Phase 3: Consolidation ✅

**Target**: 3-4 sessions
**Prerequisite**: Phase 2 complete
**Status**: Implementation complete | Tests passing (37 assertions)

### Phase 3.1 — Neocortex Store ✅
- [x] `src/hippocampus/consolidation.ts` — Neocortex CRUD and decay logic
- [x] `src/templates/neocortex.json` — Template for neocortex store
- [x] Hippocampus.getLongTermMemory(), getNeocortexStats(), neocortexExists()

### Phase 3.2 — Decay Logic ✅
- [x] Linear decay: 5% per week for neutral/reward/penalty
- [x] Trauma never decays (decay_rate = 0)
- [x] calculateConsolidationScore() — intensity + valence + recency
- [x] determineConsolidationAction() — promote/decay/forget/keep

### Phase 3.3 — Daemon Wiring ✅
- [x] `cron-engine.ts` — Added consolidate_hippocampus action type
- [x] `cron-manifest.json` — hippocampus-consolidation task (daily 3 AM)
- [x] `init.ts` — Creates neocortex.json on init

### Phase 3.4 — Tests ✅
- [x] T13_consolidation.test.ts (6 tests)
- [x] T14_decay.test.ts (10 tests)
- [x] T15_neocortex.test.ts (9 tests)
- [x] T16_integration.test.sh (12 tests)

---

## File Structure

```
src/hippocampus/
├── index.ts              # Hippocampus class + public API
├── types.ts              # All type definitions (WolfEvent, Valence, etc.)
├── event-store.ts        # hippocampus.json CRUD
├── cue-index.ts          # Cue index builder (Phase 2)
├── cue-recall.ts         # Recall algorithm (Phase 2)
└── consolidation.ts       # Neocortex transfer + decay (Phase 3)

src/templates/
├── hippocampus.json      # Template for openwolf init
├── cue-index.json        # Template for cue-index (Phase 2)
└── neocortex.json        # Template for neocortex (Phase 3)

src/hooks/
├── post-write.ts         # Wire: addEvent() call
├── pre-read.ts           # Wire: trauma warnings
└── pre-write.ts          # Wire: penalty warnings (Phase 2)

src/cli/
├── init.ts               # Wire: create hippocampus.json
└── recall.ts             # Recall CLI command (Phase 2)
```

---

## Core Types

```typescript
type Valence = "reward" | "neutral" | "penalty" | "trauma";
type ActionType = "read" | "write" | "edit" | "delete" | "execute" | "correct" | "approve" | "reject" | "discover" | "fix" | "refactor";
type ConsolidationStage = "short-term" | "consolidating" | "long-term";

interface WolfEvent {
  id: string;
  version: 1;
  timestamp: string;
  session_id: string;
  context: EventContext;
  action: EventAction;
  outcome: EventOutcome;
  consolidation: EventConsolidation;
  source: "hook" | "daemon" | "manual";
  tags: string[];
}
```

---

## Verification Commands

```bash
# Build
pnpm build

# Runtime test
cd /tmp/test-project
openwolf init
echo '// test' > src/test.ts
# Edit file in Claude
# Check .wolf/hippocampus.json has new event

# Trauma warning test
# Edit same file 3 times (creates trauma)
# Pre-read should show warning
```
