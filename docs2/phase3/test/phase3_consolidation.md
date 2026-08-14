# Phase 3 Test Plan + Results

> **Status**: ✅ COMPLETE — All tests passing
> **Date**: 2026-05-06
> **Tests**: T13 Consolidation API, T14 Decay Logic, T15 Neocortex Store, T16 Integration

---

## Overview

Phase 3 implements **Consolidation** — the transfer of short-term hippocampus memories to long-term neocortex storage with decay logic.

### Key Features Implemented

1. **Neocortex Store** (`neocortex.json`) — Long-term memory storage
2. **Decay Logic** — Weekly exponential decay (5% per week), trauma never decays
3. **Consolidation Scoring** — Events scored by intensity, valence, access count, recency
4. **Daemon Wiring** — `hippocampus-consolidation` cron task runs daily at 3 AM

---

## Test Suites

| Suite | Purpose | Assertions |
|-------|---------|------------|
| T13 Consolidation API | Hippocampus.consolidate(), getLongTermMemory(), getNeocortexStats() | 6 |
| T14 Decay Logic | calculateDecay(), calculateConsolidationScore(), determineConsolidationAction() | 10 |
| T15 Neocortex Store | createEmptyNeocortex(), loadNeocortex(), saveNeocortex(), getNeocortexEvents() | 9 |
| T16 Integration | Daemon wiring, init creates neocortex.json, cron manifest | 12 |
| **Total** | | **37** |

---

## T13 — Consolidation API Tests

**File**: `docs2/phase3/test/T13_consolidation.test.ts`
**Run**: `node docs2/phase3/test/T13_consolidation.test.ts`

| # | Check | Result |
|---|-------|--------|
| T13.1 | Neocortex store CRUD | ✅ PASS |
| T13.2 | Consolidation report structure | ✅ PASS |
| T13.3 | High-value events get promoted | ✅ PASS |
| T13.4 | Trauma events never decay | ✅ PASS |
| T13.5 | Neocortex long-term memory | ✅ PASS |
| T13.6 | Stats include neocortex info | ✅ PASS |

---

## T14 — Decay Logic Tests

**File**: `docs2/phase3/test/T14_decay.test.ts`
**Run**: `node docs2/phase3/test/T14_decay.test.ts`

| # | Check | Result |
|---|-------|--------|
| T14.1 | Trauma never decays | ✅ PASS |
| T14.2 | Normal events decay over time (5%/week) | ✅ PASS |
| T14.3 | Decay compounds over multiple weeks | ✅ PASS |
| T14.4 | Decay never goes below zero | ✅ PASS |
| T14.5 | Pre-decayed events decay further | ✅ PASS |
| T14.6 | Consolidation score calculation | ✅ PASS |
| T14.7 | Low-value event has low score | ✅ PASS |
| T14.8 | Determine consolidation action | ✅ PASS |
| T14.9 | Very old low-intensity events forgotten | ✅ PASS |
| T14.10 | Long-term threshold boundary (0.1 vs 0.2) | ✅ PASS |

### Decay Formula

```
decay_factor = current_decay × (1 - weekly_decay_rate × weeks_elapsed)

where:
- weekly_decay_rate = 0.05 (5%) for neutral/reward/penalty
- weekly_decay_rate = 0.00 (0%) for trauma
- trauma never decays

Example:
- After 1 week: 1.0 × (1 - 0.05 × 1) = 0.95
- After 4 weeks: 1.0 × (1 - 0.05 × 4) = 0.80
- After 20 weeks: 1.0 × (1 - 0.05 × 20) = 0.00 (floor at 0)
```

### Consolidation Score Formula

```
score = (intensity × 0.3) + (min(access_count × 0.05, 0.3)) + valence_bonus + recency_bonus

where:
- valence_bonus: reward=0.2, trauma=0.25, penalty=0.1, neutral=0
- recency_bonus: 0.15 if event < 7 days old
- Final score × decay_factor, capped at 1.0
```

### Action Thresholds

| Stage | Condition | Action |
|-------|-----------|--------|
| short-term | score ≥ 0.7 | promote → consolidating |
| short-term | score < 0.7 AND daysSinceLastCheck ≥ 7 | decay (update decay_factor) |
| short-term | score < 0.7 AND daysSinceLastCheck < 7 | keep |
| consolidating | score ≥ 0.84 (1.2× threshold) | promote → long-term |
| consolidating | score < 0.2 | forget |
| consolidating | 0.2 ≤ score < 0.84 | keep |
| long-term | score < 0.1 | forget |
| long-term | score ≥ 0.1 | keep |

---

## T15 — Neocortex Store Tests

**File**: `docs2/phase3/test/T15_neocortex.test.ts`
**Run**: `node docs2/phase3/test/T15_neocortex.test.ts`

