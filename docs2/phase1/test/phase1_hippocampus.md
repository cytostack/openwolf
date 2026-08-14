# Phase 1 Test Plan — Hippocampus Memory System

**Phase**: 1 (MVP)
**Status**: Implementation complete, testing pending
**Scope**: Types, core module, event-store, hook wiring, init integration
**Docs**: [PLAN.md](../PLAN.md), [../critic/2_CRITIC.md](../critic/2_CRITIC.md)

---

## Test Environment

```bash
# Work from a clean test project, not the openwolf repo itself
TEST_DIR=/tmp/openwolf-phase1-test
rm -rf $TEST_DIR && mkdir -p $TEST_DIR
cd $TEST_DIR

# Build openwolf first
cd /home/hangyu5/Documents/Gitrepo-My/AIResearchVault/repo/Agent/App/openwolf
pnpm build
```

---

## Test Matrix

### T1 — Build Integrity

| # | Check | Command | Expected |
|---|-------|---------|----------|
| T1.1 | `pnpm build` passes | `cd /home/hangyu5/.../openwolf && pnpm build` | Exit 0, no TS errors |
| T1.2 | `dist/bin/openwolf.js` exists | `ls dist/bin/openwolf.js` | File exists |
| T1.3 | `dist/hooks/post-write.js` compiled | `ls dist/hooks/post-write.js` | File exists |
| T1.4 | `dist/hooks/pre-read.js` compiled | `ls dist/hooks/pre-read.js` | File exists |
| T1.5 | `dist/src/hippocampus/` compiled | `ls dist/src/hippocampus/` | `index.js`, `types.js`, `event-store.js` exist |

**Pass criteria**: All 5 checks pass.

---

### T2 — `openwolf init` Creates hippocampus.json

| # | Check | Command | Expected |
|---|-------|---------|----------|
| T2.1 | `openwolf init` runs | `cd /tmp/openwolf-phase1-test && node /home/hangyu5/.../openwolf/dist/bin/openwolf.js init` | Exit 0, creates `.wolf/` |
| T2.2 | `.wolf/hippocampus.json` created | `cat /tmp/openwolf-phase1-test/.wolf/hippocampus.json` | Valid JSON, schema version 1 |
| T2.3 | hippocampus.json matches template | Compare with `src/templates/hippocampus.json` | Fields: version, buffer, stats, max_size_bytes=5000000 |
| T2.4 | hippocampus.json has correct project_root | `jq -r '.project_root' .wolf/hippocampus.json` | Absolute path to test dir |
| T2.5 | hippocampus.json has created_at | `jq -r '.created_at' .wolf/hippocampus.json` | ISO 8601 timestamp |

**Pass criteria**: All 5 checks pass.

---

### T3 — Event Store CRUD

Test file: `test/event-store.test.ts` (unit test, no runtime dependency)

| # | Check | What to test |
|---|-------|--------------|
| T3.1 | `createEmptyStore()` | Returns HippocampusStore with correct defaults |
| T3.2 | `createEmptyStore(projectRoot)` | project_root field set correctly |
| T3.3 | `loadStore()` returns null for missing file | Non-existent path returns null |
| T3.4 | `loadStore()` loads existing store | Round-trip: create → save → load → identical |
| T3.5 | `addEventToStore()` increments stats | neutral event → neutral_count++ |
| T3.6 | `addEventToStore()` handles trauma | trauma event → trauma_count++ |
| T3.7 | `addEventToStore()` evicts oldest non-trauma at buffer limit | Fill buffer, verify oldest non-trauma evicted |
| T3.8 | `addEventToStore()` never evicts trauma | Buffer full of trauma events → no eviction |
| T3.9 | `getEventsByLocation()` | Filters events by file path |
| T3.10 | `getTraumaEvents()` | Returns only valence=trauma events |
| T3.11 | `getTraumaEventsForPath()` | Returns trauma events for specific file |
| T3.12 | `filterEvents()` by valence | Filters correctly |
| T3.13 | `filterEvents()` by min_intensity | Filters correctly |
| T3.14 | `filterEvents()` by max_age_days | Filters correctly |

