# Implementation Spec — New .wolf/ File Structures

> **Parent**: [00-hippocampus-memory-system.md](./00-hippocampus-memory-system.md)
> **Purpose**: Define exact schemas and file structures for hippocampus memory system

---

## 1. New Files Overview

```
.wolf/
├── hippocampus.json      # Short-term event buffer
├── neocortex.json        # Long-term consolidated memory
├── cue-index.json        # Fast lookup index
├── memory/
│   ├── events/           # Individual event JSON files (one per event)
│   │   └── YYYY/MM/
│   │       └── evt-{uuid}.json
│   ├── consolidated/     # Neocortex entries (one per concept)
│   │   └── neo-{uuid}.json
│   └── forgotten/       # Forgotten events (recoverable)
│       └── evt-{uuid}.json
└── ...
```

---

## 2. hippocampus.json Schema

```typescript
// File: .wolf/hippocampus.json

interface HippocampusStore {
  version: 1;
  schema_version: 1;              // For migrations

  project_root: string;             // Absolute path
  created_at: string;              // ISO8601
  last_updated: string;           // ISO8601

  // The event buffer
  buffer: WolfEvent[];

  // Statistics
  stats: {
    total_events: number;
    reward_count: number;
    penalty_count: number;
    trauma_count: number;
    neutral_count: number;
    oldest_event: string | null;   // ISO8601
    newest_event: string | null;   // ISO8601
  };

  // Size management
  size_bytes: number;
  max_size_bytes: number;          // 5_000_000 (5MB hard limit)

  // Retention
  retention_days: number;           // 7 days
  max_buffer_size: number;         // 500 events
}

const DEFAULT_HIPPOCAMPUS_CONFIG = {
  max_size_bytes: 5_000_000,
  retention_days: 7,
  max_buffer_size: 500
};
```

**Example:**
```json
{
  "version": 1,
  "schema_version": 1,
  "project_root": "/home/user/my-project",
  "created_at": "2026-05-01T00:00:00Z",
  "last_updated": "2026-05-06T11:00:00Z",
  "buffer": [/* up to 500 events */],
  "stats": {
    "total_events": 156,
    "reward_count": 89,
    "penalty_count": 42,
    "trauma_count": 12,
    "neutral_count": 13,
    "oldest_event": "2026-04-29T00:00:00Z",
    "newest_event": "2026-05-06T11:00:00Z"
  },
  "size_bytes": 245000,
  "max_size_bytes": 5000000,
  "retention_days": 7,
  "max_buffer_size": 500
}
```

---

## 3. neocortex.json Schema

```typescript
// File: .wolf/neocortex.json

interface NeocortexStore {
  version: 1;
  schema_version: 1;

  project_root: string;
  created_at: string;
  last_updated: string;

  // Consolidated memory entries
  entries: { [id: string]: NeocortexEntry };

  // Index by location (path -> entry IDs)
  location_index: { [path: string]: string[] };

  // Index by tag (tag -> entry IDs)
  tag_index: { [tag: string]: string[] };

  // Statistics
  stats: {
    total_entries: number;
    trauma_count: number;
    reward_count: number;
    penalty_count: number;
    forgotten_count: number;
    average_decay_factor: number;
  };

  // Size management
  size_bytes: number;
  max_size_bytes: number;          // 10_000_000 (10MB hard limit)

  // Consolidation tracking
  last_consolidation: string;     // ISO8601
  consolidation_count: number;     // Total consolidation cycles run
}

interface NeocortexEntry {
  id: string;                      // "neo-{uuid}"
  version: 1;

  // === CORE CONTENT ===
  summary: string;                 // 1-2 sentences
  reflection: string;              // What was learned (full detail)

  // === SPATIAL ===
  primary_location: string;        // Main file or directory
  locations: string[];             // All related locations
  spatial_pattern: string;         // Human description

  // === ACTION PATTERN ===
  action_type: ActionType;
  action_pattern: string;          // Pattern description
  code_snippet?: string;           // Example code (optional)

  // === EMOTIONAL VALENCE ===
  valence: "reward" | "neutral" | "penalty" | "trauma";
  intensity: number;              // Highest observed
  reinforcement_count: number;    // Times reinforced

  // === LINEAGE ===
  created_from: string[];         // Source event IDs
  first_seen: string;             // ISO8601
  last_seen: string;              // ISO8601
  consolidated_at: string;         // ISO8601

  // === ACCESS ===
  access_count: number;
  last_accessed: string;          // ISO8601

  // === DECAY ===
  decay_factor: number;           // 1.0 = fresh, 0.0 = forgotten
  last_decay_check: string;      // ISO8601

  // === TAGS ===
  tags: string[];
  related_entries: string[];      // IDs of related neocortex entries
}
```

