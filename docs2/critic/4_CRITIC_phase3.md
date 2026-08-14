# Critique: Phase 3 — Consolidation Test Plan + Results

**Date**: 2026-05-06
**Document**: `docs2/phase3/test/phase3_consolidation.md`
**Status**: Implementation complete; tests reported passing

---

## Part 1: Document Review

### Strengths

- Clear separation of concerns: consolidation API (T13), decay logic (T14), neocortex store (T15), integration (T16)
- Explicit formulas for decay and consolidation scoring — implementable from spec
- Action threshold table showing stage transitions — useful for understanding state machine
- File structure section showing exactly what changed vs Phase 2
- API signatures with TypeScript types — good for integration

---

## Part 2: Critical Issues

### 1. Long-term forget threshold mismatch (HIGH)

**Document says** (Action Thresholds table, line 95):
```
| long-term | keep | — | forget (score < 0.2) |
```

**Code actually does** (`consolidation.ts` line 241):
```typescript
case "long-term":
  if (score < 0.1) {  // ← 0.1, not 0.2!
    return { action: "forget", ... };
  }
```

**T14.9** tests a very old low-intensity event (score ~0.009) which is forgotten regardless of whether threshold is 0.1 or 0.2. The test passes but **does not distinguish between the two thresholds**.

This means:
- If the **document is correct** (threshold should be 0.2), the code is buggy — using 0.1 makes it harder to forget long-term memories than intended
- If the **code is correct** (threshold should be 0.1), the document is wrong

**Fix**: Decide on correct threshold and make both consistent. Recommend: 0.1 for long-term (memories should be durable), update document to match.

---

### 2. Short-term decay condition missing from action table (MEDIUM)

**Document shows** (line 95-96):
```
| short-term | promote → consolidating | — | keep (decay) |
```

**Code actually does** (`consolidation.ts` lines 183-210):
```typescript
case "short-term":
  if (score >= 0.7) {
    return { action: "promote" };
  } else if (daysSinceLastCheck >= 7) {  // ← TIME-GATED, not score-based!
    return { action: "decay" };
  } else {
    return { action: "keep" };
  }
```

An event with score < 0.7 but checked within the last 7 days will **keep** (not decay), even though the action table implies it should decay when score < 0.2.

The document's action table is incomplete — it only shows score-based conditions but short-term decay is **time-gated** (requires 7+ days since last check).

---

### 3. Forgotten events in consolidating stage produce duplicate result entries (MEDIUM)

**Code** (`consolidation.ts` lines 322-356):

```typescript
// Process consolidating events
for (const event of consolidatingEvents) {
  const result = determineConsolidationAction(event, now);
  results.push(result);  // ← Result always pushed

  if (result.action === "promote" && result.new_stage === "long-term") {
    // Move to neocortex
    promoted++;
  } else if (result.action === "forget") {
    event.consolidation.forgotten = true;
    event.consolidation.forgotten_at = now.toISOString();
    hippocampusStore.buffer = hippocampusStore.buffer.filter((e) => e.id !== event.id);
    forgotten++;
  } else if (result.action === "keep") {
    kept++;
  }
}
```

But line 322-324 filters events:
```typescript
const consolidatingEvents = hippocampusStore.buffer.filter(
  (e) => e.consolidation.stage === "consolidating" && !e.consolidation.forgotten
);
```

**Problem**: Forgotten events in `short-term` stage (line 296-304) get marked `forgotten = true` but remain in `hippocampusStore.buffer`. Then in the consolidating loop, they appear in `consolidatingEvents` because the filter only checks `!e.consolidation.forgotten` for consolidating-stage events, not short-term events.

Actually, looking more carefully — short-term events that are forgotten don't transition to consolidating stage (they're just marked forgotten and stay in buffer). Then on the next consolidation pass, they would be filtered out. But in the **current pass**, a forgotten short-term event's result is never pushed — only consolidating events have their results pushed at line 330.

Wait, let me re-check... Yes, short-term results are pushed at line 293 (in the first loop), and forgotten ones get `forgotten` flag but the result is still "forget" with a result entry. Then in the consolidating loop, forgotten short-term events are NOT included (the filter checks `e.consolidation.stage === "consolidating"`).

So the issue is: **forgotten short-term events are not removed from buffer in the first loop**. They remain and are only filtered out on the next consolidation pass. This causes no immediate harm but means `hippocampusStore.buffer` still contains forgotten events until the next pass.

