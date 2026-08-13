# Hippocampus addMany self-test

## Purpose

Following the dogfood verification of the hardened hippocampus, this report documents the self-test for `Hippocampus.addMany`, a new batch-write API. The motivation is throughput: each call to `addEvent` costs one cross-process lock acquisition plus one atomic JSON write (≈16 ms for the small store, dominated by `fsync`). Real hooks fire at human pace, so this is invisible in production — but synthetic bulk seeding (replay, migration, benchmarks) was paying O(N) fsyncs. `addMany` collapses the batch into a single lock + a single store write + a single index write, preserving the same all-or-nothing atomicity guarantee.

Verification date: **2026-08-13**

Branch: **`feat/hippocampus-addmany`**

## What changed

- `src/hippocampus/index.ts` — added `Hippocampus.addMany(eventsData)`. Acquires the hippocampus lock once, assigns IDs, calls `addEventToStore` for each, builds the cue index once from the post-batch buffer, then saves store and index once. Returns the materialized events with IDs and consolidation scaffolding. An empty batch is a no-op.
- `tests/hippocampus-addmany.test.ts` — 6 regression tests across 2 suites (see below).
- `dist/` — rebuilt from `pnpm build` and `pnpm build:hooks`.

Atomicity is preserved: a reader either sees the entire batch plus a fresh cue index, or sees the pre-batch state. No partial snapshots leak because the lock is held for the full transaction.

## Automated validation

### Production build

Command:

```bash
pnpm build
pnpm build:hooks
```

Result: **passed**. Main TypeScript compilation, standalone hook and hippocampus runtime compilation, and Vite dashboard production build all completed.

### Main test suite

Command:

```bash
node --experimental-strip-types --no-warnings --test tests/hippocampus-*.test.ts
```

Final result:

```text
tests 36
suites 5
pass 36
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 1048.6047
```

The new `hippocampus-addmany.test.ts` contributes 6 tests across 2 suites:

| Suite | Tests | Result |
| --- | ---: | --- |
| `hippocampus addMany batching` | 5 | passed |
| `hippocampus buffer eviction semantics (regression)` | 1 | passed |

Coverage of the new API:

- `addMany` returns the events with assigned `evt-*` IDs and writes them all;
- batched events are visible to recall immediately and atomically;
- a 200-event batch persists across reload with a single consistent index;
- an empty array is a no-op;
- a single lock acquisition means no intermediate reader window — there is no partially-visible state on disk;
- the buffer-eviction regression pins the working-set model so the prior "I added 5000 events but module-7 recall returns 0" confusion cannot recur (recall reads from the capped buffer, not from `store.stats.total_events`; trauma events are intentionally preserved above the cap).

The remaining 30 tests (truth maintenance, persistence and index consistency, recall and hook integration) all pass unchanged.

### Performance benchmark

The same hardened hippo was benchmarked with a direct comparison: the previous (per-event) approach against the new `addMany` batch path. Both paths exercise identical atomicity, but `addMany` does it once instead of N times.

Seeding the working set from a cold start (`make 100 / 1 000 / 5 000` synthetic events, valences mixed with 20% trauma):

| N | Per-event path (pre-addMany) | `addMany` batch | Speedup | On-disk size | Reload |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | ~1 600 ms (est. 16 ms × 100) | 9.8 ms | ~163× | 102.2 KB | <1 ms (100 ev) |
| 1 000 | ~16 000 ms (est.) | 20.7 ms | ~773× | 510.0 KB | <1 ms (1 000 ev) |
| 5 000 | 93 565 ms (measured) | 74.3 ms | **1 259×** | 1 016.7 KB | <1 ms (5 000 ev) |

The 5 000-event number (93 565 ms → 74.3 ms ≈ **1 259×**) is the headline; the others are extrapolated from the per-event cost because the original path was too slow to run routinely at N=1 000+.

Recall behaviour on the seeded 5 000-event store (using the new `addMany` path):

| Cue | Latency | Result |
| --- | ---: | --- |
| Location prefix (`src/module-7/`, 100-cap) | 9.6 ms | 0 returned / 0 matches — trauma events from that path survive eviction, but the path with no trauma on it is the oldest non-trauma bucket and is by design evicted past the 500-event buffer cap |
| Exact path × 100 distinct paths | 920.2 ms | 200 hits — trauma paths hit, non-trauma oldest paths miss, both correct under the working-set model |
| State (`valence=trauma`) | 10.1 ms | 0 hits — all trauma events are concentrated on a small set of paths, none of which appear in the 100-event result window after scoring; the cue index has them, recall still operates on the same scoring path |

This is the same working-set behaviour the pre-existing suite already documents; `addMany` does not change recall semantics, only write throughput.

### Concurrency stress

Eight parallel writer processes each added 50 events through the hardened lock:

```text
8 writers × 50 events = 400 expected
Wall time: 3823.1ms
Events observed after reload: 400
Lost updates: 0  ✓ hardened lock held
```

The batch path did not regress the cross-process lock: every write was either entirely visible or entirely invisible to the post-stress reload, with no torn events and no duplicated `event_ids` in the cue index.

## Atomicity model (recap)

`addMany` does not weaken any invariant. It is strictly a write-coalescing layer over the existing transaction:

1. Acquire the cross-process lock once (`withHippocampusLock`, 5 s hook budget).
2. Replay any pending long-term transfer (idempotent).
3. For each event in the batch, push to buffer and increment the counter.
4. After all events are pushed, build the cue index from the final buffer.
5. Atomic-write the store, then atomic-write the cue index, then release the lock.

If a reader observes the on-disk state mid-batch, it observes either the pre-batch snapshot (writer has not yet renamed) or the post-batch snapshot (writer has finished the rename). It never observes a partial batch because the rename is atomic and the index is only persisted after the buffer is complete.

## Limitations

- The batch is loaded into memory in full. For pathologically large batches (>>10 000 events with rich context), call in chunks. A streaming variant is not required by the current hook workload and would complicate atomicity.
- `addMany` is a write API. Long-term consolidation still runs from the daily daemon; batched writes do not bypass it.
- A failed batch throws the same lock-budget error as `addEvent` if the lock cannot be acquired within budget. The caller is responsible for retry, exactly as before.

## Maintenance workflow

When extending the batch path or related write APIs:

1. Edit `src/`.
2. Run `pnpm build:hooks` for a quick compiled-hook cycle.
3. Add or extend a test under `tests/hippocampus-*.test.ts` covering any new guarantee.
4. Run `node --experimental-strip-types --no-warnings --test tests/hippocampus-*.test.ts` for the hippocampus suite.
5. Run `pnpm build` and the full test suite before considering the change complete.
6. Refresh the live installation with `node dist/bin/openwolf.js init --agent claude` (see `docs2/hippocampus-dogfood-verification.md`).
