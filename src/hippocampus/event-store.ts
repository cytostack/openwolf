// Hippocampus Event Store — CRUD for hippocampus.json

import { HippocampusStore, WolfEvent, Valence } from "./types.js";
import { readJsonFile, writeJsonAtomic } from "./persistence.js";

// Re-export types for external use
export type { HippocampusStore, WolfEvent, Valence };

const DEFAULT_CONFIG = {
  max_size_bytes: 5_000_000,
  retention_days: 7,
  max_buffer_size: 500,
};

export function createEmptyStore(projectRoot: string): HippocampusStore {
  const now = new Date().toISOString();
  return {
    version: 1,
    schema_version: 1,
    project_root: projectRoot,
    created_at: now,
    last_updated: now,
    buffer: [],
    stats: {
      total_events: 0,
      reward_count: 0,
      penalty_count: 0,
      trauma_count: 0,
      neutral_count: 0,
      recurrences: 0,
      negative_writes: 0,
      oldest_event: null,
      newest_event: null,
    },
    size_bytes: 0,
    max_size_bytes: DEFAULT_CONFIG.max_size_bytes,
    retention_days: DEFAULT_CONFIG.retention_days,
    max_buffer_size: DEFAULT_CONFIG.max_buffer_size,
  };
}

export function loadStore(
  hippocampusPath: string,
  recoverCorrupt: boolean = false
): HippocampusStore | null {
  const store = readJsonFile<HippocampusStore>(hippocampusPath, recoverCorrupt);
  return store ? normalizeStoreStats(store) : null;
}

/**
 * Backfill recurrence counters on stores written before they existed so
 * legacy projects never read or persist NaN/null for the new stats.
 */
function normalizeStoreStats(store: HippocampusStore): HippocampusStore {
  const stats = store.stats;
  if (typeof stats.recurrences !== "number" || !Number.isFinite(stats.recurrences)) {
    stats.recurrences = 0;
  }
  if (typeof stats.negative_writes !== "number" || !Number.isFinite(stats.negative_writes)) {
    stats.negative_writes = 0;
  }
  return store;
}

export function saveStore(hippocampusPath: string, store: HippocampusStore): void {
  store.last_updated = new Date().toISOString();
  store.size_bytes = Buffer.byteLength(JSON.stringify(store), "utf-8");
  writeJsonAtomic(hippocampusPath, store);
}

/** Next 1-based turn for `sessionId` from events already in the buffer. */
export function nextTurnInSession(store: HippocampusStore, sessionId: string): number {
  let max = 0;
  for (const event of store.buffer) {
    if (event.session_id !== sessionId) continue;
    const turn = event.context.turn_in_session;
    if (Number.isInteger(turn) && turn > max) max = turn;
  }
  return max + 1;
}

export function addEventToStore(store: HippocampusStore, event: WolfEvent): void {
  event.context.turn_in_session = nextTurnInSession(store, event.session_id);
  store.buffer.push(event);
  store.stats.total_events++;

  if (event.outcome.valence === "penalty" || event.outcome.valence === "trauma") {
    store.stats.negative_writes = (store.stats.negative_writes ?? 0) + 1;
  }

  // Update valence counts
  switch (event.outcome.valence) {
    case "reward":
      store.stats.reward_count++;
      break;
    case "penalty":
      store.stats.penalty_count++;
      break;
    case "trauma":
      store.stats.trauma_count++;
      break;
    case "neutral":
      store.stats.neutral_count++;
      break;
  }

  // Update oldest/newest
  if (!store.stats.oldest_event || event.timestamp < store.stats.oldest_event) {
    store.stats.oldest_event = event.timestamp;
  }
  if (!store.stats.newest_event || event.timestamp > store.stats.newest_event) {
    store.stats.newest_event = event.timestamp;
  }

  // Enforce max buffer size — evict oldest non-trauma events first
  while (store.buffer.length > store.max_buffer_size) {
    const evictIndex = store.buffer.findIndex(
      (e) => e.outcome.valence !== "trauma"
    );
    if (evictIndex === -1) break; // Can't evict trauma events
    store.buffer.splice(evictIndex, 1);
  }
}

export function getEventsByLocation(
  store: HippocampusStore,
  filePath: string
): WolfEvent[] {
  return store.buffer.filter((event) =>
    event.context.files_involved.some(
      (f) => f === filePath || f.startsWith(filePath + "/") || filePath.startsWith(f + "/")
    )
  );
}

export function getTraumaEvents(store: HippocampusStore): WolfEvent[] {
  return store.buffer.filter((e) => e.outcome.valence === "trauma");
}

export function getTraumaEventsForPath(
  store: HippocampusStore,
  filePath: string
): WolfEvent[] {
  return getTraumaEvents(store).filter((event) =>
    event.context.files_involved.some(
      (f) => f === filePath || f.startsWith(filePath + "/") || filePath.startsWith(f + "/")
    )
  );
}

/** Increment the durable recurrence counter for repeated negative outcomes. */
export function incrementRecurrences(store: HippocampusStore): void {
  store.stats.recurrences = (store.stats.recurrences ?? 0) + 1;
}

export function filterEvents(
  store: HippocampusStore,
  filters: {
    valence?: Valence[];
    min_intensity?: number;
    max_age_days?: number;
  }
): WolfEvent[] {
  let events = store.buffer;

  if (filters.valence && filters.valence.length > 0) {
    events = events.filter((e) => filters.valence!.includes(e.outcome.valence));
  }

  if (filters.min_intensity !== undefined) {
    events = events.filter((e) => e.outcome.intensity >= filters.min_intensity!);
  }

  if (filters.max_age_days !== undefined) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - filters.max_age_days);
    events = events.filter((e) => new Date(e.timestamp) >= cutoff);
  }

  return events;
}
