# Hook Integration — Hippocampus in the Existing Hook System

> **Parent**: [00-hippocampus-memory-system.md](./00-hippocampus-memory-system.md)
> **Purpose**: Define how hippocampus memory system integrates with existing OpenWolf hooks

---

## 1. Hook Integration Overview

The hippocampus system extends, not replaces, the existing hook system.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         EXISTING HOOKS                               │
│                                                                      │
│  session-start → pre-read → post-read → pre-write → post-write → stop│
│                                                                      │
│  Each hook:                                                           │
│  - Still does existing work (update anatomy.md, memory.md, etc.)      │
│  - NEW: Also emits events to hippocampus system                       │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│                     HIPPOCAMPUS MODULE                                │
│                                                                      │
│  hippocampus.addEvent(event)                                         │
│  hippocampus.recall(cue) → events                                   │
│  consolidation.run() → neocortex                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. New Hippocampus Module API

### 2.1 Module Location

```
src/hippocampus/
├── index.ts              # Main export
├── event-store.ts        # Event CRUD operations
├── cue-recall.ts         # Recall algorithm
├── consolidation.ts      # Consolidation daemon
└── types.ts              # All type definitions
```

### 2.2 Module API

```typescript
// src/hippocampus/index.ts

import { WolfEvent, RecallRequest, RecallResponse } from './types.js';

export class Hippocampus {
  private hippocampusPath: string;
  private neocortexPath: string;
  private cueIndexPath: string;
  private memoryDir: string;

  constructor(projectRoot: string);

  // === EVENT MANAGEMENT ===
  async addEvent(event: Omit<WolfEvent, 'id' | 'consolidation'>): Promise<WolfEvent>;
  async getEvent(id: string): Promise<WolfEvent | null>;
  async getRecentEvents(limit: number): Promise<WolfEvent[]>;
  async getEventsInLocation(path: string): Promise<WolfEvent[]>;

  // === RECALL ===
  async recall(request: RecallRequest): Promise<RecallResponse>;
  async recallByLocation(path: string, filters?: RecallFilters): Promise<WolfEvent[]>;
  async recallByQuestion(query: string, questionType: QuestionType): Promise<WolfEvent[]>;
  async recallTraumas(path?: string): Promise<WolfEvent[]>;

  // === CONSOLIDATION ===
  async runConsolidation(): Promise<ConsolidationResult[]>;
  async shouldConsolidate(event: WolfEvent): Promise<boolean>;

  // === INDEX ===
  async rebuildIndex(): Promise<void>;
  async updateIndex(event: WolfEvent): Promise<void>;

  // === DAEMON ===
  startConsolidationDaemon(intervalHours: number): void;
  stopConsolidationDaemon(): void;

  // === UTILITY ===
  async getStats(): Promise<HippoStats>;
  async exportToNpy(): Promise<string>;  // For debugging
}

// Singleton for use in hooks
export const hippocampus = new Hippocampus(projectRoot);
```

---

## 3. Hook-by-Hook Integration

### 3.1 session-start.ts

```typescript
// src/hooks/session-start.ts (existing) + hippocampus integration

import { Hippocampus } from '../hippocampus/index.js';

export async function sessionStart(params: SessionStartParams) {
  const hippocampus = new Hippocampus(params.projectRoot);

  // === EXISTING BEHAVIOR ===
  await checkOrCreateWolfDir();
  await loadIdentity();
  await appendToMemory(`[${timestamp}] Session started`);

  // === NEW: Hippocampus integration ===

  // 1. Pre-load recent events for context
  const recentTraumas = await hippocampus.recallTraumas();
  const sessionEvents = await hippocampus.getRecentEvents(20);

  // 2. Build session context
  const sessionContext = {
    session_id: params.sessionId,
    project_root: params.projectRoot,
    start_time: params.timestamp,
    recent_traumas: recentTraumas.map(t => ({
      path: t.context.primary_location,
      summary: t.outcome.reflection,
      intensity: t.outcome.intensity
    })),
    last_session_events: sessionEvents.length
  };

  // 3. Inject into Claude's context (optional - may be too verbose)
  if (recentTraumas.length > 0) {
    const warning = formatSessionWarning(recentTraumas);
    // Pass to Claude via stdout or context file
    console.log(JSON.stringify({ type: 'session_warning', content: warning }));
  }

  // 4. Track session start event
  await hippocampus.addEvent({
    timestamp: params.timestamp,
    session_id: params.sessionId,
    context: {
      project_root: params.projectRoot,
      files_involved: [],
      cwd_at_time: params.cwd,
      spatial_path: '',
      spatial_depth: 0,
      session_start: params.timestamp,
      turn_in_session: 0
    },
    action: {
      type: 'discover',
      description: 'Session started',
      tokens_spent: 0
    },
    outcome: {
      valence: 'neutral',
      intensity: 0.0,
      reflection: 'New session started'
    },
    source: 'hook',
    tags: ['session-start']
  });

  return { success: true };
}
```

