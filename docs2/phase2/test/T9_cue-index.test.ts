#!/usr/bin/env node
/**
 * T9 — Cue Index Tests
 * Run: node docs2/phase2/test/T9_cue-index.test.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  buildIndex,
  loadIndex,
  saveIndex,
  addEventToIndex,
  removeEventFromIndex,
  createEmptyIndex,
  sortTraumaByIntensity,
  indexNeedsRebuild,
  getCueIndexPath,
} from "../../../src/hippocampus/cue-index.js";
import type { WolfEvent, CueIndex } from "../../../src/hippocampus/types.js";

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

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual === expected) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
    failed++;
  }
}

function createTestProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cue-index-test-"));
}

function createTestEvent(overrides: Partial<WolfEvent> = {}): WolfEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2)}`,
    version: 1,
    timestamp: new Date().toISOString(),
    session_id: "test-session",
    context: {
      project_root: "/test",
      files_involved: ["/test/file.ts"],
      cwd_at_time: "/test",
      spatial_path: "./",
      spatial_depth: 0,
      session_start: new Date().toISOString(),
      turn_in_session: 1,
    },
    action: {
      type: "write",
      description: "Test event",
      tokens_spent: 100,
    },
    outcome: {
      valence: "neutral",
      intensity: 0.3,
      reflection: "Test",
    },
    consolidation: {
      stage: "short-term",
      access_count: 0,
      last_accessed: new Date().toISOString(),
      consolidation_score: 0,
      should_consolidate: false,
      decay_factor: 1.0,
      last_decay_check: new Date().toISOString(),
    },
    source: "hook",
    tags: ["test"],
    ...overrides,
  } as WolfEvent;
}

// ============================================================
// T9.1 — buildIndex() creates correct structure
// ============================================================
console.log("\nT9.1 — buildIndex() creates correct structure");
{
  const events: WolfEvent[] = [];
  const index = buildIndex(events);

  assert(typeof index === "object", "returns an object");
  assert(index.version === 1, "version is 1");
  assert(typeof index.last_updated === "string", "last_updated is a string");
  assert(typeof index.location_index === "object", "location_index is an object");
  assert(typeof index.tag_index === "object", "tag_index is an object");
  assert(typeof index.trauma_index === "object", "trauma_index is an object");
  assert(Array.isArray(index.trauma_index.all_trauma_ids), "all_trauma_ids is an array");
  assert(typeof index.trauma_index.by_path === "object", "by_path is an object");
}

// ============================================================
// T9.2 — buildIndex() maps paths to event IDs
// ============================================================
console.log("\nT9.2 — buildIndex() maps paths to event IDs");
{
  const event1 = createTestEvent({ id: "evt-001", context: { ...createTestEvent().context, files_involved: ["/src/auth/middleware.ts"] } });
  const event2 = createTestEvent({ id: "evt-002", context: { ...createTestEvent().context, files_involved: ["/src/auth/login.ts"] } });
  const events = [event1, event2];

  const index = buildIndex(events);

  assert(index.location_index["/src/auth/middleware.ts"]?.includes("evt-001"), "maps middleware.ts to evt-001");
  assert(index.location_index["/src/auth/login.ts"]?.includes("evt-002"), "maps login.ts to evt-002");
  assert(!index.location_index["/src/auth/middleware.ts"]?.includes("evt-002"), "evt-002 not in middleware path");
}

// ============================================================
// T9.3 — buildIndex() sorts by recency (most recent first)
// ============================================================
console.log("\nT9.3 — buildIndex() sorts by recency");
{
  const older = createTestEvent({
    id: "evt-old",
    timestamp: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
    context: { ...createTestEvent().context, files_involved: ["/src/old.ts"] },
  });
  const newer = createTestEvent({
    id: "evt-new",
    timestamp: new Date().toISOString(), // now
    context: { ...createTestEvent().context, files_involved: ["/src/new.ts"] },
  });
  // Add older first to ensure sorting is by timestamp, not insertion order
  const events = [older, newer];
  const index = buildIndex(events);

  const oldIds = index.location_index["/src/old.ts"];
  const newIds = index.location_index["/src/new.ts"];

  // Newer should be first in the array
  assert(oldIds?.[0] === "evt-old", "older event is first for its path");
  assert(newIds?.[0] === "evt-new", "newer event is first for its path");
}

// ============================================================
// T9.4 — trauma IDs can be sorted by intensity
// ============================================================
console.log("\nT9.4 — sortTraumaByIntensity sorts by intensity desc");
{
  const lowTrauma = createTestEvent({
    id: "evt-low",
    outcome: { valence: "trauma", intensity: 0.3, reflection: "Low" },
    context: { ...createTestEvent().context, files_involved: ["/src/low.ts"] },
  });
  const highTrauma = createTestEvent({
    id: "evt-high",
    outcome: { valence: "trauma", intensity: 0.9, reflection: "High" },
    context: { ...createTestEvent().context, files_involved: ["/src/high.ts"] },
  });
  const mediumTrauma = createTestEvent({
    id: "evt-medium",
    outcome: { valence: "trauma", intensity: 0.6, reflection: "Medium" },
    context: { ...createTestEvent().context, files_involved: ["/src/medium.ts"] },
  });

  const events = [lowTrauma, highTrauma, mediumTrauma];
  const index = buildIndex(events);
  const eventMap = new Map(events.map(e => [e.id, e]));

  const sorted = sortTraumaByIntensity(index.trauma_index.all_trauma_ids, eventMap);

  assert(sorted[0] === "evt-high", "highest intensity first");
  assert(sorted[1] === "evt-medium", "medium intensity second");
  assert(sorted[2] === "evt-low", "lowest intensity last");
}

// ============================================================
// T9.5 — trauma_index.by_path maps file to trauma IDs
// ============================================================
console.log("\nT9.5 — trauma_index.by_path maps file to trauma IDs");
{
  const trauma = createTestEvent({
    id: "evt-trauma",
    outcome: { valence: "trauma", intensity: 0.8, reflection: "Trauma" },
    context: { ...createTestEvent().context, files_involved: ["/src/trauma.ts"] },
  });
  const neutral = createTestEvent({
    id: "evt-neutral",
    outcome: { valence: "neutral", intensity: 0.3, reflection: "Neutral" },
    context: { ...createTestEvent().context, files_involved: ["/src/trauma.ts"] },
  });

  const index = buildIndex([trauma, neutral]);

  assert(index.trauma_index.by_path["/src/trauma.ts"]?.includes("evt-trauma"), "trauma file maps to trauma event");
  assert(!index.trauma_index.by_path["/src/trauma.ts"]?.includes("evt-neutral"), "neutral event not in trauma index");
}

// ============================================================
// T9.6 — loadIndex() returns null for missing file
// ============================================================
console.log("\nT9.6 — loadIndex() returns null for missing file");
{
  const projectRoot = createTestProject();
  const indexPath = path.join(projectRoot, ".wolf", "cue-index.json");

  const result = loadIndex(indexPath);
  assert(result === null, "returns null for non-existent path");

  fs.rmSync(projectRoot, { recursive: true });
}

// ============================================================
// T9.7 — saveIndex() round-trip preserves data
// ============================================================
console.log("\nT9.7 — saveIndex() round-trip");
{
  const projectRoot = createTestProject();
  const indexPath = path.join(projectRoot, ".wolf", "cue-index.json");

  const original = buildIndex([
    createTestEvent({
      id: "evt-roundtrip",
      context: { ...createTestEvent().context, files_involved: ["/src/roundtrip.ts"] },
    }),
  ]);

  saveIndex(indexPath, original);
  const loaded = loadIndex(indexPath);

  assert(loaded !== null, "loaded is not null");
  assert(loaded!.version === 1, "version preserved");
  assert(loaded!.location_index["/src/roundtrip.ts"]?.includes("evt-roundtrip"), "event ID preserved");

  fs.rmSync(projectRoot, { recursive: true });
}

// ============================================================
// T9.8 — addEventToIndex() updates index in-memory
// ============================================================
console.log("\nT9.8 — addEventToIndex() updates index in-memory");
{
  const index = createEmptyIndex();
  const event = createTestEvent({
    id: "evt-add",
    context: { ...createTestEvent().context, files_involved: ["/src/added.ts"] },
    tags: ["added-tag"],
  });

  assert(!index.location_index["/src/added.ts"], "path not in index before add");
  assert(!index.tag_index["added-tag"], "tag not in index before add");

  addEventToIndex(index, event);

  assert(index.location_index["/src/added.ts"]?.includes("evt-add"), "path added to index");
  assert(index.tag_index["added-tag"]?.includes("evt-add"), "tag added to index");
}

// ============================================================
// T9.9 — removeEventFromIndex() removes event
// ============================================================
console.log("\nT9.9 — removeEventFromIndex() removes event");
{
  const event = createTestEvent({
    id: "evt-remove",
    context: { ...createTestEvent().context, files_involved: ["/src/remove.ts"] },
    tags: ["remove-tag"],
    outcome: { valence: "trauma", intensity: 0.5, reflection: "Remove" },
  });
  const index = buildIndex([event]);

  assert(index.location_index["/src/remove.ts"]?.includes("evt-remove"), "event exists before remove");
  assert(index.trauma_index.all_trauma_ids.includes("evt-remove"), "event in trauma index");

  removeEventFromIndex(index, "evt-remove");

  assert(!index.location_index["/src/remove.ts"]?.includes("evt-remove"), "event removed from location index");
  assert(!index.trauma_index.all_trauma_ids.includes("evt-remove"), "event removed from trauma index");
  assert(!index.tag_index["remove-tag"]?.includes("evt-remove"), "event removed from tag index");
}

// ============================================================
// T9.10 — indexNeedsRebuild() detects stale index
// ============================================================
console.log("\nT9.10 — indexNeedsRebuild() detects stale/empty index");
{
  const emptyIndex = createEmptyIndex();
  assert(indexNeedsRebuild(emptyIndex, 0) === false, "empty index with 0 events is fine");
  assert(indexNeedsRebuild(emptyIndex, 5) === true, "empty index with events needs rebuild");

  const populatedIndex = buildIndex([createTestEvent({ id: "evt-existing" })]);
  assert(indexNeedsRebuild(populatedIndex, 1) === false, "populated index with matching events is fine");
  assert(indexNeedsRebuild(populatedIndex, 0) === false, "populated index with 0 events is fine");

  const nullIndex: CueIndex | null = null;
  assert(indexNeedsRebuild(nullIndex, 0) === true, "null index needs rebuild");
}

// ============================================================
// T9.11 — getCueIndexPath() returns correct path
// ============================================================
console.log("\nT9.11 — getCueIndexPath() returns correct path");
{
  const projectRoot = "/my/project";
  const expected = path.join(projectRoot, ".wolf", "cue-index.json");
  const result = getCueIndexPath(projectRoot);
  assert(result === expected, `returns ${expected}`);
}

// ============================================================
// Summary
// ============================================================
console.log(`\n${"=".repeat(50)}`);
console.log(`T9 Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
