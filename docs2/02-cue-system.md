# Cue System — Location, Question, and State Triggers

> **Parent**: [00-hippocampus-memory-system.md](./00-hippocampus-memory-system.md)
> **Purpose**: Define how cues trigger memory retrieval and the matching algorithm

---

## 1. Cue Types Overview

| Cue Type | Trigger | Example |
|----------|---------|---------|
| **Location** | File path or directory | `src/auth/middleware.ts` |
| **Question** | Natural language query | "How do I add a new route?" |
| **State** | Current context/error | `TypeError: Cannot read property 'map' of undefined` |

Cues are not exact-match. They use **similarity search** to find semantically related events.

---

## 2. Location Cue

### 2.1 Location Cue Schema

```typescript
interface LocationCue {
  type: "location";
  path: string | string[];      // File or directory path(s)
  match_mode: "exact" | "prefix" | "glob" | "parent" | "sibling";

  // Spatial hierarchy traversal
  include_parents?: boolean;     // Also search parent directories
  include_children?: boolean;    // Also search subdirectories
  max_depth?: number;            // Limit traversal depth
}
```

### 2.2 Match Modes

| Mode | Description | Example Query | Matches |
|------|-------------|---------------|---------|
| `exact` | Single file | `src/auth/middleware.ts` | Only that exact file |
| `prefix` | Path prefix | `src/auth/` | All files under `src/auth/` |
| `glob` | Glob pattern | `src/**/*.test.ts` | All test files under src |
| `parent` | Parent chain | `src/auth/middleware.ts` | `src/auth/`, `src/`, root |
| `sibling` | Same directory | `src/auth/middleware.ts` | All files in `src/auth/` |

### 2.3 Location Cue Examples

```typescript
// "What happened when I edited src/auth/middleware.ts?"
const cue1: LocationCue = {
  type: "location",
  path: "src/auth/middleware.ts",
  match_mode: "exact"
};

// "What do I know about the src/api/ directory?"
const cue2: LocationCue = {
  type: "location",
  path: "src/api/",
  match_mode: "prefix"
};

// "Any events related to files in src/ that start with auth?"
const cue3: LocationCue = {
  type: "location",
  path: "src/auth*",
  match_mode: "glob"
};
```

---

## 3. Question Cue

### 3.1 Question Cue Schema

```typescript
interface QuestionCue {
  type: "question";
  question_type: "how-to" | "why-not" | "what-if" | "what-happened" | "general";

  // The actual question
  query: string;

  // Extracted entities for matching
  entities?: string[];           // Nouns extracted: ["JWT", "validation", "middleware"]
  action?: string;               // Verb: "add", "fix", "remove"

  // Scope
  project_scope?: boolean;       // Limit to current project context
  global_scope?: boolean;        // Include generic knowledge
}
```

### 3.2 Question Types

| Type | Intent | Example Query | Recall Behavior |
|------|--------|---------------|-----------------|
| `how-to` | Procedure request | "How do I add a new API endpoint?" | Find similar `execute`/`write` events |
| `why-not` | Failure analysis | "Why isn't the build passing?" | Find `penalty`/`trauma` events with errors |
| `what-if` | Risk assessment | "What if I refactor all of src/api?" | Find any events in that scope |
| `what-happened` | Past inquiry | "What happened with the auth middleware?" | Find most recent events with location |
| `general` | Unstructured | "Any issues with JWT recently?" | Broad similarity search |

### 3.3 Entity Extraction

```typescript
// Question: "How do I add JWT validation to the auth middleware?"
const question: QuestionCue = {
  type: "question",
  question_type: "how-to",
  query: "How do I add JWT validation to the auth middleware?",
  entities: ["JWT", "validation", "auth middleware"],
  action: "add"
};

// System should find events where:
// - action.type includes "write" or "execute"
// - entities JWT/validation appear in context or reflection
// - location includes auth middleware files
```

---

## 4. State Cue

### 4.1 State Cue Schema

```typescript
interface StateCue {
  type: "state";

  // Current context
  goal?: string;                 // What user is trying to do
  error?: {
    type: string;                // "TypeError", "ReferenceError", etc.
    message: string;
    stack?: string;
    file?: string;
    line?: number;
  };

  // Session state
  turn_count: number;
  recent_valence: ("reward" | "neutral" | "penalty" | "trauma")[];  // Last N outcomes

  // File state
  files_modified_this_session: string[];
  files_read_this_session: string[];
}
```