### 3.2 pre-read.ts

```typescript
// src/hooks/pre-read.ts (existing) + hippocampus integration

import { Hippocampus } from '../hippocampus/index.js';

export async function preRead(params: PreReadParams) {
  const hippocampus = new Hippocampus(params.projectRoot);

  // === EXISTING BEHAVIOR ===
  const result = await checkAnatomy(params.filePath);

  // === NEW: Hippocampus warning ===

  // 1. Check for traumas related to this file
  const traumas = await hippocampus.recallByLocation(params.filePath, {
    valence: ['trauma'],
    limit: 3
  });

  if (traumas.length > 0) {
    // Build warning message
    const warning = traumas.map(t => {
      const advice = extractAdvice(t.outcome.reflection);
      return `⚠️ ${params.filePath}: ${t.outcome.reflection} (intensity: ${t.outcome.intensity})`;
    }).join('\n');

    // 2. Mark traumas as accessed (for consolidation scoring)
    for (const trauma of traumas) {
      trauma.consolidation.access_count++;
      trauma.consolidation.last_accessed = new Date().toISOString();
      await hippocampus.updateEvent(trauma);
    }

    // 3. Return warning (injected into Claude's context)
    return {
      ...result,
      warning: warning,
      hippocampus_hit: true
    };
  }

  return result;
}
```

### 3.3 post-read.ts

```typescript
// src/hooks/post-read.ts (existing) + hippocampus integration

import { Hippocampus } from '../hippocampus/index.js';

export async function postRead(params: PostReadParams) {
  const hippocampus = new Hippocampus(params.projectRoot);

  // === EXISTING BEHAVIOR ===
  await trackFileRead(params.filePath, params.tokensUsed);
  await detectRepeatedReads(params.filePath);

  // === NEW: Hippocampus integration ===

  // 1. Check if this is a repeated read (potential inefficiency)
  const readCount = await getSessionReadCount(params.filePath);

  if (readCount >= 3) {
    // 2. Log repeated read as potential trauma
    await hippocampus.addEvent({
      timestamp: new Date().toISOString(),
      session_id: params.sessionId,
      context: {
        project_root: params.projectRoot,
        files_involved: [params.filePath],
        cwd_at_time: params.cwd,
        spatial_path: getSpatialPath(params.filePath),
        spatial_depth: getDepth(params.filePath),
        session_start: params.sessionStart,
        turn_in_session: params.turnNumber,
        current_goal: params.currentGoal
      },
      action: {
        type: 'read',
        description: `Repeated read of ${params.filePath} (count: ${readCount})`,
        tokens_spent: params.tokensUsed,
        files_read: [params.filePath]
      },
      outcome: {
        valence: 'neutral',
        intensity: 0.2,
        reflection: `File read ${readCount} times in session. Consider checking anatomy.md first.`
      },
      source: 'hook',
      tags: ['repeated-read', 'efficiency']
    });

    // 3. Potentially surface this as a warning
    if (readCount === 3) {
      return {
        ...params.result,
        warning: `You've read ${params.filePath} ${readCount} times this session. Check .wolf/anatomy.md first.`
      };
    }
  }

  // 4. Track read for consolidation scoring
  const recentReads = await hippocampus.getEventsInLocation(params.filePath);
  if (recentReads.length > 0) {
    // Increment access count for consolidation
    for (const event of recentReads) {
      if (event.action.type === 'read') {
        event.consolidation.access_count++;
        event.consolidation.last_accessed = new Date().toISOString();
      }
    }
  }

  return params.result;
}
```

### 3.4 pre-write.ts

```typescript
// src/hooks/pre-write.ts (existing) + hippocampus integration