**Example:**
```json
{
  "version": 1,
  "schema_version": 1,
  "project_root": "/home/user/my-project",
  "created_at": "2026-05-01T00:00:00Z",
  "last_updated": "2026-05-06T00:00:00Z",
  "entries": {
    "neo-abc123def456": {
      "id": "neo-abc123def456",
      "version": 1,
      "summary": "TypeScript var causes scoping issues",
      "reflection": "Using var in TypeScript has function scope, not block scope. This causes unexpected behavior when used in middleware chains and closures. Always use const or let.",
      "primary_location": "src/auth/",
      "locations": ["src/auth/middleware.ts", "src/api/handler.ts"],
      "spatial_pattern": "middleware and handler files",
      "action_type": "edit",
      "action_pattern": "Declared variable with var instead of const",
      "code_snippet": "// BAD: var token = ...\n// GOOD: const token = ...",
      "valence": "trauma",
      "intensity": 0.95,
      "reinforcement_count": 3,
      "created_from": ["evt-7f3a2b1c-4d5e-6f8a-9b0c-1d2e3f4a5b6c", "evt-xyz789..."],
      "first_seen": "2026-04-15T10:00:00Z",
      "last_seen": "2026-05-06T10:30:00Z",
      "consolidated_at": "2026-05-01T00:00:00Z",
      "access_count": 12,
      "last_accessed": "2026-05-06T10:35:00Z",
      "decay_factor": 1.0,
      "last_decay_check": "2026-05-06T00:00:00Z",
      "tags": ["typescript", "var-vs-const", "scope", "auth"],
      "related_entries": []
    }
  },
  "location_index": {
    "src/auth/": ["neo-abc123def456"],
    "src/auth/middleware.ts": ["neo-abc123def456"]
  },
  "tag_index": {
    "typescript": ["neo-abc123def456"],
    "scope": ["neo-abc123def456"]
  },
  "stats": {
    "total_entries": 24,
    "trauma_count": 5,
    "reward_count": 12,
    "penalty_count": 7,
    "forgotten_count": 0,
    "average_decay_factor": 0.97
  },
  "size_bytes": 156000,
  "max_size_bytes": 10000000,
  "last_consolidation": "2026-05-06T03:00:00Z",
  "consolidation_count": 42
}
```

---

## 4. cue-index.json Schema