| # | Check | Result |
|---|-------|--------|
| T15.1 | Create empty neocortex | ✅ PASS |
| T15.2 | Neocortex round-trip save/load | ✅ PASS |
| T15.3 | Load returns null for missing file | ✅ PASS |
| T15.4 | Save updates size_bytes | ✅ PASS |
| T15.5 | Filter by valence | ✅ PASS |
| T15.6 | Filter by intensity | ✅ PASS |
| T15.7 | Limit works | ✅ PASS |
| T15.8 | Events sorted by recency | ✅ PASS |
| T15.9 | Stats tracking | ✅ PASS |

---

## T16 — Integration Tests

**File**: `docs2/phase3/test/T16_integration.test.sh`
**Run**: `bash docs2/phase3/test/T16_integration.test.sh`

| # | Check | Result |
|---|-------|--------|
| T16.1 | consolidation.js exists in dist | ✅ PASS |
| T16.2 | neocortex.json template exists | ✅ PASS |
| T16.3 | init creates neocortex.json | ✅ PASS |
| T16.4 | Neocortex has correct structure | ✅ PASS |
| T16.5 | cron-manifest includes hippocampus-consolidation | ✅ PASS |
| T16.6 | Hippocampus.consolidate() method exists | ✅ PASS |
| T16.7 | Hippocampus.getLongTermMemory() method exists | ✅ PASS |
| T16.8 | Hippocampus.getNeocortexStats() method exists | ✅ PASS |
| T16.9 | Hippocampus.neocortexExists() method exists | ✅ PASS |
| T16.10 | consolidate() creates neocortex if missing | ✅ PASS |
| T16.11 | cron-engine handles consolidate_hippocampus action | ✅ PASS |

---

## File Structure

```
src/hippocampus/
├── index.ts              # Hippocampus class + consolidation methods
├── types.ts              # Type definitions (updated)
├── event-store.ts        # Hippocampus store CRUD
├── cue-index.ts          # Cue index (Phase 2)
├── cue-recall.ts         # Recall algorithm (Phase 2)
└── consolidation.ts      # Neocortex + decay logic (NEW)

src/templates/
├── hippocampus.json      # Short-term store template
├── cue-index.json        # Cue index template (Phase 2)
└── neocortex.json        # Long-term store template (NEW)

src/daemon/
└── cron-engine.ts        # Added consolidate_hippocampus action (UPDATED)

src/cli/
└── init.ts              # Added neocortex.json creation (UPDATED)
```

---

## API Changes

### New Hippocampus Methods

```typescript
// Run consolidation pass
consolidate(options?: { maxToPromote?: number }): ConsolidationReport

// Get events from long-term memory
getLongTermMemory(filters?: {
  valence?: string[];
  minIntensity?: number;
  limit?: number;
}): WolfEvent[]

// Get neocortex statistics
getNeocortexStats(): {
  total_consolidated: number;
  by_valence: Record<string, number>;
  last_consolidation: string | null;
}

// Check if neocortex exists
neocortexExists(): boolean
```

### New ConsolidationReport Type

```typescript
interface ConsolidationReport {
  timestamp: string;
  events_processed: number;
  promoted: number;
  decayed: number;
  forgotten: number;
  kept: number;
  new_neocortex_size: number;
  results: ConsolidationResult[];
}
```

### New NeocortexStore Type

```typescript
interface NeocortexStore {
  version: 1;
  schema_version: 1;
  project_root: string;
  created_at: string;
  last_updated: string;
  events: WolfEvent[];
  stats: {
    total_consolidated: number;
    by_valence: Record<string, number>;
    last_consolidation: string | null;
  };
  size_bytes: number;
  max_size_bytes: number;
}
```

---

## Verification Commands

```bash
# Build first
pnpm build

# T13: Consolidation API
node docs2/phase3/test/T13_consolidation.test.ts

# T14: Decay Logic
node docs2/phase3/test/T14_decay.test.ts

# T15: Neocortex Store
node docs2/phase3/test/T15_neocortex.test.ts

# T16: Integration
bash docs2/phase3/test/T16_integration.test.sh
```

---

## Prerequisites

```bash
pnpm build
```

---

## Implementation Notes

1. **Decay is one-way**: Decay factor only decreases, never increases. This models real memory degradation.

2. **Trauma is special**: Trauma events have `decay_rate = 0`, meaning they never lose intensity over time. This reflects the neuroscience principle that traumatic memories are often more durable.

3. ** Consolidation happens off-peak**: The daemon task runs at 3 AM daily to avoid impacting performance during work hours.

4. **Neocortex has max size**: Default 10MB limit. When exceeded, oldest low-intensity neutral events are evicted first.

5. **Consolidation is batched**: Max 50 events promoted per consolidation pass to avoid long-running operations.

---

*Last updated: 2026-05-06*