**Pass criteria**: All 14 checks pass.

---

### T4 — Hippocampus Class

Test file: `test/hippocampus.test.ts`

| # | Check | What to test |
|---|-------|--------------|
| T4.1 | Constructor sets projectRoot + hippocampusPath | Path is `<projectRoot>/.wolf/hippocampus.json` |
| T4.2 | `addEvent()` auto-generates id | ID format `evt-<uuid>` |
| T4.3 | `addEvent()` sets consolidation defaults | stage=short-term, decay_factor=1.0 |
| T4.4 | `addEvent()` persists to disk | Event visible after re-instantiating Hippocampus |
| T4.5 | `addEvent()` updates stats | total_events increments |
| T4.6 | `getTraumas()` without arg | Returns all trauma events |
| T4.7 | `getTraumas(filePath)` | Returns only traumas for that path |
| T4.8 | `getRecentEvents(limit)` | Returns events sorted by timestamp desc |
| T4.9 | `getEvents(filters)` | Delegates to filterEvents |
| T4.10 | `getStats()` | Returns HippoStats shape |
| T4.11 | `exists()` true when file exists | After init |
| T4.12 | `exists()` false when file missing | Before init or wrong path |

**Pass criteria**: All 12 checks pass.

---

### T5 — post-write.ts Hook Wiring (addEvent)

Runtime test: requires openwolf hooks configured.

| # | Check | Steps |
|---|-------|-------|
| T5.1 | New file write creates event | `echo '// test' > src/test.ts`, then inspect `.wolf/hippocampus.json` buffer |
| T5.2 | Event has correct action.type | Should be `"write"` for new files |
| T5.3 | Event has correct valence | New file = `"neutral"` |
| T5.4 | Event has spatial_path | Derived from file path |
| T5.5 | 3rd edit to same file sets valence=trauma | Edit same file 3× → intensity increases |
| T5.6 | Hippocampus failures are silent | Hook does not crash/stderr on hippocampus errors |

**Pass criteria**: T5.1–T5.5 pass with correct values in hippocampus.json; T5.6 confirms no stderr from hippocampus path.

---

### T6 — pre-read.ts Hook Wiring (Trauma Warnings)

| # | Check | Steps |
|---|-------|-------|
| T6.1 | No warning for file with no trauma | Read any file not in trauma list → no warning |
| T6.2 | Warning printed to stderr for traumatized file | Edit a file 3× (creates trauma), then read it → stderr contains warning |
| T6.3 | Warning includes intensity | Stderr mentions intensity ≥ 0.6 |
| T6.4 | Warning is silent on hippocampus errors | pre-read does not crash if hippocampus throws |

**Pass criteria**: T6.1–T6.4 pass.

---

### T7 — Valence Detection Accuracy

| # | Check | Steps | Expected |
|---|-------|-------|----------|
| T7.1 | New file = neutral | Write new file | valence=neutral, intensity=0.3 |
| T7.2 | First edit = neutral | Edit existing file once | valence=neutral, intensity=0.3 |
| T7.3 | 3rd+ edit = trauma | Edit same file 3 times in session | valence=trauma, intensity≥0.6 |
| T7.4 | is_recurring set correctly | After 3rd edit | is_recurring=true |

**Pass criteria**: All 4 valence mappings correct.

---

### T8 — Buffer Eviction

| # | Check | Steps | Expected |
|---|-------|-------|----------|
| T8.1 | Max buffer size enforced | Add >500 events | Buffer stays at 500 |
| T8.2 | Trauma events survive eviction | After 500+ events | All trauma events still present |
| T8.3 | Oldest non-trauma evicted first | Check oldest_event in stats | Trauma oldest_event unchanged |

**Pass criteria**: All 3 checks pass.

---

## Defect Log

| # | Severity | Description | Status |
|---|----------|-------------|--------|
| — | — | No defects logged yet | — |

---

## Sign-off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Implementor | — | 2026-05-06 | — |
| Tester | — | — | — |
