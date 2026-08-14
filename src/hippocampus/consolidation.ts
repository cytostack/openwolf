// Hippocampus Consolidation — Neocortex Store & Memory Transfer

import { WolfEvent, HippocampusStore, ConsolidationStage } from "./types.js";
import { readJsonFile, writeJsonAtomic } from "./persistence.js";

export interface NeocortexStore {
  version: 1;
  schema_version: 1;
  project_root: string;
  created_at: string;
  last_updated: string;
  events: WolfEvent[];
  stats: {
    total_consolidated: number;
    by_valence: Record<string, number>;
    last_consolidation: string | null;
  };
  size_bytes: number;
  max_size_bytes: number;
}

export interface ConsolidationResult {
  event_id: string;
  action: "promote" | "decay" | "forget" | "keep";
  old_stage: ConsolidationStage;
  new_stage?: ConsolidationStage;
  decay_factor?: number;
  details: string;
}

export interface ConsolidationReport {
  timestamp: string;
  events_processed: number;
  promoted: number;
  decayed: number;
  forgotten: number;
  kept: number;
  new_neocortex_size: number;
  /** Complete IDs promoted into long-term storage, independent of report truncation. */
  transferred_event_ids: string[];
  results: ConsolidationResult[];
}

export interface PendingLongTermTransfer {
  version: 1;
  created_at: string;
  events: WolfEvent[];
}

const DEFAULT_CONFIG = {
  max_size_bytes: 10_000_000, // 10MB neocortex store
  consolidation_threshold_score: 0.7, // Min score to promote
  weekly_decay_rate: 0.05, // 5% decay per week
  trauma_decay_rate: 0, // Trauma never decays
  decay_half_life_days: 90, // Half-life for decay calculation
};

// ─── Neocortex Store CRUD ─────────────────────────────────────

export function createEmptyNeocortex(projectRoot: string): NeocortexStore {
  const now = new Date().toISOString();
  return {
    version: 1,
    schema_version: 1,
    project_root: projectRoot,
    created_at: now,
    last_updated: now,
    events: [],
    stats: {
      total_consolidated: 0,
      by_valence: { reward: 0, neutral: 0, penalty: 0, trauma: 0 },
      last_consolidation: null,
    },
    size_bytes: 0,
    max_size_bytes: DEFAULT_CONFIG.max_size_bytes,
  };
}

export function loadNeocortex(
  neocortexPath: string,
  recoverCorrupt: boolean = false
): NeocortexStore | null {
  return readJsonFile<NeocortexStore>(neocortexPath, recoverCorrupt);
}

export function saveNeocortex(neocortexPath: string, store: NeocortexStore): void {
  store.last_updated = new Date().toISOString();
  store.size_bytes = Buffer.byteLength(JSON.stringify(store), "utf-8");
  writeJsonAtomic(neocortexPath, store);
}

export function enforceNeocortexSize(store: NeocortexStore): void {
  store.size_bytes = Buffer.byteLength(JSON.stringify(store), "utf-8");
  while (store.events.length > 0 && store.size_bytes > store.max_size_bytes) {
    const evictIdx = store.events.findIndex(
      (event) => event.outcome.valence === "neutral" && event.outcome.intensity < 0.5
    );
    if (evictIdx === -1) {
      store.events.shift();
    } else {
      store.events.splice(evictIdx, 1);
    }
    store.size_bytes = Buffer.byteLength(JSON.stringify(store), "utf-8");
  }
}

export function mergeEventsIntoNeocortex(
  neocortexStore: NeocortexStore,
  events: readonly WolfEvent[]
): number {
  const existingIds = new Set(neocortexStore.events.map((event) => event.id));
  let added = 0;

  for (const event of events) {
    if (existingIds.has(event.id)) continue;
    event.consolidation.stage = "long-term";
    neocortexStore.events.push(event);
    existingIds.add(event.id);
    neocortexStore.stats.total_consolidated++;
    neocortexStore.stats.by_valence[event.outcome.valence] =
      (neocortexStore.stats.by_valence[event.outcome.valence] || 0) + 1;
    added++;
  }

  return added;
}

// ─── Consolidation Logic ─────────────────────────────────────

/**
 * Calculate decay factor based on time since last check.
 * Uses exponential decay with configurable half-life.
 */
