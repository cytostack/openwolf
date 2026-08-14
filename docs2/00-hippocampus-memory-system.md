# OpenWolf Hippocampus Memory System — High-Level Design

> **Status**: Brainstorm — not implemented
> **Goal**: Extend OpenWolf's memory with neuroscience-inspired episodic and spatial memory

---

## 1. Why Hippocampus-Style Memory?

OpenWolf's current memory (`cerebrum.md`, `buglog.json`, `memory.md`) is:
- **Declarative** — stores facts, not experiences
- **Flat** — no concept of context, recency, or emotional valence
- **Append-only** — never forgets, never prioritizes

A hippocampus-style system adds:

| Current OpenWolf | Hippocampus Extension |
|------------------|----------------------|
| "Don't use `var`" | "Using `var` in auth/middleware.ts caused a hard-to-debug scope leak → trauma=0.8 |
| "Tests go in `__tests__/`" | "When I put tests in `test/` in `src/api/`, CI failed twice → penalty=0.6 |
| "Use pnpm workspaces" | "Adding pnpm workspace config in `api/` caused hoisting issues → trauma=0.9 |
| No context | "File `cfg.talk` not `cfg.tts` — but ONLY in middleware, NOT in utils" |

The hippocampus stores **episodes**: (Context × Action × Outcome). Future cues trigger recall of similar episodes.

---

## 2. Core Concepts

### 2.1 Event — The Atomic Memory Unit

An **Event** is a triplet: `(Context, Action, Outcome)`

```
Event {
  id: uuid
  timestamp: ISO8601
  context: {
    files: string[]           // Files involved
    cwd: string               // Project root at time
    session_id: string
  }
  action: {
    type: "read" | "write" | "edit" | "execute" | "correct"
    description: string        // Natural language summary
    tokens_cost: number
  }
  outcome: {
    valence: "reward" | "neutral" | "penalty" | "trauma"
    intensity: 0.0-1.0         // How strong the outcome was
    reflection: string         // What we learned
    tags: string[]
  }
  consolidation: {
    stage: "short-term" | "consolidating" | "long-term"
    access_count: number
    last_accessed: ISO8601
    decay_factor: number
  }
}
```

**Valence definitions:**
- **Reward** (positive): Task succeeded, user approved, build passed, test green
- **Penalty** (negative): Task failed, user corrected, build broke, test red
- **Trauma** (strong negative): Same mistake twice, major regression, hours lost

### 2.2 Cue — The Retrieval Trigger

A **Cue** is anything that triggers memory retrieval. Three types:

| Cue Type | Description | Example |
|----------|-------------|---------|
| **Location** | File, directory, or pattern | `src/auth/middleware.ts` |
| **Question** | How-to, Why-not, What-if | "How do I validate JWT in this project?" |
| **State** | Current context, error, goal | `TypeError in useEffect at line 42` |

**Cue Matching:**
```
cue + similarity_search(event_store) → ranked_events_by_relevance
```

Retrieval is not exact match — it finds semantically similar past events.

### 2.3 Consolidation — From Short to Long Term

Hippocampus consolidates memories over time:

```
[Event Created]
    → Short-term (hippocampus): accessible, high fidelity
    ↓ (after N accesses OR time threshold)
→ Consolidating: being integrated
    ↓ (after reinforcement cycles)
→ Long-term (cortex): stable, may decay if not accessed
```

**Consolidation triggers:**
- Repeated access to same/similar event
- High valence events (trauma/reward) consolidate faster
- Idle time between sessions (offline consolidation)

---

## 3. Memory Architecture

### 3.1 New Files in `.wolf/`

```
.wolf/
├── neocortex.json       # NEW: Hippocampus event store (long-term)
├── hippocampus.json      # NEW: Short-term event buffer
├── cue-index.json        # NEW: Fast lookup index for cues
├── memory/
│   ├── events/          # NEW: Individual event JSON files
│   └── consolidated/    # NEW: Long-term memory chunks
└── ...
```

### 3.2 Data Flow

```
[User Action in Claude]
    ↓
[Hook fires: post-read/post-write/stop]
    ↓
[Create Event with Context + Action + Outcome]
    ↓
[Store in hippocampus.json (short-term buffer)]
    ↓
[Update cue-index.json for fast retrieval]
    ↓
[Consolidation daemon (offline)]
    ↓
[Move to neocortex.json (long-term) if reinforced]
```

---

## 4. Integration with Existing OpenWolf

### 4.1 Backward Compatibility

| Existing File | Role | Enhancement |
|---------------|------|-------------|
| `cerebrum.md` | User preferences, do-not-repeat | Becomes a "summarized cortex" — condensed from events |
| `buglog.json` | Bug fix records | Events with `valence: trauma` + `action.type: "fix"` |
| `memory.md` | Session log | Still used, but events are richer |
| `anatomy.md` | File index | Cue-index references anatomy entries |

### 4.2 Hook Extension Points

| Hook | Enhancement |
|------|-------------|
| `session-start.ts` | Pre-load relevant events based on current context |
| `pre-read.ts` | Check for related trauma events on target file |
| `pre-write.ts` | Check for related penalty events before editing |
| `post-write.ts` | Detect outcome (success/failure) and create event |
| `post-read.ts` | Track repeated reads — high frequency = consolidate |
| `stop.ts` | Session summary → batch of events, trigger consolidation |

---

## 5. Retrieval API

When Claude needs to recall:

```typescript
interface RecallRequest {
  cue: {
    type: "location" | "question" | "state"
    content: string | string[]
  }
  filters?: {
    valence?: ("reward" | "penalty" | "trauma")[]
    min_intensity?: number
    max_age_days?: number
    tags?: string[]
  }
  limit?: number
}

interface RecallResponse {
  events: Event[]
  confidence: number  // How confident we are in the recall
  consolidation_stage: string
}
```

**Example queries:**
- "What happened when I last edited `src/auth/middleware.ts`?"
- "Why-not: auth middleware has 3 failed attempts — what went wrong?"
- "What-if: I want to refactor the entire `api/` directory — what's the risk?"
- "How-to: set up JWT validation in this project?"

---

## 6. Open Questions

1. **Granularity**: Should one file edit = one event, or one session = one event?
2. **Attribution**: How to handle events where outcome is unknown (task in progress)?
3. **Decay**: Long-term memories may decay — when does OpenWolf "forget"?
4. **Consolidation timing**: Real hippocampus consolidates during sleep — when should OpenWolf?
5. **Cue ambiguity**: "auth" might match `src/auth/`, `src/api/auth.ts`, and comments mentioning auth
6. **User privacy**: Events contain session context — is this too invasive?
7. **Scaling**: A busy project could generate thousands of events — what's the storage limit?

---

## 7. Implementation Roadmap

| Phase | Description |
|-------|-------------|
| **Phase 1** | Define Event schema + basic hippocampus.json + post-write event capture |
| **Phase 2** | Implement cue-index.json + simple location-based recall |
| **Phase 3** | Add valence/intensity detection (from hook outcomes) |
| **Phase 4** | Consolidation daemon + neocortex.json |
| **Phase 5** | Question-based cues (how-to, why-not, what-if) |
| **Phase 6** | Integration with cerebrum.md summarization |

---

## 8. Success Metrics

- **Hit rate**: % of file edits that trigger relevant event recall
- **False positive rate**: recalled events that aren't actually relevant
- **Token savings**: events prevent redundant exploration (vs. bare read)
- **User correction reduction**: trauma events prevent repeated mistakes