### 4.2 State Cue Examples

```typescript
// "User just got a TypeError in useEffect"
const cue1: StateCue = {
  type: "state",
  error: {
    type: "TypeError",
    message: "Cannot read properties of undefined (reading 'map')",
    file: "src/components/UserList.tsx",
    line: 42
  },
  goal: "Fix the UserList component",
  turn_count: 18,
  recent_valence: ["penalty", "penalty"]  // Two failures in a row
};

// System should recall:
// - Events with similar error messages
// - Events in UserList.tsx or similar components
// - Events with null/undefined issues
// - High intensity trauma events if recent failures
```

---

## 5. Cue Index

For fast retrieval, a pre-computed index maps cues to event IDs.

### 5.1 Index Schema

File: `.wolf/cue-index.json`

```typescript
interface CueIndex {
  version: 1;
  last_updated: string;          // ISO8601

  // === LOCATION INDEX ===
  location_index: {
    // path -> event IDs
    [path: string]: string[];   // sorted by recency
  };

  // === TAG INDEX ===
  tag_index: {
    // tag -> event IDs
    [tag: string]: string[];
  };

  // === PATTERN INDEX ===
  pattern_index: {
    // entity -> event IDs (stemmed/normalized)
    [entity: string]: string[];
  };

  // === ERROR INDEX ===
  error_index: {
    // error_type -> event IDs
    [errorType: string]: string[];
  };

  // === TRAUMA INDEX (fast track for warnings) ===
  trauma_index: {
    all_trauma_ids: string[];     // Sorted by intensity desc
    by_path: {
      [path: string]: string[]; // Traumas affecting this path
    };
  };
}
```

### 5.2 Index Build Process

```typescript
function buildIndex(events: WolfEvent[]): CueIndex {
  const index: CueIndex = {
    version: 1,
    last_updated: new Date().toISOString(),
    location_index: {},
    tag_index: {},
    pattern_index: {},
    error_index: {},
    trauma_index: { all_trauma_ids: [], by_path: {} }
  };

  for (const event of events) {
    // Location index
    for (const file of event.context.files_involved) {
      if (!index.location_index[file]) index.location_index[file] = [];
      index.location_index[file].push(event.id);
    }

    // Tag index
    for (const tag of event.tags) {
      if (!index.tag_index[tag]) index.tag_index[tag] = [];
      index.tag_index[tag].push(event.id);
    }

    // Error index
    if (event.action.error_message) {
      const errType = parseErrorType(event.action.error_message);
      if (!index.error_index[errType]) index.error_index[errType] = [];
      index.error_index[errType].push(event.id);
    }

    // Trauma fast-track
    if (event.outcome.valence === "trauma") {
      index.trauma_index.all_trauma_ids.push(event.id);
      for (const file of event.context.files_involved) {
        if (!index.trauma_index.by_path[file]) {
          index.trauma_index.by_path[file] = [];
        }
        index.trauma_index.by_path[file].push(event.id);
      }
    }
  }

  // Sort all arrays by recency (most recent first)
  // ... sorting logic

  return index;
}
```

---

## 6. Recall Algorithm

### 6.1 Recall Request/Response

```typescript
interface RecallRequest {
  cue: LocationCue | QuestionCue | StateCue;

  filters?: {
    valence?: ("reward" | "penalty" | "trauma")[];
    min_intensity?: number;      // 0.0-1.0
    max_age_days?: number;
    tags?: string[];
    exclude_forgotten?: boolean;  // Default true
  };

  limit?: number;                // Max events to return, default 5
  offset?: number;               // For pagination
}

interface RecallResponse {
  events: WolfEvent[];
  total_matches: number;
  confidence: number;            // 0.0-1.0 overall confidence
  match_details: {
    event_id: string;
    confidence: number;          // Per-event confidence
    match_reasons: string[];      // Why this event matched
  }[];
}
```

### 6.2 Recall Flow

```
[RecallRequest arrives]
    ↓
[Parse cue type]
    ↓
[Query cue-index.json for candidate event IDs]
    ↓
[Load candidate events from storage]
    ↓
[Apply filters]
    ↓
[Score by relevance]
    ↓
[Return top-N with confidence scores]
```

### 6.3 Scoring Algorithm

