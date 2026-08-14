#!/usr/bin/env node
/**
 * T3 — Event Store CRUD Unit Tests
 * Run: node T3_event-store.test.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  createEmptyStore,
  loadStore,
  saveStore,
  addEventToStore,
  getEventsByLocation,
  getTraumaEvents,
  getTraumaEventsForPath,
  filterEvents,
} from "../../../src/hippocampus/event-store.js";

import type { HippocampusStore, WolfEvent } from "../../../src/hippocampus/types.js";

// Test utilities
let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

function createTestEvent(overrides: Partial<WolfEvent> = {}): Omit<WolfEvent, "id" | "consolidation"> {
  return {
    version: 1,
    timestamp: new Date().toISOString(),
    session_id: "test-session",
    context: {
      project_root: "/tmp/test",
      files_involved: ["/tmp/test/src/index.ts"],
      cwd_at_time: "/tmp/test",
      spatial_path: "src/",
      spatial_depth: 1,
      session_start: new Date().toISOString(),
      turn_in_session: 1,
    },
    action: {
      type: "write",
      description: "Test write",
      tokens_spent: 100,
      files_modified: ["/tmp/test/src/index.ts"],
    },
    outcome: {
      valence: "neutral",
      intensity: 0.3,
      reflection: "Test reflection",
    },
    source: "hook",
    tags: ["test"],
    ...overrides,
  };
}

// T3.1 — createEmptyStore() returns correct defaults
console.log("\nT3.1 — createEmptyStore() defaults");
{
  const store = createEmptyStore("/tmp/test-project");
  assert(store.version === 1, "version is 1");
  assert(store.schema_version === 1, "schema_version is 1");
  assert(store.project_root === "/tmp/test-project", "project_root set correctly");
  assert(store.buffer.length === 0, "buffer is empty array");
  assert(store.stats.total_events === 0, "total_events is 0");
  assert(store.stats.reward_count === 0, "reward_count is 0");
  assert(store.stats.penalty_count === 0, "penalty_count is 0");
  assert(store.stats.trauma_count === 0, "trauma_count is 0");
  assert(store.stats.neutral_count === 0, "neutral_count is 0");
  assert(store.max_size_bytes === 5_000_000, "max_size_bytes is 5_000_000");
  assert(store.retention_days === 7, "retention_days is 7");
  assert(store.max_buffer_size === 500, "max_buffer_size is 500");
}

// T3.2 — createEmptyStore(projectRoot) sets project_root correctly
console.log("\nT3.2 — createEmptyStore(projectRoot) field");
{
  const store = createEmptyStore("/my/custom/path");
  assert(store.project_root === "/my/custom/path", "project_root matches input");
}

// T3.3 — loadStore() returns null for missing file
console.log("\nT3.3 — loadStore() non-existent path");
{
  const store = loadStore("/non/existent/path/hippocampus.json");
  assert(store === null, "returns null for missing file");
}

// T3.4 — Round-trip: create → save → load
console.log("\nT3.4 — Round-trip create/save/load");
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hippocampus-test-"));
  const storePath = path.join(tmpDir, "hippocampus.json");

  const original = createEmptyStore(tmpDir);
  const event = createTestEvent();
  addEventToStore(original, {
    ...event,
    id: "evt-test-123",
    consolidation: {
      stage: "short-term",
      access_count: 0,
      last_accessed: new Date().toISOString(),
      consolidation_score: 0,
      should_consolidate: false,
      decay_factor: 1.0,
      last_decay_check: new Date().toISOString(),
    },
  } as WolfEvent);

  saveStore(storePath, original);
  const loaded = loadStore(storePath);

  assert(loaded !== null, "loaded is not null");
  if (loaded) {
    assert(loaded.buffer.length === 1, "buffer has 1 event");
    assert(loaded.buffer[0].id === "evt-test-123", "event ID preserved");
    assert(loaded.stats.total_events === 1, "total_events is 1");
  }

  fs.rmSync(tmpDir, { recursive: true });
}

// T3.5 — addEventToStore() increments neutral_count
console.log("\nT3.5 — addEventToStore() neutral event");
{
  const store = createEmptyStore("/tmp/test");
  const event = createTestEvent({ outcome: { valence: "neutral", intensity: 0.3, reflection: "" } });
  addEventToStore(store, {
    ...event,
    id: "evt-1",
    consolidation: {
      stage: "short-term",
      access_count: 0,
      last_accessed: new Date().toISOString(),
      consolidation_score: 0,
      should_consolidate: false,
      decay_factor: 1.0,
      last_decay_check: new Date().toISOString(),
    },
  } as WolfEvent);

  assert(store.stats.neutral_count === 1, "neutral_count is 1");
  assert(store.stats.total_events === 1, "total_events is 1");
}

// T3.6 — addEventToStore() handles trauma
console.log("\nT3.6 — addEventToStore() trauma event");
{
  const store = createEmptyStore("/tmp/test");
  const event = createTestEvent({ outcome: { valence: "trauma", intensity: 0.8, reflection: "" } });
  addEventToStore(store, {
    ...event,
    id: "evt-2",
    consolidation: {
      stage: "short-term",
      access_count: 0,
      last_accessed: new Date().toISOString(),
      consolidation_score: 0,
      should_consolidate: false,
      decay_factor: 1.0,
      last_decay_check: new Date().toISOString(),
    },
  } as WolfEvent);

  assert(store.stats.trauma_count === 1, "trauma_count is 1");
  assert(store.stats.total_events === 1, "total_events is 1");
}

// T3.7 — Buffer eviction: oldest non-trauma evicted at limit
console.log("\nT3.7 — Buffer eviction of oldest non-trauma");
{
  const store = createEmptyStore("/tmp/test");
  store.max_buffer_size = 5; // Small for testing

  // Add 3 non-trauma events
  for (let i = 0; i < 3; i++) {
    const event = createTestEvent({
      outcome: { valence: "neutral", intensity: 0.3, reflection: "" },
      timestamp: new Date(Date.now() - i * 1000).toISOString(),
    });
    addEventToStore(store, {
      ...event,
      id: `evt-neutral-${i}`,
      consolidation: {
        stage: "short-term",
        access_count: 0,
        last_accessed: new Date().toISOString(),
        consolidation_score: 0,
        should_consolidate: false,
        decay_factor: 1.0,
        last_decay_check: new Date().toISOString(),
      },
    } as WolfEvent);
  }

  // Add 2 trauma events (older)
  for (let i = 0; i < 2; i++) {
    const event = createTestEvent({
      outcome: { valence: "trauma", intensity: 0.8, reflection: "" },
      timestamp: new Date(Date.now() - 10000 - i * 1000).toISOString(),
    });
    addEventToStore(store, {
      ...event,
      id: `evt-trauma-${i}`,
      consolidation: {
        stage: "short-term",
        access_count: 0,
        last_accessed: new Date().toISOString(),
        consolidation_score: 0,
        should_consolidate: false,
        decay_factor: 1.0,
        last_decay_check: new Date().toISOString(),
      },
    } as WolfEvent);
  }

  // Now add 3 more, should evict oldest neutrals
  for (let i = 0; i < 3; i++) {
    const event = createTestEvent({
      outcome: { valence: "neutral", intensity: 0.3, reflection: "" },
      timestamp: new Date(Date.now() + i * 1000).toISOString(),
    });
    addEventToStore(store, {
      ...event,
      id: `evt-new-${i}`,
      consolidation: {
        stage: "short-term",
        access_count: 0,
        last_accessed: new Date().toISOString(),
        consolidation_score: 0,
        should_consolidate: false,
        decay_factor: 1.0,
        last_decay_check: new Date().toISOString(),
      },
    } as WolfEvent);
  }

  // Should have 5 events total (2 trauma + 3 newer neutral)
  assert(store.buffer.length === 5, `buffer.length is 5, got ${store.buffer.length}`);
  assert(store.stats.trauma_count === 2, "trauma_count is 2 (not evicted)");
  assert(store.buffer.some(e => e.id.startsWith("evt-new-")), "newest neutrals present");
  assert(!store.buffer.some(e => e.id === "evt-neutral-0"), "oldest neutral evicted");
}

// T3.8 — Trauma events never evicted
// Note: When ALL events are trauma, eviction stops (can't evict trauma)
// Buffer can exceed max_buffer_size in this edge case
console.log("\nT3.8 — Trauma events never evicted");
{
  const store = createEmptyStore("/tmp/test");
  store.max_buffer_size = 3;

  // Add 5 trauma events - exceeds buffer limit
  for (let i = 0; i < 5; i++) {
    const event = createTestEvent({
      outcome: { valence: "trauma", intensity: 0.8, reflection: "" },
    });
    addEventToStore(store, {
      ...event,
      id: `evt-trauma-${i}`,
      consolidation: {
        stage: "short-term",
        access_count: 0,
        last_accessed: new Date().toISOString(),
        consolidation_score: 0,
        should_consolidate: false,
        decay_factor: 1.0,
        last_decay_check: new Date().toISOString(),
      },
    } as WolfEvent);
  }

  // Buffer exceeds limit (5 > 3) because trauma events can't be evicted
  assert(store.buffer.length === 5, `buffer.length is 5 (no eviction of trauma), got ${store.buffer.length}`);
  // All should be trauma
  assert(store.buffer.every(e => e.outcome.valence === "trauma"), "all remaining are trauma");
}

// T3.9 — getEventsByLocation()
console.log("\nT3.9 — getEventsByLocation()");
{
  const store = createEmptyStore("/tmp/test");

  const event1 = createTestEvent({ context: { ...createTestEvent().context, files_involved: ["/tmp/test/src/index.ts"] } });
  const event2 = createTestEvent({ context: { ...createTestEvent().context, files_involved: ["/tmp/test/src/other.ts"] } });

  addEventToStore(store, {
    ...event1,
    id: "evt-1",
    consolidation: {
      stage: "short-term", access_count: 0, last_accessed: new Date().toISOString(),
      consolidation_score: 0, should_consolidate: false, decay_factor: 1.0, last_decay_check: new Date().toISOString(),
    },
  } as WolfEvent);
  addEventToStore(store, {
    ...event2,
    id: "evt-2",
    consolidation: {
      stage: "short-term", access_count: 0, last_accessed: new Date().toISOString(),
      consolidation_score: 0, should_consolidate: false, decay_factor: 1.0, last_decay_check: new Date().toISOString(),
    },
  } as WolfEvent);

  const events = getEventsByLocation(store, "/tmp/test/src/index.ts");
  assert(events.length === 1, "found 1 event for index.ts");
  assert(events[0].id === "evt-1", "correct event returned");
}

// T3.10 — getTraumaEvents()
console.log("\nT3.10 — getTraumaEvents()");
{
  const store = createEmptyStore("/tmp/test");

  const traumaEvent = createTestEvent({ outcome: { valence: "trauma", intensity: 0.8, reflection: "" } });
  const neutralEvent = createTestEvent({ outcome: { valence: "neutral", intensity: 0.3, reflection: "" } });

  addEventToStore(store, {
    ...traumaEvent, id: "evt-trauma",
    consolidation: { stage: "short-term", access_count: 0, last_accessed: new Date().toISOString(), consolidation_score: 0, should_consolidate: false, decay_factor: 1.0, last_decay_check: new Date().toISOString() },
  } as WolfEvent);
  addEventToStore(store, {
    ...neutralEvent, id: "evt-neutral",
    consolidation: { stage: "short-term", access_count: 0, last_accessed: new Date().toISOString(), consolidation_score: 0, should_consolidate: false, decay_factor: 1.0, last_decay_check: new Date().toISOString() },
  } as WolfEvent);

  const traumas = getTraumaEvents(store);
  assert(traumas.length === 1, "found 1 trauma event");
  assert(traumas[0].id === "evt-trauma", "correct trauma event returned");
}

// T3.11 — getTraumaEventsForPath()
console.log("\nT3.11 — getTraumaEventsForPath()");
{
  const store = createEmptyStore("/tmp/test");

  const trauma1 = createTestEvent({
    context: { ...createTestEvent().context, files_involved: ["/tmp/test/src/file1.ts"] },
    outcome: { valence: "trauma", intensity: 0.8, reflection: "" },
  });
  const trauma2 = createTestEvent({
    context: { ...createTestEvent().context, files_involved: ["/tmp/test/src/file2.ts"] },
    outcome: { valence: "trauma", intensity: 0.7, reflection: "" },
  });

  addEventToStore(store, {
    ...trauma1, id: "evt-trauma-1",
    consolidation: { stage: "short-term", access_count: 0, last_accessed: new Date().toISOString(), consolidation_score: 0, should_consolidate: false, decay_factor: 1.0, last_decay_check: new Date().toISOString() },
  } as WolfEvent);
  addEventToStore(store, {
    ...trauma2, id: "evt-trauma-2",
    consolidation: { stage: "short-term", access_count: 0, last_accessed: new Date().toISOString(), consolidation_score: 0, should_consolidate: false, decay_factor: 1.0, last_decay_check: new Date().toISOString() },
  } as WolfEvent);

  const traumas = getTraumaEventsForPath(store, "/tmp/test/src/file1.ts");
  assert(traumas.length === 1, "found 1 trauma for file1.ts");
  assert(traumas[0].id === "evt-trauma-1", "correct trauma returned");
}

// T3.12 — filterEvents() by valence
console.log("\nT3.12 — filterEvents() by valence");
{
  const store = createEmptyStore("/tmp/test");

  for (const valence of ["reward", "neutral", "penalty", "trauma"] as const) {
    const event = createTestEvent({ outcome: { valence, intensity: 0.5, reflection: "" } });
    addEventToStore(store, {
      ...event, id: `evt-${valence}`,
      consolidation: { stage: "short-term", access_count: 0, last_accessed: new Date().toISOString(), consolidation_score: 0, should_consolidate: false, decay_factor: 1.0, last_decay_check: new Date().toISOString() },
    } as WolfEvent);
  }

  const traumaOnly = filterEvents(store, { valence: ["trauma"] });
  assert(traumaOnly.length === 1, "filtered to 1 trauma");
  assert(traumaOnly[0].outcome.valence === "trauma", "is trauma");

  const multiValence = filterEvents(store, { valence: ["reward", "neutral"] });
  assert(multiValence.length === 2, "filtered to 2 events");
}

// T3.13 — filterEvents() by min_intensity
console.log("\nT3.13 — filterEvents() by min_intensity");
{
  const store = createEmptyStore("/tmp/test");

  const low = createTestEvent({ outcome: { valence: "neutral", intensity: 0.2, reflection: "" } });
  const high = createTestEvent({ outcome: { valence: "neutral", intensity: 0.8, reflection: "" } });

  addEventToStore(store, {
    ...low, id: "evt-low",
    consolidation: { stage: "short-term", access_count: 0, last_accessed: new Date().toISOString(), consolidation_score: 0, should_consolidate: false, decay_factor: 1.0, last_decay_check: new Date().toISOString() },
  } as WolfEvent);
  addEventToStore(store, {
    ...high, id: "evt-high",
    consolidation: { stage: "short-term", access_count: 0, last_accessed: new Date().toISOString(), consolidation_score: 0, should_consolidate: false, decay_factor: 1.0, last_decay_check: new Date().toISOString() },
  } as WolfEvent);

  const highOnly = filterEvents(store, { min_intensity: 0.5 });
  assert(highOnly.length === 1, "found 1 high intensity");
  assert(highOnly[0].id === "evt-high", "correct high intensity event");
}

// T3.14 — filterEvents() by max_age_days
console.log("\nT3.14 — filterEvents() by max_age_days");
{
  const store = createEmptyStore("/tmp/test");

  const oldEvent = createTestEvent({ timestamp: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString() });
  const recentEvent = createTestEvent({ timestamp: new Date().toISOString() });

  addEventToStore(store, {
    ...oldEvent, id: "evt-old",
    consolidation: { stage: "short-term", access_count: 0, last_accessed: new Date().toISOString(), consolidation_score: 0, should_consolidate: false, decay_factor: 1.0, last_decay_check: new Date().toISOString() },
  } as WolfEvent);
  addEventToStore(store, {
    ...recentEvent, id: "evt-recent",
    consolidation: { stage: "short-term", access_count: 0, last_accessed: new Date().toISOString(), consolidation_score: 0, should_consolidate: false, decay_factor: 1.0, last_decay_check: new Date().toISOString() },
  } as WolfEvent);

  const recentOnly = filterEvents(store, { max_age_days: 5 });
  assert(recentOnly.length === 1, "found 1 recent event");
  assert(recentOnly[0].id === "evt-recent", "correct recent event");
}

// Summary
console.log(`\n${"=".repeat(50)}`);
console.log(`T3 Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
