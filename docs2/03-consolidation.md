# Consolidation Strategy — Short-Term to Long-Term Memory

> **Parent**: [00-hippocampus-memory-system.md](./00-hippocampus-memory-system.md)
> **Purpose**: Define how events transition from short-term (hippocampus) to long-term (neocortex) storage

---

## 1. Consolidation Overview

The consolidation system mimics biological hippocampus-to-cortex transfer:

```
┌─────────────────────────────────────────────────────────────────┐
│  SHORT-TERM (hippocampus.json)                                  │
│  - High fidelity                                                 │
│  - Fast access                                                   │
│  - Limited capacity (500 events, 7 days)                         │
│                                                                  │
│  Event created → accessed N times OR time threshold → CONSOLIDATE│
└─────────────────────────────────────────────────────────────────┘
                              ↓
                    ┌─────────────────┐
                    │ CONSOLIDATING   │
                    │ (transitioning) │
                    └─────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  LONG-TERM (neocortex.json)                                     │
│  - Compressed representations                                    │
│  - Stable storage                                                │
│  - May decay if not accessed                                     │
│                                                                  │
│  Reinforced events → stable long-term memory                     │
│  Weak events → decay and eventually forgotten                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Consolidation Triggers

### 2.1 Automatic Triggers

| Trigger | Condition | Consolidation Speed |
|---------|-----------|---------------------|
| **Access count** | Event accessed 5+ times | Fast (next consolidation cycle) |
| **Time in buffer** | 7+ days in hippocampus | Medium |
| **High valence** | Intensity ≥ 0.8 | Fast (3 days) |
| **Trauma** | Valence = trauma | Fast + never decay |
| **User reinforcement** | User explicitly confirms lesson | Immediate |

### 2.2 Consolidation Score Formula

```typescript
interface ConsolidationMetrics {
  age_days: number;
  access_count: number;
  valence_intensity: number;
  valence_type: "reward" | "neutral" | "penalty" | "trauma";
  reinforcement_count: number;
}

function computeConsolidationScore(m: ConsolidationMetrics): number {
  // Base: age contribution (logarithmic)
  const ageScore = Math.log10(m.age_days + 1) / Math.log10(30); // Max at 30 days

  // Access contribution (diminishing returns)
  const accessScore = Math.min(1.0, m.access_count / 5);

  // Valence intensity boost
  const valenceBoost = m.valence_intensity * 0.3;

  // Special boosts
  let specialBoost = 0;
  if (m.valence_type === "trauma") specialBoost += 0.3;
  if (m.valence_type === "reward" && m.valence_intensity > 0.7) specialBoost += 0.1;
  if (m.reinforcement_count > 0) specialBoost += 0.2;

  // Final score (0.0 to 1.0)
  const raw = ageScore * 0.3 + accessScore * 0.4 + valenceBoost + specialBoost;

  return Math.min(1.0, raw);
}

function shouldConsolidate(event: WolfEvent): boolean {
  const score = computeConsolidationScore({
    age_days: daysAgo(event.timestamp),
    access_count: event.consolidation.access_count,
    valence_intensity: event.outcome.intensity,
    valence_type: event.outcome.valence,
    reinforcement_count: event.outcome.related_events?.length || 0
  });

  return score >= 0.7 || // Automatic threshold
         event.outcome.valence === "trauma" ||
         event.consolidation.access_count >= 10;
}
```

---

## 3. Consolidation Process

### 3.1 Consolidation Steps

```typescript
interface ConsolidationResult {
  event_id: string;
  action: "promote" | "merge" | "decay" | "forget";
  new_location: string;
  details: string;
}

async function consolidateEvent(event: WolfEvent): Promise<ConsolidationResult> {
  // Step 1: Check if event should be promoted
  if (shouldConsolidate(event)) {
    // Step 2: Check if similar event exists in neocortex
    const similar = await findSimilarInNeocortex(event);

    if (similar && shouldMerge(event, similar)) {
      // Merge into existing long-term memory
      return mergeIntoNeocortex(event, similar);
    } else {
      // Promote as new long-term memory
      return promoteToNeocortex(event);
    }
  }

  // Step 3: Check for decay
  if (shouldDecay(event)) {
    return applyDecay(event);
  }

  // Step 4: Check for forgetting
  if (shouldForget(event)) {
    return markAsForgotten(event);
  }

  // No action needed
  return { event_id: event.id, action: "keep", new_location: "hippocampus", details: "" };
}

