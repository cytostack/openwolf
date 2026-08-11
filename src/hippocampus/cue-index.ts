// Hippocampus Memory System — Cue Index

import * as path from "node:path";
import type { WolfEvent, CueIndex } from "./types.js";
import { normalizeRecallPath } from "./cue-recall.js";
import { backupCorruptFile, readJsonFile, writeJsonAtomic } from "./persistence.js";

const CUE_INDEX_FILENAME = "cue-index.json";

function normalizeIndexedPath(filePath: string): string {
  return normalizeRecallPath(filePath);
}

/** Build a complete cue index from the current hippocampus buffer. */
export function buildIndex(events: WolfEvent[]): CueIndex {
  const sorted = [...events].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
  const index: CueIndex = {
    version: 1,
    last_updated: new Date().toISOString(),
    event_ids: sorted.map((event) => event.id),
    location_index: {},
    tag_index: {},
    trauma_index: {
      all_trauma_ids: [],
      by_path: {},
    },
  };

  for (const event of sorted) addEventToIndex(index, event, false);
  return index;
}

export function sortTraumaByIntensity(
  traumaIds: string[],
  events: Map<string, WolfEvent>
): string[] {
  return [...traumaIds].sort((a, b) => {
    const eventA = events.get(a);
    const eventB = events.get(b);
    if (!eventA || !eventB) return 0;
    return eventB.outcome.intensity - eventA.outcome.intensity;
  });
}

export function getCueIndexPath(projectRoot: string): string {
  return path.join(projectRoot, ".wolf", CUE_INDEX_FILENAME);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isIndexMap(value: unknown): value is Record<string, string[]> {
  return (
    value !== null &&
    typeof value === "object" &&
    Object.values(value).every(isStringArray)
  );
}

export function loadIndex(
  indexPath: string,
  recoverCorrupt: boolean = false
): CueIndex | null {
  const parsed = readJsonFile<Partial<CueIndex>>(indexPath, recoverCorrupt);
  if (parsed === null) return null;
  if (
    parsed.version !== 1 ||
    !isIndexMap(parsed.location_index) ||
    !isIndexMap(parsed.tag_index) ||
    !parsed.trauma_index || typeof parsed.trauma_index !== "object" ||
    !isStringArray(parsed.trauma_index.all_trauma_ids) ||
    !isIndexMap(parsed.trauma_index.by_path) ||
    (parsed.event_ids !== undefined && !isStringArray(parsed.event_ids))
  ) {
    if (recoverCorrupt) backupCorruptFile(indexPath);
    return null;
  }
  return parsed as CueIndex;
}

export function saveIndex(indexPath: string, index: CueIndex): void {
  index.last_updated = new Date().toISOString();
  writeJsonAtomic(indexPath, index);
}

/** Add one event to an in-memory index. */
export function addEventToIndex(
  index: CueIndex,
  event: WolfEvent,
  addToWatermark: boolean = true
): void {
  if (!index.event_ids) index.event_ids = [];
  if (addToWatermark && !index.event_ids.includes(event.id)) {
    index.event_ids.unshift(event.id);
  }

  for (const rawFile of event.context.files_involved) {
    const file = normalizeIndexedPath(rawFile);
    if (!index.location_index[file]) index.location_index[file] = [];
    if (!index.location_index[file].includes(event.id)) {
      if (addToWatermark) index.location_index[file].unshift(event.id);
      else index.location_index[file].push(event.id);
    }
  }

  for (const tag of event.tags) {
    if (!index.tag_index[tag]) index.tag_index[tag] = [];
    if (!index.tag_index[tag].includes(event.id)) {
      if (addToWatermark) index.tag_index[tag].unshift(event.id);
      else index.tag_index[tag].push(event.id);
    }
  }

  if (event.outcome.valence === "trauma") {
    if (!index.trauma_index.all_trauma_ids.includes(event.id)) {
      if (addToWatermark) index.trauma_index.all_trauma_ids.unshift(event.id);
      else index.trauma_index.all_trauma_ids.push(event.id);
    }
    for (const rawFile of event.context.files_involved) {
      const file = normalizeIndexedPath(rawFile);
      if (!index.trauma_index.by_path[file]) index.trauma_index.by_path[file] = [];
      if (!index.trauma_index.by_path[file].includes(event.id)) {
        if (addToWatermark) index.trauma_index.by_path[file].unshift(event.id);
        else index.trauma_index.by_path[file].push(event.id);
      }
    }
  }
}

export function removeEventFromIndex(index: CueIndex, eventId: string): void {
  if (index.event_ids) index.event_ids = index.event_ids.filter((id) => id !== eventId);
  for (const key of Object.keys(index.location_index)) {
    index.location_index[key] = index.location_index[key].filter((id) => id !== eventId);
    if (index.location_index[key].length === 0) delete index.location_index[key];
  }
  for (const key of Object.keys(index.tag_index)) {
    index.tag_index[key] = index.tag_index[key].filter((id) => id !== eventId);
    if (index.tag_index[key].length === 0) delete index.tag_index[key];
  }
  index.trauma_index.all_trauma_ids = index.trauma_index.all_trauma_ids.filter(
    (id) => id !== eventId
  );
  for (const key of Object.keys(index.trauma_index.by_path)) {
    index.trauma_index.by_path[key] = index.trauma_index.by_path[key].filter(
      (id) => id !== eventId
    );
    if (index.trauma_index.by_path[key].length === 0) {
      delete index.trauma_index.by_path[key];
    }
  }
}

export function createEmptyIndex(): CueIndex {
  return buildIndex([]);
}

function sameIds(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const expected = new Set(right);
  return new Set(left).size === expected.size && left.every((id) => expected.has(id));
}

function sameIndexMap(
  actual: Record<string, string[]>,
  expected: Record<string, string[]>
): boolean {
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  if (actualKeys.join("\0") !== expectedKeys.join("\0")) return false;
  return actualKeys.every((key) => sameIds(actual[key], expected[key]));
}

/** Detect missing, stale, partial, or legacy cue indexes. */
export function indexNeedsRebuild(
  index: CueIndex | null,
  events: readonly WolfEvent[] | number
): boolean {
  if (index === null) return true;

  // Retain compatibility with the old count-based helper for downstream users.
  if (typeof events === "number") {
    const indexedIds = index.event_ids ?? Object.values(index.location_index).flat();
    return indexedIds.length === 0 && events > 0;
  }

  if (!Array.isArray(index.event_ids)) return true;
  const expected = buildIndex([...events]);
  return !(
    sameIds(index.event_ids, expected.event_ids ?? []) &&
    sameIndexMap(index.location_index, expected.location_index) &&
    sameIndexMap(index.tag_index, expected.tag_index) &&
    sameIds(index.trauma_index.all_trauma_ids, expected.trauma_index.all_trauma_ids) &&
    sameIndexMap(index.trauma_index.by_path, expected.trauma_index.by_path)
  );
}