```typescript
// File: .wolf/cue-index.json

interface CueIndexStore {
  version: 1;
  schema_version: 1;

  project_root: string;
  last_updated: string;           // ISO8601
  last_rebuilt: string;           // ISO8601 of last full rebuild

  // === LOCATION INDEX ===
  location_index: {
    // Exact file paths
    [exactPath: string]: IndexEntry[];  // Sorted by recency
    // Prefix directories (trailing slash)
    [prefixPath: string]: IndexEntry[];
  }

  // === TAG INDEX ===
  tag_index: {
    [tag: string]: IndexEntry[];
  }

  // === PATTERN INDEX ===
  // Entities extracted from questions
  pattern_index: {
    [pattern: string]: IndexEntry[];  // Lowercase, stemmed
  }

  // === ERROR INDEX ===
  error_index: {
    [errorType: string]: IndexEntry[];  // TypeError, ReferenceError, etc.
  }

  // === TRAUMA FAST TRACK ===
  trauma_index: {
    all_trauma_ids: string[];           // Sorted by intensity desc
    by_path: {
      [path: string]: string[];         // Traumas affecting path
    }
  }

  // === RECENT EVENTS (quick access) ===
  recent_events: {
    last_hour: string[];                // Event IDs from last hour
    last_session: string[];             // Event IDs from last session
  }
}

interface IndexEntry {
  event_id: string;
  score: number;                        // Relevance score at indexing time
  timestamp: string;                   // For recency sorting
  valence?: "reward" | "penalty" | "trauma";
  intensity?: number;
}
```

**Example:**
```json
{
  "version": 1,
  "schema_version": 1,
  "project_root": "/home/user/my-project",
  "last_updated": "2026-05-06T11:00:00Z",
  "last_rebuilt": "2026-05-06T03:00:00Z",

  "location_index": {
    "src/auth/middleware.ts": [
      { "event_id": "evt-7f3a2b1c-...", "score": 1.0, "timestamp": "2026-05-06T10:30:00Z", "valence": "trauma", "intensity": 0.85 },
      { "event_id": "evt-abc123...", "score": 0.8, "timestamp": "2026-05-01T09:00:00Z", "valence": "reward", "intensity": 0.6 }
    ],
    "src/auth/": [
      { "event_id": "evt-7f3a2b1c-...", "score": 0.9, "timestamp": "2026-05-06T10:30:00Z", "valence": "trauma", "intensity": 0.85 }
    ]
  },

  "tag_index": {
    "typescript": [
      { "event_id": "evt-7f3a2b1c-...", "score": 0.9, "timestamp": "2026-05-06T10:30:00Z", "valence": "trauma", "intensity": 0.85 }
    ],
    "var-vs-const": [
      { "event_id": "evt-7f3a2b1c-...", "score": 1.0, "timestamp": "2026-05-06T10:30:00Z", "valence": "trauma", "intensity": 0.85 }
    ]
  },

  "pattern_index": {
    "jwt": [
      { "event_id": "evt-def456...", "score": 0.8, "timestamp": "2026-05-05T14:00:00Z", "valence": "reward", "intensity": 0.7 }
    ]
  },

  "error_index": {
    "TypeError": [
      { "event_id": "evt-123abc...", "score": 0.9, "timestamp": "2026-05-06T09:00:00Z", "valence": "trauma", "intensity": 0.8 }
    ]
  },

  "trauma_index": {
    "all_trauma_ids": ["evt-7f3a2b1c-...", "evt-123abc...", "evt-xyz789..."],
    "by_path": {
      "src/auth/middleware.ts": ["evt-7f3a2b1c-..."],
      "src/components/UserList.tsx": ["evt-123abc..."]
    }
  },

  "recent_events": {
    "last_hour": ["evt-newest...", "evt-recent..."],
    "last_session": ["evt-session-start...", "evt-middle...", "evt-latest..."]
  }
}
```

---

## 5. Event Storage (Individual Files)

### 5.1 File Path Pattern

```
.wolf/memory/events/
└── {YYYY}/
    └── {MM}/
        └── evt-{uuid}.json
```

**Examples:**
```
.wolf/memory/events/2026/05/evt-7f3a2b1c-4d5e-6f8a-9b0c-1d2e3f4a5b6c.json
.wolf/memory/events/2026/04/evt-abc12345-6789-0abc-def1-234567890abc.json
```

### 5.2 Event File Schema

```typescript
// File: .wolf/memory/events/YYYY/MM/evt-{uuid}.json
// Schema is WolfEvent (defined in 01-event-model.md)
```