**Fix**: Remove forgotten events from buffer immediately:
```typescript
case "forget":
  event.consolidation.forgotten = true;
  event.consolidation.forgotten_at = now.toISOString();
  hippocampusStore.buffer = hippocampusStore.buffer.filter(e => e.id !== event.id);  // Add this
  forgotten++;
  break;
```

---

### 4. Consolidation score applies decay factor before capping, not after (LOW — documentation gap)

**Document formula** (lines 84-91):
```
score = (intensity × 0.3) + (min(access_count × 0.05, 0.3)) + valence_bonus + recency_bonus
Final score × decay_factor, capped at 1.0
```

**Code** (`consolidation.ts` lines 153-154):
```typescript
score *= event.consolidation.decay_factor;
return Math.min(score, 1.0);  // Capped AFTER decay
```

The document wording "Final score × decay_factor, capped at 1.0" implies: `(base_score × decay_factor) capped at 1.0`. The code does exactly this. But the formula structure makes it look like the cap applies to `base_score` before multiplication.

This is a documentation clarity issue, not a code bug.

---

### 5. T14.9 doesn't test the threshold it claims to test (LOW)

**Test** (T14_decay.test.ts line 251-298):
Tests an event with score ~0.009 being forgotten. This passes whether threshold is 0.1 or 0.2.

**Document claims** (T14.9 row): "Very old low-intensity events forgotten"

This test doesn't distinguish between `score < 0.1` and `score < 0.2` for long-term forgetting because the test score (~0.009) is far below both thresholds.

**Recommendation**: Add a test with score between 0.1 and 0.2 to verify the actual threshold.

---

## Part 3: Integration Test Gaps

### Missing: Neocortex eviction when max_size_bytes exceeded

The code (`consolidation.ts` lines 365-379) evicts events when neocortex exceeds `max_size_bytes`. But T16 integration tests don't verify this behavior.

**Recommendation**: Add T16.12 to create enough neocortex events to exceed max_size_bytes and verify oldest low-intensity neutrals are evicted first.

---

### Missing: Consolidation report counters match actual actions

T16.10 tests `consolidate() creates neocortex if missing` but doesn't verify the report's `promoted`, `decayed`, `forgotten`, `kept` counters match the actual events processed.

---

### Missing: Forgotten events removed from hippocampus buffer

T16 doesn't verify that forgotten events are actually removed from `hippocampus.json` buffer after consolidation.

---

## Summary Table

| Issue | Severity | Location |
|-------|----------|----------|
| Long-term forget threshold: doc says 0.2, code uses 0.1 | **High** | consolidation.ts:241 vs doc line 95 |
| Short-term decay is time-gated, not shown in action table | **Medium** | consolidation.ts:194 vs doc line 95 |
| Forgotten short-term events not immediately removed from buffer | **Medium** | consolidation.ts:307-313 |
| Decay factor application documented ambiguously | **Low** | doc line 84-91 |
| T14.9 doesn't distinguish 0.1 vs 0.2 threshold | **Low** | T14_decay.test.ts |
| No neocortex eviction test | **Low** | T16 integration |

---

## Verdict

**Implementation** is 95% complete. Core logic (decay, scoring, stage transitions) is sound. The long-term threshold discrepancy is the most serious issue — it could lead to either data loss (if 0.2 is correct but 0.1 used) or memory bloat (if 0.1 is correct but 0.2 used).

**Test plan/results** is 80% complete. The tests pass but T14.9 doesn't actually validate the threshold it's named after. Integration tests are thin on eviction and buffer cleanup verification.

---

## Recommendations

1. **Resolve long-term threshold**: Decide if it should be 0.1 or 0.2. Recommend 0.1 (long-term memories are durable). Update document to match code.

2. **Update action thresholds table** to show `daysSinceLastCheck >= 7` condition for short-term decay.

3. **Fix buffer cleanup**: Remove forgotten events from hippocampusStore.buffer immediately, not on next pass.

4. **Add T16.12**: Neocortex eviction when max_size_bytes exceeded.

5. **Add T16.x**: Verify consolidation report counters match actual event state changes.

6. **Add a threshold boundary test**: Event with score 0.15 should or shouldn't be forgotten depending on chosen threshold.

---

*Generated: 2026-05-06*