async function mergeIntoNeocortex(newEvent: WolfEvent, existing: LongTermMemory): Promise<ConsolidationResult> {
  // Update existing memory with new information
  existing.access_count += 1;
  existing.last_accessed = new Date().toISOString();
  existing.decay_factor = Math.min(1.0, existing.decay_factor + 0.05);  // Refresh

  // Merge tags
  existing.tags = [...new Set([...existing.tags, ...newEvent.tags])];

  // If new event is more intense, update intensity
  if (newEvent.outcome.intensity > existing.intensity) {
    existing.intensity = newEvent.outcome.intensity;
    existing.reflection = newEvent.outcome.reflection;
  }

  // Add to history
  existing.event_history.push({
    event_id: newEvent.id,
    timestamp: newEvent.timestamp,
    action: "merged"
  });

  await saveNeocortexEntry(existing);

  return {
    event_id: newEvent.id,
    action: "merge",
    new_location: `neocortex/${existing.id}`,
    details: `Merged into existing long-term memory ${existing.id}`
  };
}
```

---

## 4. Long-Term Memory Format (Neocortex)

### 4.1 Neocortex Entry Schema

```typescript
interface NeocortexEntry {
  id: string;                    // UUID
  version: 1;

  // Core consolidated information
  summary: string;               // Human-readable summary
  reflection: string;            // What was learned

  // Spatial consolidation
  primary_location: string;      // Main file/directory
  locations: string[];           // All related locations
  spatial_pattern: string;       // e.g., "src/api/**/*" or "tests in __tests__/"

  // Action patterns
  action_type: ActionType;       // Most common action
  action_pattern: string;        // e.g., "Add optional chaining" or "Use const not var"

  // Valence (reinforced over time)
  valence: "reward" | "neutral" | "penalty" | "trauma";
  intensity: number;             // Highest intensity observed
  reinforcement_count: number;  // Times this pattern was reinforced

  // Consolidation metadata
  created_from: string[];        // Original event IDs
  first_seen: string;            // ISO8601 of oldest source event
  last_seen: string;             // ISO8601 of newest source event
  consolidated_at: string;       // ISO8601 when promoted to neocortex

  // Access tracking
  access_count: number;
  last_accessed: string;

  // Decay
  decay_factor: number;          // 1.0 = fresh, 0.0 = forgotten
  last_decay_check: string;

  // Tags
  tags: string[];
}

interface NeocortexStore {
  version: 1;
  project_root: string;
  entries: { [id: string]: NeocortexEntry };
  total_entries: number;
  last_consolidation: string;
  size_bytes: number;
}
```

### 4.2 Neocortex Entry Example

```json
{
  "id": "neo-abc123def456",
  "version": 1,
  "summary": "Using var in TypeScript causes scoping issues that are hard to debug",
  "reflection": "Always use const or let in TypeScript. var has function scope which causes unexpected behavior in closures and middleware chains.",
  "primary_location": "src/auth/",
  "locations": ["src/auth/middleware.ts", "src/api/handler.ts"],
  "spatial_pattern": "middleware and handler files",
  "action_type": "edit",
  "action_pattern": "Declared variable with var instead of const",
  "valence": "trauma",
  "intensity": 0.95,
  "reinforcement_count": 3,
  "created_from": ["evt-7f3a2b1c-...", "evt-xyz789..."],
  "first_seen": "2026-04-15T10:00:00Z",
  "last_seen": "2026-05-06T10:30:00Z",
  "consolidated_at": "2026-05-01T00:00:00Z",
  "access_count": 12,
  "last_accessed": "2026-05-06T10:35:00Z",
  "decay_factor": 1.0,
  "last_decay_check": "2026-05-06T00:00:00Z",
  "tags": ["typescript", "var-vs-const", "scope", "auth"]
}
```

---

## 5. Decay and Forgetting

### 5.1 Decay Rules

```typescript
const DECAY_CONFIG = {
  // How often to run decay check (in days)
  decay_interval_days: 7,

  // Decay rate per interval (multiplicative)
  decay_rate_per_interval: 0.95,

  // Minimum decay factor before "forgetting"
  forget_threshold: 0.1,

  // Trauma never decays (unless explicitly cleared)
  trauma_never_decay: true,

  // Long-term memories decay slower
  long_term_decay_rate: 0.98
};

function shouldDecay(event: WolfEvent): boolean {
  const daysSinceCheck = daysAgo(event.consolidation.last_decay_check);
  return daysSinceCheck >= DECAY_CONFIG.decay_interval_days &&
         event.consolidation.stage === "long-term";
}