export function calculateDecay(
  lastDecayCheck: string,
  valence: string,
  currentDecayFactor: number
): number {
  const now = new Date();
  const lastCheck = new Date(lastDecayCheck);
  const daysSinceCheck = (now.getTime() - lastCheck.getTime()) / (1000 * 60 * 60 * 24);

  const decayRate = valence === "trauma"
    ? DEFAULT_CONFIG.trauma_decay_rate
    : DEFAULT_CONFIG.weekly_decay_rate;

  const weeklyDecays = daysSinceCheck / 7;
  const decayAmount = 1 - (decayRate * weeklyDecays);

  // Never increase decay factor (memory doesn't "un-decay")
  return Math.max(currentDecayFactor * decayAmount, 0);
}

/**
 * Calculate consolidation score for an event.
 * Higher score = more important to retain.
 */
export function calculateConsolidationScore(event: WolfEvent): number {
  let score = 0;

  // Base score from intensity (0-1)
  score += event.outcome.intensity * 0.3;

  // Access count bonus (recently accessed events are more important)
  score += Math.min(event.consolidation.access_count * 0.05, 0.3);

  // Valence bonus
  switch (event.outcome.valence) {
    case "reward":
      score += 0.2;
      break;
    case "trauma":
      score += 0.25; // Trauma events are important to remember
      break;
    case "penalty":
      score += 0.1;
      break;
    case "neutral":
      score += 0;
      break;
  }

  // Recency bonus (events from last 7 days get a boost)
  const eventDate = new Date(event.timestamp);
  const now = new Date();
  const daysSinceEvent = (now.getTime() - eventDate.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceEvent <= 7) {
    score += 0.15;
  }

  // Apply decay factor
  score *= event.consolidation.decay_factor;

  return Math.min(score, 1.0);
}

/**
 * Determine consolidation action for a single event.
 */
export function determineConsolidationAction(
  event: WolfEvent,
  now: Date
): ConsolidationResult {
  const { consolidation } = event;

  // Calculate time-based decay
  const daysSinceLastCheck = (now.getTime() - new Date(consolidation.last_decay_check).getTime()) / (1000 * 60 * 60 * 24);
  const newDecayFactor = calculateDecay(
    consolidation.last_decay_check,
    event.outcome.valence,
    consolidation.decay_factor
  );

  // Calculate consolidation score
  const score = calculateConsolidationScore({
    ...event,
    consolidation: { ...consolidation, decay_factor: newDecayFactor }
  });

  // Determine action based on stage and score
  switch (consolidation.stage) {
    case "short-term":
      if (score >= DEFAULT_CONFIG.consolidation_threshold_score) {
        return {
          event_id: event.id,
          action: "promote",
          old_stage: "short-term",
          new_stage: "consolidating",
          decay_factor: newDecayFactor,
          details: `Promoting to consolidating (score: ${score.toFixed(3)}, decay: ${newDecayFactor.toFixed(3)})`,
        };
      } else if (daysSinceLastCheck >= 7) {
        return {
          event_id: event.id,
          action: "decay",
          old_stage: "short-term",
          decay_factor: newDecayFactor,
          details: `Decaying in buffer (score: ${score.toFixed(3)}, decay: ${newDecayFactor.toFixed(3)})`,
        };
      } else {
        return {
          event_id: event.id,
          action: "keep",
          old_stage: "short-term",
          decay_factor: newDecayFactor,
          details: `Keeping in short-term (score: ${score.toFixed(3)})`,
        };
      }

    case "consolidating":
      if (score >= DEFAULT_CONFIG.consolidation_threshold_score * 1.2) {
        return {
          event_id: event.id,
          action: "promote",
          old_stage: "consolidating",
          new_stage: "long-term",
          decay_factor: newDecayFactor,
          details: `Promoting to long-term neocortex (score: ${score.toFixed(3)})`,
        };
      } else if (score < 0.2) {
        return {
          event_id: event.id,
          action: "forget",
          old_stage: "consolidating",
          decay_factor: newDecayFactor,
          details: `Forgetting low-importance event (score: ${score.toFixed(3)})`,
        };
      } else {
        return {
          event_id: event.id,
          action: "keep",
          old_stage: "consolidating",
          decay_factor: newDecayFactor,
          details: `Keeping in consolidating (score: ${score.toFixed(3)})`,
        };
      }

    case "long-term":
      if (score < 0.1) {
        return {
          event_id: event.id,
          action: "forget",
          old_stage: "long-term",
          decay_factor: newDecayFactor,
          details: `Forgetting from long-term (score: ${score.toFixed(3)})`,
        };
      } else {
        return {
          event_id: event.id,
          action: "keep",
          old_stage: "long-term",
          decay_factor: newDecayFactor,
          details: `Retaining in long-term (score: ${score.toFixed(3)})`,
        };
      }

    default:
      return {
        event_id: event.id,
        action: "keep",
        old_stage: consolidation.stage,
        decay_factor: newDecayFactor,
        details: `Unknown stage: ${consolidation.stage}`,
      };
  }
}