import { Hippocampus } from '../hippocampus/index.js';

export async function preWrite(params: PreWriteParams) {
  const hippocampus = new Hippocampus(params.projectRoot);

  // === EXISTING BEHAVIOR ===
  const result = await checkCerebrum(params.filePath);

  // === NEW: Hippocampus warning ===

  // 1. Check for traumas that might apply to this file
  const fileDir = getDirectory(params.filePath);
  const traumas = await hippocampus.recallByLocation(fileDir, {
    valence: ['trauma', 'penalty'],
    limit: 5
  });

  // 2. Filter to relevant traumas
  const relevantTraumas = traumas.filter(t =>
    // Check if action type matches
    matchesActionType(t.action.type, params.writeType) &&
    // Check intensity threshold
    t.outcome.intensity >= 0.5
  );

  if (relevantTraumas.length > 0) {
    // 3. Build caution message
    const cautions = relevantTraumas.map(t =>
      `⚡ ${t.outcome.reflection} [${t.action.type}]`
    ).join('\n');

    return {
      ...result,
      caution: cautions,
      hippocampus_caution: true
    };
  }

  // 4. Check for related reward patterns (what worked well)
  const rewards = await hippocampus.recallByLocation(fileDir, {
    valence: ['reward'],
    limit: 3
  });

  if (rewards.length > 0) {
    const suggestions = rewards
      .filter(r => matchesActionType(r.action.type, params.writeType))
      .map(r => `✓ ${r.outcome.reflection}`)
      .join('\n');

    return {
      ...result,
      suggestion: suggestions
    };
  }

  return result;
}
```

### 3.5 post-write.ts

```typescript
// src/hooks/post-write.ts (existing) + hippocampus integration

import { Hippocampus } from '../hippocampus/index.js';

export async function postWrite(params: PostWriteParams) {
  const hippocampus = new Hippocampus(params.projectRoot);

  // === EXISTING BEHAVIOR ===
  await updateAnatomyForNewFile(params.filePath);
  await appendToMemory(params.writeSummary);

  // === NEW: Hippocampus event creation ===

  // 1. Determine valence from outcome
  let valence: 'reward' | 'neutral' | 'penalty' | 'trauma' = 'neutral';
  let intensity = 0.5;
  let reflection = '';

  if (params.error) {
    valence = 'penalty';
    intensity = 0.6;
    reflection = `Write failed: ${params.error.message}`;
  } else if (params.buildPassed === false) {
    valence = 'penalty';
    intensity = 0.7;
    reflection = 'Build failed after write';
  } else if (params.buildPassed === true) {
    valence = 'reward';
    intensity = 0.5;
    reflection = 'Build passed after write';
  } else {
    reflection = params.writeSummary || 'File written';
  }

  // 2. Check for recurring edits (potential problem)
  const existingEvents = await hippocampus.getEventsInLocation(params.filePath);
  const editCount = existingEvents.filter(e =>
    e.action.type === 'edit' && e.context.files_involved.includes(params.filePath)
  ).length;

  if (editCount >= 2) {
    valence = 'trauma';
    intensity = 0.6 + (editCount * 0.1);  // Escalate with each edit
    reflection = `File edited ${editCount + 1} times. Possible issue.`;
  }

  // 3. Create event
  const event = await hippocampus.addEvent({
    timestamp: new Date().toISOString(),
    session_id: params.sessionId,
    context: {
      project_root: params.projectRoot,
      files_involved: [params.filePath],
      cwd_at_time: params.cwd,
      spatial_path: getSpatialPath(params.filePath),
      spatial_depth: getDepth(params.filePath),
      session_start: params.sessionStart,
      turn_in_session: params.turnNumber,
      current_goal: params.currentGoal
    },
    action: {
      type: params.isNew ? 'write' : 'edit',
      description: params.writeSummary,
      tokens_spent: params.tokensUsed,
      files_modified: [params.filePath],
      succeeded: !params.error && params.buildPassed !== false
    },
    outcome: {
      valence,
      intensity: Math.min(1.0, intensity),
      reflection,
      is_recurring: editCount >= 2,
      related_events: editCount >= 1 ? existingEvents.slice(-1).map(e => e.id) : []
    },
    source: 'hook',
    tags: extractTags(params.filePath, params.writeSummary)
  });

  // 4. Update anatomy reference
  if (event.outcome.valence === 'trauma') {
    await updateAnatomyTraumaWarning(params.filePath, event.outcome.reflection);
  }

  return { success: true, event_id: event.id };
}
```

### 3.6 stop.ts

```typescript
// src/hooks/stop.ts (existing) + hippocampus integration

