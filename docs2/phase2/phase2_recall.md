# Phase 2: Basic Recall — Implementation Spec

> **Status**: ✅ Implemented | Tests pending
> **Parent**: [PLAN.md](../PLAN.md)
> **Goal**: Implement cue-based recall with scoring algorithm
> **Design Docs**: [02-cue-system.md](../02-cue-system.md), [04-implementation-spec.md](../04-implementation-spec.md)

---

## Overview

Phase 2 adds recall capability — given a cue (location, question, or state), find relevant past events and return them scored by relevance.

### Key Components

1. **Cue Index** — Pre-computed `.wolf/cue-index.json` for fast path → event lookup
2. **Recall API** — `Hippocampus.recall()` with scoring algorithm
3. **CLI Command** — `openwolf recall <query>` for manual testing

---

## Implementation Status

| Component | Status | Notes |
|-----------|--------|-------|
| Cue Index Types | ✅ Done | Added to `types.ts` |
| cue-index.ts | ✅ Done | Full CRUD + batch persist |
| cue-recall.ts | ✅ Done | Scoring + location matching |
| Hippocampus.recall() | ✅ Done | Integrated in index.ts |
| pre-write hook | ✅ Done | Trauma warnings |
| CLI recall | ✅ Done | Registered in index.ts |
| cue-index.json template | ✅ Done | Added to templates/ |
| init.ts wiring | ✅ Done | cue-index.json in CREATE_IF_MISSING |
| T9-T12 tests | ⏳ Pending | Not yet written |

---

## Phase 2.1 — Cue Index System ✅

### File: `src/hippocampus/cue-index.ts`

**Functions:**

```typescript
export interface CueIndex {
  version: 1;
  last_updated: string;
  location_index: Record<string, string[]>;
  tag_index: Record<string, string[]>;
  trauma_index: {
    all_trauma_ids: string[];
    by_path: Record<string, string[]>;
  };
}

export function buildIndex(events: WolfEvent[]): CueIndex
export function loadIndex(hippocampusPath: string): CueIndex | null
export function saveIndex(hippocampusPath: string, index: CueIndex): void
export function addEventToIndex(index: CueIndex, event: WolfEvent): void
export function removeEventFromIndex(index: CueIndex, eventId: string): void
export function createEmptyIndex(): CueIndex
export function getCueIndexPath(projectRoot: string): string
export function indexNeedsRebuild(index: CueIndex | null, eventCount: number): boolean
```

### Template: `src/templates/cue-index.json`

```json
{
  "version": 1,
  "last_updated": "",
  "location_index": {},
  "tag_index": {},
  "trauma_index": {
    "all_trauma_ids": [],
    "by_path": {}
  }
}
```

### Index Update Strategy

- **Real-time**: On every `addEvent()`, update index in-memory via `addEventToIndex()`
- **Batch persist**: Every 10 events, write index to disk
- **On load**: If index doesn't exist or is stale, build from scratch via `buildIndex()`

**Durability Trade-off**: Disk persistence lags in-memory by up to 9 events. If process crashes between batch writes, those events survive in the event store but index rebuild may temporarily miss them. On next load, index is verified via `indexNeedsRebuild()` and rebuilt if needed.

### Wire into init.ts

Added `cue-index.json` to `CREATE_IF_MISSING` array in init.ts. Now creates 15 files instead of 14.

---

## Phase 2.2 — Recall API ✅

### New Types: `src/hippocampus/types.ts`

```typescript
export type CueType = "location" | "question" | "state";
export type LocationMatchMode = "exact" | "prefix" | "glob" | "parent" | "sibling";

export interface LocationCue {
  type: "location";
  path: string | string[];
  match_mode?: LocationMatchMode;
}

export interface QuestionCue {
  type: "question";
  query: string;
  entities?: string[];
  question_type?: QuestionType;
}

export interface StateCue {
  type: "state";
  goal?: string;
  error?: { type: string; message: string; file?: string; line?: number; };
  turn_count: number;
}

export type Cue = LocationCue | QuestionCue | StateCue;

export interface RecallRequest {
  cue: Cue;
  filters?: RecallFilters;
  limit?: number;
  offset?: number;
}

export interface MatchDetail {
  event_id: string;
  confidence: number;
  match_reasons: string[];
}

export interface RecallResponse {
  events: WolfEvent[];
  total_matches: number;
  confidence: number;
  match_details: MatchDetail[];
}
```

### Scoring Algorithm

| Factor | Weight | Description |
|--------|--------|-------------|
| Location match | 55% | How well event location matches cue |
| Recency | 20% | Exponential decay, half-life 30 days |
| Valence match | 15% | Boost if matching requested valence |
| Intensity | 10% | Higher intensity = higher relevance |

### Hippocampus.recall() Method

```typescript
recall(request: RecallRequest): RecallResponse {
  const store = this.ensureLoaded();
  const index = this.ensureIndexLoaded();
  return recallEvents(store.buffer, request.cue, request, index);
}
```

---

## Phase 2.3 — Location Match Modes ✅

File: `src/hippocampus/cue-recall.ts`