/**
 * Run consolidation pass on the hippocampus store.
 * Returns events that should be moved to neocortex and updates the store.
 */
export function runConsolidation(
  hippocampusStore: HippocampusStore,
  neocortexStore: NeocortexStore,
  options?: {
    maxToPromote?: number;
    forceFullScan?: boolean;
  }
): ConsolidationReport {
  const now = new Date();
  const results: ConsolidationResult[] = [];
  const transferredEventIds: string[] = [];
  let promoted = 0;
  let decayed = 0;
  let forgotten = 0;
  let kept = 0;
  const maxToPromote = options?.maxToPromote ?? 50;

  // Process events that were already consolidating before this pass first, so
  // a stream of new short-term events cannot starve long-term transfers.
  const initiallyConsolidating = hippocampusStore.buffer.filter(
    (event) =>
      event.consolidation.stage === "consolidating" &&
      !event.consolidation.forgotten
  );

  for (const event of initiallyConsolidating) {
    if (promoted >= maxToPromote) break;

    const result = determineConsolidationAction(event, now);
    results.push(result);

    event.consolidation.decay_factor = result.decay_factor ?? event.consolidation.decay_factor;
    event.consolidation.last_decay_check = now.toISOString();

    if (result.action === "promote" && result.new_stage === "long-term") {
      event.consolidation.stage = "long-term";

      // Remove from hippocampus buffer. The caller journals and persists these
      // transfers destination-first before committing the source removal.
      const idx = hippocampusStore.buffer.indexOf(event);
      if (idx !== -1) hippocampusStore.buffer.splice(idx, 1);
      transferredEventIds.push(event.id);
      promoted++;
    } else if (result.action === "forget") {
      event.consolidation.forgotten = true;
      event.consolidation.forgotten_at = now.toISOString();
      hippocampusStore.buffer = hippocampusStore.buffer.filter((e) => e.id !== event.id);
      forgotten++;
    } else if (result.action === "keep") {
      kept++;
    }
  }

  // Advance short-term events with whatever promotion budget remains. They are
  // not eligible for long-term transfer until a later pass.
  const shortTermEvents = hippocampusStore.buffer.filter(
    (event) => event.consolidation.stage === "short-term"
  );
  for (const event of shortTermEvents) {
    if (promoted >= maxToPromote) break;
    const result = determineConsolidationAction(event, now);
    results.push(result);

    event.consolidation.decay_factor = result.decay_factor ?? event.consolidation.decay_factor;
    event.consolidation.last_decay_check = now.toISOString();

    switch (result.action) {
      case "promote":
        if (result.new_stage === "consolidating") {
          event.consolidation.stage = "consolidating";
          event.consolidation.should_consolidate = true;
          promoted++;
        }
        break;
      case "decay":
        decayed++;
        break;
      case "forget":
        event.consolidation.forgotten = true;
        event.consolidation.forgotten_at = now.toISOString();
        hippocampusStore.buffer = hippocampusStore.buffer.filter((e) => e.id !== event.id);
        forgotten++;
        break;
      case "keep":
        kept++;
        break;
    }
  }

  // Remove forgotten events from buffer
  hippocampusStore.buffer = hippocampusStore.buffer.filter((e) => !e.consolidation.forgotten);

  // Update neocortex stats
  neocortexStore.stats.last_consolidation = now.toISOString();

  enforceNeocortexSize(neocortexStore);

  return {
    timestamp: now.toISOString(),
    events_processed: results.length,
    promoted,
    decayed,
    forgotten,
    kept,
    new_neocortex_size: neocortexStore.size_bytes,
    transferred_event_ids: transferredEventIds,
    results: results.slice(0, 100), // Cap human-facing detail without hiding transfers
  };
}

/**
 * Get events from neocortex matching filters.
 */
export function getNeocortexEvents(
  neocortexStore: NeocortexStore,
  filters?: {
    valence?: string[];
    minIntensity?: number;
    limit?: number;
  }
): WolfEvent[] {
  let events = [...neocortexStore.events];

  if (filters?.valence && filters.valence.length > 0) {
    events = events.filter((e) => filters.valence!.includes(e.outcome.valence));
  }

  if (filters?.minIntensity !== undefined) {
    events = events.filter((e) => e.outcome.intensity >= filters.minIntensity!);
  }

  // Sort by recency
  events = events.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  if (filters?.limit) {
    events = events.slice(0, filters.limit);
  }

  return events;
}
