# Phase 2 — Hippocampus Usage Learnings

> **Date**: 2026-05-06
> **Source**: Live demo session testing hippocampus tracking

---

## Live Demo Results

### Setup
- Demo project at `/tmp/openwolf-hippocampus-demo`
- 2 files: `src/utils/auth.ts` (trauma), `src/utils/logger.ts` (neutral)
- 6 total events captured

### Events Captured

| File | Valence | Intensity | Reflection |
|------|---------|-----------|------------|
| `src/utils/auth.ts` | trauma | 0.9 | "File edited 4 times" |
| `src/utils/auth.ts` | trauma | 0.9 | "File edited 3 times" |
| `src/utils/auth.ts` | neutral | 0.3 | "Edited 3 time(s)" |
| `src/utils/auth.ts` | neutral | 0.3 | "Created..." |
| `src/utils/logger.ts` | neutral | 0.3 | "Edited..." |
| `src/utils/logger.ts` | neutral | 0.3 | "Created..." |

**Trauma detection**: Files edited 3+ times are flagged as trauma with intensity 0.9.

---

## Key Learnings

### 1. Absolute Paths Required in CLI

**Issue**: `openwolf recall src/utils/auth.ts` returns 0 events.

**Root cause**: Events store **absolute paths** (e.g., `/tmp/.../src/utils/auth.ts`), but CLI passes the query path directly to the recall function without resolving relative paths.

**Fix**: Use absolute paths:
```bash
openwolf recall /tmp/openwolf-hippocampus-demo/src/utils/auth.ts
```

This is a **UX limitation**, not a test failure. The test suite uses absolute paths throughout.

---

### 2. D3 — Index Batch Persist (BATCH_SIZE=10)

**Issue**: `cue-index.json` may not exist after fewer than 10 events.

**Root cause**: Each hook call creates a new `Hippocampus` instance. The index is rebuilt in-memory but persisted to disk only every `BATCH_SIZE=10` events.

**Workaround**: Recall automatically rebuilds the index if `cue-index.json` is missing or stale. The rebuild reads from `hippocampus.json` buffer.

**Verification**:
```bash
# Index not yet persisted (only 6 events)
ls .wolf/cue-index.json  # May not exist

# Recall triggers automatic rebuild
openwolf recall /path/to/file

# Now index exists
ls .wolf/cue-index.json  # Created by rebuild
```

---

### 3. D4 — Parent Match Mode Broken

**Issue**: `--match-mode parent` returns 0 events even when matching events exist.

**Root cause**: `getLocationCandidateIds()` does exact key lookup on `index.location_index`:
```typescript
// Buggy code
case "parent":
  for (const parent of getParentDirectories(path)) {
    const pathIds = index.location_index[parent]; // Exact key lookup
    // index keys are full paths like "/src/auth/middleware.ts"
    // looking up "/src/" returns nothing
  }
```

**Fix**: Use prefix matching against index keys:
```typescript
case "parent":
  for (const [idxPath, pathIds] of Object.entries(index.location_index)) {
    if (getParentDirectories(path).some(p => idxPath.startsWith(p))) {
      pathIds.forEach(id => ids.add(id));
    }
  }
```

**Workaround**: Use `--match-mode prefix` or `--match-mode exact` instead.

---

### 4. Prefix Match Works Correctly

**Verified working**:
```bash
openwolf recall --match-mode prefix /tmp/project/src/
# Returns all events for files under src/
```

The prefix match correctly finds all indexed paths that start with the query path.

---

## Hippocampus Architecture

```
.hippocampus.json       .cue-index.json
┌─────────────────┐     ┌─────────────────────┐
│ buffer: [       │     │ location_index: {   │
│   event 1,      │     │   "/path/file.ts":  │
│   event 2,      │────▶│     [evt_id, ...]   │
│   ...           │     │ },                   │
│ ]               │     │ tag_index: { ... }, │
│ stats: {        │     │ trauma_index: {     │
│   trauma: 2,    │     │   by_path: { ... }  │
│   neutral: 4   │     │ }                    │
│ }               │     └─────────────────────┘
└─────────────────┘
```

- **hippocampus.json**: Raw event store, always persisted immediately
- **cue-index.json**: Fast lookup index, persisted every 10 events (or rebuilt on load)

---

## Verified Commands

```bash
# Initialize a new project
node dist/bin/openwolf.js init

# Create/edit files (hooks capture automatically)
echo '// code' > src/file.ts
# ... edit 3+ times for trauma

# Recall with absolute path
openwolf recall /absolute/path/to/file

# Prefix match (all files under directory)
openwolf recall --match-mode prefix /path/to/src/

# JSON output
openwolf recall --json /path/to/file

# Limit results
openwolf recall --limit 3 /path/to/file
```

---

## Verification of Working Features

| Feature | Status |
|---------|--------|
| Event capture (Write/Edit hooks) | ✅ Working |
| Valence detection (trauma vs neutral) | ✅ Working |
| Intensity scoring | ✅ Working |
| Cue index build/rebuild | ✅ Working |
| Exact match recall | ✅ Working |
| Prefix match recall | ✅ Working |
| CLI text output | ✅ Working |
| CLI JSON output | ✅ Working |
| Parent match recall | ❌ Broken (D4) |
| Batch persist (< 10 events) | ⚠️ Workaround needed (D3) |

---

## File Reference

- Source: `src/hippocampus/index.ts`, `src/hippocampus/cue-recall.ts`, `src/hippocampus/cue-index.ts`
- CLI: `src/cli/recall.ts`
- Hook: `src/hooks/post-write.ts`

---

*Last updated: 2026-05-06*