```typescript
function scoreEvent(event: WolfEvent, cue: Cue, request: RecallRequest): number {
  let score = 0.0;

  // === LOCATION MATCH (most important) ===
  if (cue.type === "location") {
    const locScore = scoreLocationMatch(event, cue);
    score += locScore * 0.4;  // 40% weight
  }

  // === SIMILARITY MATCH ===
  if (cue.type === "question") {
    const simScore = scoreSemanticSimilarity(event, cue);
    score += simScore * 0.3;  // 30% weight
  }

  // === RECENCY BOOST ===
  const daysSinceEvent = daysAgo(event.timestamp);
  const recencyScore = Math.exp(-daysSinceEvent / 30);  // Exponential decay, half-life 30 days
  score += recencyScore * 0.15;  // 15% weight

  // === VALENCE RELEVANCE ===
  if (request.filters?.valence?.includes(event.outcome.valence)) {
    score += 0.1;  // Boost for matching requested valence
  }

  // === TRAUMA RELEVANCE ===
  if (event.outcome.valence === "trauma") {
    score += event.outcome.intensity * 0.1;  // Higher intensity = more relevant
  }

  // === CONSOLIDATION BOOST ===
  if (event.consolidation.stage === "long-term") {
    score *= 1.1;  // 10% boost for consolidated memories
  }

  // === PENALTY FOR RECURRING ===
  if (event.outcome.is_recurring) {
    score *= 0.95;  // Slight penalty - recurring might mean we need new approach
  }

  return Math.min(1.0, score);
}

function scoreLocationMatch(event: WolfEvent, cue: LocationCue): number {
  const eventPaths = new Set(event.context.files_involved);

  switch (cue.match_mode) {
    case "exact":
      return cue.path.some(p => eventPaths.has(p)) ? 1.0 : 0.0;

    case "prefix":
      return eventPaths.some(ep =>
        cue.path.some(cp => ep.startsWith(cp))
      ) ? 0.8 : 0.0;

    case "parent":
      // Check if any event file is a parent of cue path
      return eventPaths.some(ep =>
        cue.path.some(cp => cp.startsWith(ep))
      ) ? 0.7 : 0.0;

    case "sibling":
      // Check if event files are in same directory
      return eventPaths.some(ep =>
        cue.path.some(cp => getDirectory(cp) === getDirectory(ep))
      ) ? 0.6 : 0.0;

    case "glob":
      return eventPaths.some(ep =>
        matchGlob(ep, cue.path as string)
      ) ? 0.9 : 0.0;

    default:
      return 0.0;
  }
}
```

---

## 7. Cue Integration Points

### 7.1 When Cues Fire

| Hook | Cue Triggered | Purpose |
|------|--------------|---------|
| `session-start` | State cue (empty goal) | Pre-load recent events, trauma warnings |
| `pre-read` | Location cue (target file) | Warn about past issues with file |
| `pre-write` | Location + State cue | Check for penalty patterns before editing |
| `post-write` | Location cue | Check if this edit might conflict with past issues |
| `stop` | None (build session summary) | Consolidate session events |

### 7.2 Pre-Read Warning Example

```typescript
// In pre-read.ts hook
async function checkForWarnings(filePath: string) {
  const recall = await recallEvents({
    cue: {
      type: "location",
      path: filePath,
      match_mode: "exact"
    },
    filters: {
      valence: ["trauma", "penalty"],
      min_intensity: 0.5,
      limit: 3
    }
  });

  if (recall.events.length > 0) {
    const warning = formatWarning(recall.events);
    // Inject into Claude's context
    return {
      should_proceed: true,
      warning: warning
    };
  }
}
```

Output to Claude:
```
⚠️ OpenWolf Memory: src/auth/middleware.ts has 2 trauma events.
   - "Using `var` caused scope leak" (intensity: 0.85)
   - "Config reads `cfg.talk` not `cfg.tts`" (intensity: 0.9)
   Consider: Use const/let. Read config from cfg.talk.
```

---

## 8. Open Questions

| Question | Options | Recommendation |
|----------|---------|----------------|
| Cross-project recall? | Never / Ask first / Always | **Ask first** — privacy + relevance |
| How many events to surface? | Top-1 / Top-3 / Top-5 | **Top-3 by default**, top-1 for trauma |
| Cue ambiguity (file vs entity name)? | Prefer file / Prefer entity | **Prefer file** for location cues, entity for questions |
| Real-time index update vs batch? | Real-time / On-demand / Background | **Background batch** (every 10 events) |
| Case sensitivity for paths? | Case-sensitive | **Case-sensitive** — cross-platform issues |