```typescript
export function scoreLocationMatch(event: WolfEvent, cue: LocationCue): number {
  const eventPaths = Array.from(new Set(event.context.files_involved));
  const cuePaths = Array.isArray(cue.path) ? cue.path : [cue.path];
  const matchMode = cue.match_mode || "exact";

  switch (matchMode) {
    case "exact":
      return cuePaths.some((p) => eventPaths.includes(p)) ? 1.0 : 0.0;
    case "prefix":
      return cuePaths.some((cp) =>
        eventPaths.some((ep) => ep.startsWith(cp))
      ) ? 0.8 : 0.0;
    case "glob":
      return cuePaths.some((pattern) =>
        eventPaths.some((ep) => matchGlob(ep, pattern))
      ) ? 0.9 : 0.0;
    case "parent":
      return cuePaths.some((cp) => {
        const parents = getParentDirectories(cp);
        return eventPaths.some((ep) =>
          parents.some((parent) => ep.startsWith(parent))
        );
      }) ? 0.7 : 0.0;
    case "sibling":
      return cuePaths.some((cp) => {
        const cueDir = getDirectory(cp);
        return eventPaths.some((ep) => getDirectory(ep) === cueDir);
      }) ? 0.6 : 0.0;
    default:
      return 0.0;
  }
}
```

**Helper functions:**

```typescript
export function computeRecencyScore(timestamp: string): number  // exp decay, half-life 30 days
export function matchGlob(filePath: string, pattern: string): boolean  // glob to regex
export function getParentDirectories(filePath: string): string[]  // ["src/auth/", "src/"]
export function getDirectory(filePath: string): string  // path.dirname
export function parseErrorType(errorMessage: string): string  // "TypeError:..." -> "TypeError"
```

---

## Phase 2.4 — State Cue Integration ✅

Error pattern matching implemented via `parseErrorType()`. State cue currently returns events filtered by error type when provided.

---

## Phase 2.5 — Enhance pre-write Hook ✅

File: `src/hooks/pre-write.ts`

```typescript
function checkHippocampus(wolfDir: string, filePath: string): void {
  const hippocampusPath = path.join(wolfDir, "hippocampus.json");
  if (!fs.existsSync(hippocampusPath)) return;

  try {
    const projectRoot = path.dirname(wolfDir);
    const hippocampus = new Hippocampus(projectRoot);
    const traumas = hippocampus.getTraumas(filePath);
    const highIntensity = traumas.filter(t => t.outcome.intensity >= 0.6);

    if (highIntensity.length > 0) {
      process.stderr.write(
        `\n⚠️ OpenWolf: ${highIntensity.length} high-intensity trauma(s) in ${path.basename(filePath)}\n`
      );
      for (const trauma of highIntensity.slice(0, 3)) {
        process.stderr.write(
          `   [${trauma.outcome.intensity.toFixed(1)}] "${trauma.outcome.reflection}"\n`
        );
      }
    }
  } catch {
    // Hippocampus errors should be silent
  }
}
```

---

## Phase 2.6 — CLI: `openwolf recall` ✅

File: `src/cli/recall.ts`

```bash
# Usage
openwolf recall "src/auth/middleware.ts"       # Location cue (default)
openwolf recall --type location src/            # Prefix match
openwolf recall --type question "JWT errors"   # Question cue
openwolf recall --type state --error "TypeError" # State cue with error
openwolf recall --json                        # JSON output
openwolf recall --limit 10                    # Max results
openwolf recall --match-mode parent           # Match mode
```

### Output Format

```
Found 3 matching event(s) (avg confidence: 87%)

1. [trauma 0.9] src/auth/middleware.ts
   "Using var caused scope leak" (3 days ago)
   Match: exact path match, high intensity

2. [trauma 0.7] src/auth/middleware.ts
   "Config reads cfg.talk not cfg.tts" (12 days ago)
   Match: exact path match
```

---

## File Changes

### Modified Files
- `src/cli/init.ts` — ✅ Added cue-index.json to CREATE_IF_MISSING
- `src/hippocampus/types.ts` — ✅ Added Cue/Recall types
- `src/hippocampus/index.ts` — ✅ Added recall() method, batch persist, ensureIndexLoaded()
- `src/hooks/pre-write.ts` — ✅ Added checkHippocampus() call

### New Files
- `src/hippocampus/cue-index.ts` — ✅ CueIndex CRUD + batch persist
- `src/templates/cue-index.json` — ✅ Template
- `src/cli/recall.ts` — ✅ Recall CLI command
- `src/hippocampus/cue-recall.ts` — ✅ Recall algorithm + scoring

### Test Files (Pending)
- `docs2/phase2/test/T9_cue-index.test.ts` — ⏳
- `docs2/phase2/test/T10_recall.test.ts` — ⏳
- `docs2/phase2/test/T11_recall-cli.test.sh` — ⏳
- `docs2/phase2/test/T12_integration.sh` — ⏳

---

## Verification

```bash
# Build
pnpm build

# CLI test
openwolf recall --help
openwolf recall src/hooks/post-write.ts

# Integration (manual)
cd /tmp/test-project
openwolf init
echo '// test' > src/test.ts
openwolf recall --type location src/test.ts
```

---

## Notes

1. **Performance**: Index stays in memory during session; persists batch-wise every 10 events
2. **Score capping**: All scores capped at 1.0
3. **Fallback**: If index missing or corrupted, build on-demand from scratch
4. **Index corruption**: On load, verify index via `indexNeedsRebuild()`; rebuild if stale
5. **Valence taxonomy**: Phase 1 only generates neutral/trauma; penalty/reward in Phase 3
6. **Semantic similarity**: Phase 3 feature; not in Phase 2 scope