function applyDecay(event: WolfEvent): ConsolidationResult {
  const newDecay = event.consolidation.decay_factor * DECAY_CONFIG.long_term_decay_rate;

  // Trauma events don't decay
  if (event.outcome.valence === "trauma") {
    return {
      event_id: event.id,
      action: "keep",
      new_location: "neocortex",
      details: "Trauma event - decay waived"
    };
  }

  event.consolidation.decay_factor = newDecay;
  event.consolidation.last_decay_check = new Date().toISOString();

  if (newDecay <= DECAY_CONFIG.forget_threshold) {
    return markAsForgotten(event);
  }

  return {
    event_id: event.id,
    action: "decay",
    new_location: "neocortex",
    details: `Decay applied: ${newDecay.toFixed(3)}`
  };
}
```

### 5.2 Forgetting

```typescript
async function markAsForgotten(event: WolfEvent): Promise<ConsolidationResult> {
  event.consolidation.forgotten = true;
  event.consolidation.forgotten_at = new Date().toISOString();

  // Move to forgotten store (separate file, still recoverable)
  await saveToForgottenStore(event);

  // Remove from active index
  await removeFromCueIndex(event.id);

  return {
    event_id: event.id,
    action: "forget",
    new_location: "forgotten/",
    details: "Event marked as forgotten and removed from active index"
  };
}
```

---

## 6. Consolidation Daemon

### 6.1 Daemon Behavior

```typescript
// In src/daemon/consolidation-daemon.ts

const CONSOLIDATION_CONFIG = {
  // Run consolidation every N hours
  interval_hours: 6,

  // Max events to process per cycle
  max_per_cycle: 50,

  // Off-peak hours only (to save resources)
  only_during_hours: { start: 2, end: 6 },  // 2 AM - 6 AM

  // Minimum events before consolidation runs
  min_buffer_size: 10
};

async function runConsolidationCycle() {
  const now = new Date();

  // Check if in off-peak hours
  if (!isOffPeakHours(now, CONSOLIDATION_CONFIG.only_during_hours)) {
    log("Skipping consolidation - not in off-peak hours");
    return;
  }

  const hippocampus = await loadHippocampus();
  const eligible = hippocampus.buffer
    .filter(e => shouldConsolidate(e) || shouldDecay(e))
    .sort(byConsolidationPriority)  // Trauma first, then by score
    .slice(0, CONSOLIDATION_CONFIG.max_per_cycle);

  log(`Consolidation cycle: ${eligible.length} events to process`);

  for (const event of eligible) {
    const result = await consolidateEvent(event);
    log(`  ${event.id}: ${result.action} -> ${result.new_location}`);
  }

  // Rebuild index
  await rebuildCueIndex();

  log(`Consolidation cycle complete at ${new Date().toISOString()}`);
}
```

### 6.2 Offline Consolidation

Real hippocampus consolidates during sleep. OpenWolf consolidates during off-peak hours:

```
[User finishes session]
    ↓
[stop.ts hook: batch events to hippocampus]
    ↓
[No activity for 2+ hours]
    ↓
[Consolidation daemon activates]
    ↓
[Process events: promote, merge, decay, or forget]
    ↓
[Update neocortex.json and cue-index.json]
```

---

## 7. Storage Management

### 7.1 File Sizes and Limits

| Storage | Location | Soft Limit | Hard Limit | Strategy |
|---------|----------|-----------|-----------|----------|
| Hippocampus | `.wolf/hippocampus.json` | 1 MB | 5 MB | Flush to events/ when exceeded |
| Neocortex | `.wolf/neocortex.json` | 2 MB | 10 MB | Compress old entries |
| Individual Events | `.wolf/memory/events/` | 10 KB/event | 50 KB/event | Truncate long reflections |
| Forgotten | `.wolf/memory/forgotten/` | 5 MB | 20 MB | Delete after 90 days |

### 7.2 Garbage Collection

```typescript
async function garbageCollect() {
  const hippocampus = await loadHippocampus();

  // Remove events that are too old
  const cutoff = subDays(new Date(), 7);
  hippocampus.buffer = hippocampus.buffer.filter(e =>
    new Date(e.timestamp) > cutoff ||
    e.outcome.valence === "trauma"  // Keep trauma events
  );

  // Trim if over soft limit
  if (hippocampus.size_bytes > 1_000_000) {
    // Sort by intensity, keep highest
    hippocampus.buffer.sort((a, b) => b.outcome.intensity - a.outcome.intensity);
    hippocampus.buffer = hippocampus.buffer.slice(0, 300);
  }

  await saveHippocampus(hippocampus);
}
```

---

## 8. Open Questions

| Question | Options | Recommendation |
|----------|---------|----------------|
| User control over consolidation? | Auto-only / Ask on trauma / Full control | **Auto + manual clear** for trauma |
| Cross-project consolidation? | Never share / Share selected / Full sync | **Never** — privacy critical |
| Merge similar events? | Never / Same location+type / Any similarity | **Same location + type + related** |
| Consolidate during active session? | Never / Lightweight only / Yes | **Never** during session |
| Forgotten recovery? | Never / Manual restore / Auto-restore on context | **Manual restore** only |