import { Hippocampus } from '../hippocampus/index.js';

export async function stop(params: StopParams) {
  const hippocampus = new Hippocampus(params.projectRoot);

  // === EXISTING BEHAVIOR ===
  await updateAnatomyFromSession();
  await appendSessionSummary(params.summary);

  // === NEW: Hippocampus session summary ===

  // 1. Get all events from this session
  const sessionEvents = await hippocampus.getRecentEvents(100)
    .then(events => events.filter(e => e.session_id === params.sessionId));

  // 2. Analyze session
  const sessionAnalysis = analyzeSession(sessionEvents);

  // 3. Create session summary event
  await hippocampus.addEvent({
    timestamp: new Date().toISOString(),
    session_id: params.sessionId,
    context: {
      project_root: params.projectRoot,
      files_involved: sessionAnalysis.filesModified,
      cwd_at_time: params.cwd,
      spatial_path: '',
      spatial_depth: 0,
      session_start: params.sessionStart,
      turn_in_session: sessionEvents.length
    },
    action: {
      type: 'discover',
      description: `Session summary: ${sessionAnalysis.totalFiles} files, ${sessionAnalysis.successful} successful, ${sessionAnalysis.failed} failed`,
      tokens_spent: sessionAnalysis.totalTokens
    },
    outcome: {
      valence: sessionAnalysis.overallValence,
      intensity: sessionAnalysis.intensity,
      reflection: sessionAnalysis.summary
    },
    source: 'hook',
    tags: ['session-end', 'summary']
  });

  // 4. Trigger consolidation if session had many events
  if (sessionEvents.length >= 10) {
    // Schedule consolidation (don't wait)
    setTimeout(() => hippocampus.runConsolidation(), 1000);
  }

  return { success: true };
}
```

---

## 4. Hippocampus Module Skeleton

### 4.1 src/hippocampus/types.ts

```typescript
// Re-export all types from docs
export type { WolfEvent, EventContext, EventAction, EventOutcome, EventConsolidation } from '../../docs2/01-event-model.js';
export type { LocationCue, QuestionCue, StateCue, RecallRequest, RecallResponse } from '../../docs2/02-cue-system.js';
export type { NeocortexEntry, NeocortexStore } from '../../docs2/04-implementation-spec.js';

// === Additional types used in Hippocampus class ===

export type QuestionType = "how-to" | "why-not" | "what-if" | "what-happened" | "general";

export interface RecallFilters {
  valence?: ("reward" | "neutral" | "penalty" | "trauma")[];
  min_intensity?: number;
  max_age_days?: number;
  tags?: string[];
  exclude_forgotten?: boolean;
}

export interface ConsolidationResult {
  event_id: string;
  action: "promote" | "merge" | "decay" | "forget" | "keep";
  new_location: string;
  details: string;
}

export interface HippoStats {
  total_events: number;
  buffer_size: number;
  neocortex_entries: number;
  trauma_count: number;
  reward_count: number;
  penalty_count: number;
  neutral_count: number;
  forgotten_count: number;
  last_consolidation: string | null;
}
```

### 4.2 src/hippocampus/index.ts (main module)

```typescript
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { HippocampusStore, WolfEvent, RecallRequest, RecallResponse } from './types.js';

