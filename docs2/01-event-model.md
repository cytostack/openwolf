# Event Model — Trajectory, Valence & Intensity

> **Parent**: [00-hippocampus-memory-system.md](./00-hippocampus-memory-system.md)
> **Purpose**: Define the Event as the atomic memory unit with outcome valence

---

## 1. Event Schema (TypeScript)

```typescript
interface WolfEvent {
  id: string;                    // UUID v4
  version: 1;                    // Schema version for migrations

  timestamp: string;             // ISO8601 UTC
  session_id: string;            // OpenWolf session identifier

  // === THE TRIPLET ===
  context: EventContext;
  action: EventAction;
  outcome: EventOutcome;

  // === CONSOLIDATION ===
  consolidation: EventConsolidation;

  // === METADATA ===
  source: "hook" | "daemon" | "manual";
  tags: string[];               // Auto-extracted + user-defined
}

interface EventContext {
  project_root: string;         // Absolute path to .wolf/
  files_involved: string[];     // Absolute paths, relative to project_root
  cwd_at_time: string;          // Working directory when event occurred

  // Spatial cue: where in project hierarchy
  spatial_path: string;         // e.g., "src/api/auth/" or "docs/"
  spatial_depth: number;        // Nesting level: 1=root, 2=src, 3=src/api

  // Temporal cue: session context
  session_start: string;        // ISO8601 of session start
  turn_in_session: number;      // Which Claude "turn" this was

  // State cue: what was the AI doing
  current_goal?: string;        // User's stated goal for this turn
  recent_errors?: string[];     // Errors seen in last N turns
}

interface EventAction {
  type: ActionType;
  subtype?: string;              // e.g., "typescript-edit" for type="edit"

  description: string;           // Natural language: "Added JWT validation to auth middleware"

  tokens_spent: number;         // Estimated tokens consumed

  // Action details
  files_modified?: string[];     // For write/edit actions
  files_read?: string[];        // For read actions
  command_executed?: string;    // For execute actions

  // Success indicators (set by hook based on result)
  succeeded?: boolean;
  error_message?: string;
}

type ActionType =
  | "read"           // File read
  | "write"          // New file created
  | "edit"           // Existing file modified
  | "delete"         // File deleted
  | "execute"        // Shell command run
  | "correct"        // User correction received
  | "approve"        // User approved solution
  | "reject"         // User rejected solution
  | "discover"       // Learning/discovery (e.g., found a convention)
  | "fix"            // Bug fix applied
  | "refactor";      // Code restructure

interface EventOutcome {
  // Valence: the emotional/quality dimension
  valence: "reward" | "neutral" | "penalty" | "trauma";

  // Intensity: 0.0 (nothing) to 1.0 (maximum)
  intensity: number;             // 0.0-1.0, two decimal precision

  // What was the emotional/quality outcome?
  reflection: string;           // "Using var caused scope leak" or "Tests passed first try"

  // Why this valence/intensity?
  reasoning?: string;          // Optional deeper analysis

  // Connection to prior events
  related_events?: string[];    // Event IDs this relates to
  is_recurring?: boolean;       // true if this is the Nth occurrence
  first_event_id?: string;     // If recurring, the original event

  // User feedback (if available)
  user_correction?: string;     // If valence=penalty/trauma, what did user say?
  user_approval?: string;      // If valence=reward, what did user say?
}

interface EventConsolidation {
  // Hippocampus stage
  stage: "short-term" | "consolidating" | "long-term";

  // Access tracking
  access_count: number;         // Times this event was recalled
  last_accessed: string;       // ISO8601

  // Consolidation signals
  consolidation_score: number; // 0.0-1.0, rises with access_count
  should_consolidate: boolean; // True if consolidation_score > threshold

  // Decay (long-term only)
  decay_factor: number;        // Starts at 1.0, decreases over time
  last_decay_check: string;     // ISO8601

  // Forgetting
  forgotten: boolean;            // True if decay_factor hit 0
  forgotten_at?: string;        // ISO8601 when forgotten
}
```

---

## 2. Valence Detection Rules

### 2.1 Automatic Valence Assignment

Valence is determined by the combination of `action.type` and hook-detected outcomes:

| Action Type | Outcome Detected | Valence | Intensity |
|-------------|------------------|---------|-----------|
| `fix` | Bug fix applied | `reward` | 0.6-0.8 |
| `fix` | Same bug re-fixes | `trauma` | 0.7-0.9 |
| `approve` | User approved | `reward` | 0.7-1.0 |
| `correct` | User correction | `penalty` | 0.4-0.7 |
| `correct` | User corrected SAME thing twice | `trauma` | 0.8-1.0 |
| `reject` | User rejected | `penalty` | 0.6-0.8 |
| `execute` | Command failed | `penalty` | 0.5-0.9 |
| `execute` | Command succeeded | `reward` | 0.3-0.5 |
| `edit` | Build fails after edit | `penalty` | 0.7-0.9 |
| `edit` | Build succeeds after edit | `reward` | 0.4-0.6 |
| `edit` | Same file edited 3+ times | `trauma` | 0.6-0.8 |
| `write` | Tests pass on first run | `reward` | 0.8-1.0 |
| `discover` | New convention learned | `reward` | 0.2-0.4 |

### 2.2 Intensity Scaling

Intensity is scaled by context:

```typescript
function computeIntensity(
  action: ActionType,
  outcome: { succeeded?: boolean; error_message?: string },
  context: { is_recurring?: boolean; user_feedback?: string }
): number {
  let base = 0.5;

  // Success/failure
  if (outcome.succeeded === false) base += 0.3;
  if (outcome.succeeded === true) base -= 0.1;

  // Recurring mistakes
  if (context.is_recurring) base += 0.3;

  // User feedback strength
  if (context.user_feedback) {
    const feedback = context.user_feedback.toLowerCase();
    if (feedback.includes("again") || feedback.includes("twice")) base += 0.2;
    if (feedback.includes("never") || feedback.includes("always")) base += 0.1;
  }

  // Clamp to 0.0-1.0
  return Math.max(0.0, Math.min(1.0, base));
}
```

---

## 3. Example Events

### 3.1 Trauma Event (Repeated Mistake)

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
    "reflection": "Using `var` caused a hard-to-debug scope leak in middleware. User explicitly said 'never use var, always const or let'.",
    "reasoning": "This is the 3rd time this session I've used var. User correction was emphatic.",
    "is_recurring": true,
    "first_event_id": "evt-abc123...",
    "user_correction": "Never use var! I told you twice already. Always const or let."
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

### 3.2 Reward Event (Successful Fix)

```json
{
  "id": "evt-1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
  "version": 1,
  "timestamp": "2026-05-06T11:00:00Z",
  "session_id": "sess-alpha-42",

  "context": {
    "project_root": "/home/user/my-project",
    "files_involved": [
      "/home/user/my-project/src/components/UserList.tsx",
      "/home/user/my-project/src/api/users.ts"
    ],
    "cwd_at_time": "/home/user/my-project",
    "spatial_path": "src/components/",
    "spatial_depth": 3,
    "session_start": "2026-05-06T09:00:00Z",
    "turn_in_session": 22,
    "current_goal": "Fix the TypeError in UserList"
  },

  "action": {
    "type": "fix",
    "description": "Fixed TypeError by adding optional chaining: data?.users?.map()",
    "tokens_spent": 380,
    "files_modified": ["/home/user/my-project/src/components/UserList.tsx"],
    "succeeded": true
  },

  "outcome": {
    "valence": "reward",
    "intensity": 0.75,
    "reflection": "Added optional chaining to fix null reference. Component renders correctly now.",
    "related_events": ["evt-previous-bug-attempt"]
  },

  "consolidation": {
    "stage": "short-term",
    "access_count": 0,
    "last_accessed": "2026-05-06T11:00:00Z",
    "consolidation_score": 0.1,
    "should_consolidate": false,
    "decay_factor": 1.0,
    "last_decay_check": "2026-05-06T11:00:00Z"
  },

  "source": "hook",
  "tags": ["react", "null-check", "optional-chaining", "bugfix"]
}
```

### 3.3 Neutral Event (Discovery)

```json
{
  "id": "evt-9z8y7x6w-5v4u-3t2s-1r0q-9p8o7n6m5l4k",
  "version": 1,
  "timestamp": "2026-05-06T09:15:00Z",
  "session_id": "sess-alpha-42",

  "context": {
    "project_root": "/home/user/my-project",
    "files_involved": ["/home/user/my-project/package.json"],
    "cwd_at_time": "/home/user/my-project",
    "spatial_path": "",
    "spatial_depth": 1,
    "session_start": "2026-05-06T09:00:00Z",
    "turn_in_session": 3
  },

  "action": {
    "type": "discover",
    "description": "Discovered this project uses pnpm workspaces with strict hoisting",
    "tokens_spent": 120
  },

  "outcome": {
    "valence": "neutral",
    "intensity": 0.2,
    "reflection": "pnpm workspaces in package.json. All packages in `packages/` directory."
  },

  "consolidation": {
    "stage": "short-term",
    "access_count": 0,
    "last_accessed": "2026-05-06T09:15:00Z",
    "consolidation_score": 0.05,
    "should_consolidate": false,
    "decay_factor": 1.0,
    "last_decay_check": "2026-05-06T09:15:00Z"
  },

  "source": "hook",
  "tags": ["pnpm", "workspaces", "project-convention"]
}
```

---

## 4. Event Storage

### 4.1 Hippocampus Buffer (Short-Term)

File: `.wolf/hippocampus.json`

```json
{
  "version": 1,
  "project_root": "/home/user/my-project",
  "buffer": [...events...],
  "total_events": 156,
  "oldest_event": "2026-05-01T00:00:00Z",
  "newest_event": "2026-05-06T11:00:00Z",
  "size_bytes": 524288
}
```

**Buffer limits:**
- Max 500 events in buffer
- Max 7 days retention
- Events exceeding either limit are moved to consolidation queue

### 4.2 Event Storage (Individual Files)

Directory: `.wolf/memory/events/`

```
.wolf/memory/events/
├── 2026/
│   ├── 05/
│   │   ├── evt-7f3a2b1c-...json
│   │   ├── evt-1a2b3c4d-...json
│   │   └── ...
│   └── ...
└── ...
```

Individual files enable:
- Fast random access by ID
- Git-friendly (one event per file)
- Easy backup/restore

---

## 5. Open Questions

| Question | Options | Recommendation |
|----------|---------|----------------|
| Should deleted files retain their events? | Yes / No | **Yes** — context of WHY file was deleted is valuable |
| How to handle events from different users on same project? | Ignore user / Tag by user / Separate buffers | **Tag by user** — enables personalized recall |
| Event ID collision? | UUID v4 is sufficient | UUID v4 with timestamp prefix for sortability |
| Trimming old events? | Never / LRU / Age-based | **Never auto-delete trauma events**, LRU for neutral/reward |