**Example file: `.wolf/memory/events/2026/05/evt-7f3a2b1c-4d5e-6f8a-9b0c-1d2e3f4a5b6c.json`**
```json
{
  "id": "evt-7f3a2b1c-4d5e-6f8a-9b0c-1d2e3f4a5b6c",
  "version": 1,
  "timestamp": "2026-05-06T10:30:00Z",
  "session_id": "sess-alpha-42",
  "context": {
    "project_root": "/home/user/my-project",
    "files_involved": ["/home/user/my-project/src/auth/middleware.ts"],
    "cwd_at_time": "/home/user/my-project",
    "spatial_path": "src/auth/",
    "spatial_depth": 3,
    "session_start": "2026-05-06T09:00:00Z",
    "turn_in_session": 15,
    "current_goal": "Add JWT validation to auth middleware"
  },
  "action": {
    "type": "edit",
    "subtype": "typescript-edit",
    "description": "Added JWT validation using var instead of const",
    "tokens_spent": 240,
    "files_modified": ["/home/user/my-project/src/auth/middleware.ts"],
    "succeeded": true
  },
  "outcome": {
    "valence": "trauma",
    "intensity": 0.85,
    "reflection": "Using `var` caused a hard-to-debug scope leak in middleware.",
    "is_recurring": true,
    "first_event_id": "evt-original...",
    "user_correction": "Never use var! Always const or let."
  },
  "consolidation": {
    "stage": "short-term",
    "access_count": 1,
    "last_accessed": "2026-05-06T10:30:00Z",
    "consolidation_score": 0.2,
    "should_consolidate": false,
    "decay_factor": 1.0,
    "last_decay_check": "2026-05-06T10:30:00Z"
  },
  "source": "hook",
  "tags": ["typescript", "scope", "var-vs-const", "auth", "user-correction"]
}
```

---

## 6. Directory Structure (Final State)

```
.wolf/
├── hooks/                    # Existing
│   ├── post-read.js
│   ├── post-write.js
│   └── ...
├── anatomy.md               # Existing
├── cerebrum.md              # Existing
├── buglog.json              # Existing (becomes subset of events)
├── token-ledger.json        # Existing
├── memory.md                # Existing
│
├── hippocampus.json         # NEW: Short-term event buffer
├── neocortex.json           # NEW: Long-term consolidated memory
├── cue-index.json           # NEW: Fast lookup index
│
└── memory/                  # NEW: Individual event storage
    ├── events/
    │   └── 2026/
    │       └── 05/
    │           ├── evt-7f3a2b1c-....json
    │           └── evt-1a2b3c4d-....json
    ├── consolidated/
    │   └── neo-abc123def456.json
    └── forgotten/
        └── evt-forgotten-001.json
```

---

## 7. Migration from Existing System

### 7.1 Buglog → Event Migration

Existing `buglog.json` entries become `WolfEvent` with:
```typescript
{
  action: { type: "fix" },
  outcome: { valence: "trauma", intensity: 0.7 }  // Bugs imply trauma
}
```

### 7.2 Cerebrum → Neocortex Migration

Existing `cerebrum.md` entries become `NeocortexEntry`:
```typescript
{
  reflection: "Never use var - always const or let",  // From Do-Not-Repeat
  valence: "trauma",
  primary_location: "project-wide"
}
```

---

## 8. Open Questions

| Question | Options | Recommendation |
|----------|---------|----------------|
| Individual event file naming? | UUID only / Date+UUID | **Date+UUID** for easier manual browsing |
| JSON indentation? | 2-space / 4-space / minified | **2-space** for readability |
| Schema version migration strategy? | Version field / Separate migration files | **Version field + migration script** |
| Maximum file size per event? | 10KB / 50KB / 100KB | **50KB** with truncation fallback |
| Backup strategy? | Git / Copy / ZIP | **Separate zip** (too large for git) |