export class Hippocampus {
  private projectRoot: string;
  private hippocampusPath: string;
  private neocortexPath: string;
  private cueIndexPath: string;
  private memoryDir: string;
  private store: HippocampusStore | null = null;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.hippocampusPath = join(projectRoot, '.wolf', 'hippocampus.json');
    this.neocortexPath = join(projectRoot, '.wolf', 'neocortex.json');
    this.cueIndexPath = join(projectRoot, '.wolf', 'cue-index.json');
    this.memoryDir = join(projectRoot, '.wolf', 'memory', 'events');
  }

  async initialize(): Promise<void> {
    // Ensure directories exist
    await mkdir(this.memoryDir, { recursive: true });

    // Load or create store
    if (existsSync(this.hippocampusPath)) {
      const data = await readFile(this.hippocampusPath, 'utf-8');
      this.store = JSON.parse(data);
    } else {
      this.store = createEmptyStore();
      await this.save();
    }
  }

  async addEvent(eventData: Omit<WolfEvent, 'id' | 'consolidation'>): Promise<WolfEvent> {
    await this.initialize();

    const event: WolfEvent = {
      ...eventData,
      id: `evt-${crypto.randomUUID()}`,
      consolidation: {
        stage: 'short-term',
        access_count: 0,
        last_accessed: eventData.timestamp,
        consolidation_score: 0,
        should_consolidate: false,
        decay_factor: 1.0,
        last_decay_check: eventData.timestamp
      }
    };

    this.store!.buffer.push(event);
    this.store!.size_bytes = JSON.stringify(this.store).length;

    // Save individual event file
    await this.saveEventToFile(event);

    // Update stats
    this.updateStats(event);

    // Save store
    await this.save();

    return event;
  }

  async recall(request: RecallRequest): Promise<RecallResponse> {
    await this.initialize();

    // Get candidate events from index
    const candidates = await this.getCandidatesFromIndex(request.cue);

    // Load and filter
    const events = await Promise.all(
      candidates.map(id => this.loadEventFromFile(id))
    );

    const filtered = events.filter(e => this.matchesFilters(e, request.filters));

    // Score and sort
    const scored = filtered.map(e => ({
      event: e,
      confidence: this.scoreEvent(e, request.cue)
    })).sort((a, b) => b.confidence - a.confidence);

    // Return top N
    const limit = request.limit || 5;
    const results = scored.slice(0, limit);

    return {
      events: results.map(r => r.event),
      total_matches: filtered.length,
      confidence: results[0]?.confidence || 0,
      match_details: results.map(r => ({
        event_id: r.event.id,
        confidence: r.confidence,
        match_reasons: this.explainMatch(r.event, request.cue)
      }))
    };
  }

  // ... more methods
}
```

---

## 5. Configuration

### 5.1 Hippocampus Config (in .wolf/config.json)

```json
{
  "hippocampus": {
    "enabled": true,
    "buffer_size": 500,
    "retention_days": 7,
    "consolidation": {
      "enabled": true,
      "interval_hours": 6,
      "off_peak_only": true,
      "threshold": 0.7
    },
    "decay": {
      "enabled": true,
      "interval_days": 7,
      "rate": 0.95,
      "forget_threshold": 0.1
    },
    "trauma_never_decay": true
  }
}
```

---

## 6. Open Questions

| Question | Options | Recommendation |
|----------|---------|----------------|
| Hippocampus opt-out? | Always on / Configurable / Per-project | **Configurable** — some users may not want it |
| Performance impact on hooks? | Async fire-and-forget / Blocking | **Async with error isolation** — can't slow hooks |
| Event batching? | One per action / Batch on stop | **Batching on stop** for performance |
| Backward compat with existing memory.md? | Keep both / Migrate / Deprecate | **Keep both** — gradual migration |
| CLI command to view events? | New command / Extend status | **Extend status** (`openwolf status --events`) |
