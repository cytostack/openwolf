#!/usr/bin/env node
/**
 * T4 — Hippocampus Class Unit Tests
 * Run: node T4_hippocampus.test.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Hippocampus } from "../../../src/hippocampus/index.js";

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

function createTestProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hippocampus-test-"));
}

// T4.1 — Constructor sets projectRoot + hippocampusPath
console.log("\nT4.1 — Constructor path setup");
{
  const projectRoot = "/my/test/project";
  const h = new Hippocampus(projectRoot);
  // We can't access private fields directly, but we can check behavior
  assert(h !== undefined, "constructor completes without error");
}

// T4.2 — addEvent() auto-generates id with evt- prefix
console.log("\nT4.2 — addEvent() ID generation");
{
  const projectRoot = createTestProject();
  fs.mkdirSync(path.join(projectRoot, ".wolf"), { recursive: true });
  const h = new Hippocampus(projectRoot);

  const event = h.addEvent({
    version: 1,
    timestamp: new Date().toISOString(),
    session_id: "test-session",
    context: {
      project_root: projectRoot,
      files_involved: ["/my/test/file.ts"],
      cwd_at_time: projectRoot,
      spatial_path: "./",
      spatial_depth: 0,
      session_start: new Date().toISOString(),
      turn_in_session: 1,
    },
    action: {
      type: "write",
      description: "Test",
      tokens_spent: 100,
    },
    outcome: {
      valence: "neutral",
      intensity: 0.3,
      reflection: "Test",
    },
    source: "hook",
    tags: ["test"],
  });

  assert(event.id.startsWith("evt-"), `ID starts with "evt-": ${event.id}`);
  assert(event.id.length > 4, "ID has meaningful length");

  fs.rmSync(projectRoot, { recursive: true });
}

// T4.3 — addEvent() sets consolidation defaults
console.log("\nT4.3 — addEvent() consolidation defaults");
{
  const projectRoot = createTestProject();
  fs.mkdirSync(path.join(projectRoot, ".wolf"), { recursive: true });
  const h = new Hippocampus(projectRoot);

  const event = h.addEvent({
    version: 1,
    timestamp: new Date().toISOString(),
    session_id: "test-session",
    context: {
      project_root: projectRoot,
      files_involved: ["/my/test/file.ts"],
      cwd_at_time: projectRoot,
      spatial_path: "./",
      spatial_depth: 0,
      session_start: new Date().toISOString(),
      turn_in_session: 1,
    },
    action: {
      type: "write",
      description: "Test",
      tokens_spent: 100,
    },
    outcome: {
      valence: "neutral",
      intensity: 0.3,
      reflection: "Test",
    },
    source: "hook",
    tags: ["test"],
  });

  assert(event.consolidation.stage === "short-term", `stage is "short-term": ${event.consolidation.stage}`);
  assert(event.consolidation.decay_factor === 1.0, `decay_factor is 1.0: ${event.consolidation.decay_factor}`);
  assert(event.consolidation.access_count === 0, `access_count is 0: ${event.consolidation.access_count}`);
  assert(event.consolidation.should_consolidate === false, `should_consolidate is false`);

  fs.rmSync(projectRoot, { recursive: true });
}

// T4.4 — addEvent() persists to disk
console.log("\nT4.4 — addEvent() persistence");
{
  const projectRoot = createTestProject();
  fs.mkdirSync(path.join(projectRoot, ".wolf"), { recursive: true });
  const h1 = new Hippocampus(projectRoot);

  h1.addEvent({
    version: 1,
    timestamp: new Date().toISOString(),
    session_id: "test-session",
    context: {
      project_root: projectRoot,
      files_involved: ["/my/test/file.ts"],
      cwd_at_time: projectRoot,
      spatial_path: "./",
      spatial_depth: 0,
      session_start: new Date().toISOString(),
      turn_in_session: 1,
    },
    action: {
      type: "write",
      description: "Test",
      tokens_spent: 100,
    },
    outcome: {
      valence: "neutral",
      intensity: 0.3,
      reflection: "Test",
    },
    source: "hook",
    tags: ["test"],
  });

  // Re-instantiate and check event persists
  const h2 = new Hippocampus(projectRoot);
  const events = h2.getEvents();
  assert(events.length === 1, "event persists after re-instantiation");
  assert(events[0].action.description === "Test", "event data preserved");

  fs.rmSync(projectRoot, { recursive: true });
}

// T4.5 — addEvent() updates stats
console.log("\nT4.5 — addEvent() stats update");
{
  const projectRoot = createTestProject();
  fs.mkdirSync(path.join(projectRoot, ".wolf"), { recursive: true });
  const h = new Hippocampus(projectRoot);

  const stats1 = h.getStats();
  const initialTotal = stats1.total_events;

  h.addEvent({
    version: 1,
    timestamp: new Date().toISOString(),
    session_id: "test-session",
    context: {
      project_root: projectRoot,
      files_involved: ["/my/test/file.ts"],
      cwd_at_time: projectRoot,
      spatial_path: "./",
      spatial_depth: 0,
      session_start: new Date().toISOString(),
      turn_in_session: 1,
    },
    action: {
      type: "write",
      description: "Test",
      tokens_spent: 100,
    },
    outcome: {
      valence: "neutral",
      intensity: 0.3,
      reflection: "Test",
    },
    source: "hook",
    tags: ["test"],
  });

  const stats2 = h.getStats();
  assert(stats2.total_events === initialTotal + 1, `total_events incremented: ${stats2.total_events}`);

  fs.rmSync(projectRoot, { recursive: true });
}

// T4.6 — getTraumas() without arg returns all trauma
console.log("\nT4.6 — getTraumas() all");
{
  const projectRoot = createTestProject();
  fs.mkdirSync(path.join(projectRoot, ".wolf"), { recursive: true });
  const h = new Hippocampus(projectRoot);

  h.addEvent({
    version: 1,
    timestamp: new Date().toISOString(),
    session_id: "test-session",
    context: {
      project_root: projectRoot,
      files_involved: ["/my/test/file1.ts"],
      cwd_at_time: projectRoot,
      spatial_path: "./",
      spatial_depth: 0,
      session_start: new Date().toISOString(),
      turn_in_session: 1,
    },
    action: { type: "write", description: "Test", tokens_spent: 100 },
    outcome: { valence: "trauma", intensity: 0.8, reflection: "Test trauma" },
    source: "hook",
    tags: ["test"],
  });

  h.addEvent({
    version: 1,
    timestamp: new Date().toISOString(),
    session_id: "test-session",
    context: {
      project_root: projectRoot,
      files_involved: ["/my/test/file2.ts"],
      cwd_at_time: projectRoot,
      spatial_path: "./",
      spatial_depth: 0,
      session_start: new Date().toISOString(),
      turn_in_session: 2,
    },
    action: { type: "write", description: "Test", tokens_spent: 100 },
    outcome: { valence: "neutral", intensity: 0.3, reflection: "Test neutral" },
    source: "hook",
    tags: ["test"],
  });

  const traumas = h.getTraumas();
  assert(traumas.length === 1, "found 1 trauma event");
  assert(traumas[0].outcome.valence === "trauma", "is trauma event");

  fs.rmSync(projectRoot, { recursive: true });
}

// T4.7 — getTraumas(filePath) filters by path
console.log("\nT4.7 — getTraumas(filePath) filtered");
{
  const projectRoot = createTestProject();
  fs.mkdirSync(path.join(projectRoot, ".wolf"), { recursive: true });
  const h = new Hippocampus(projectRoot);

  h.addEvent({
    version: 1,
    timestamp: new Date().toISOString(),
    session_id: "test-session",
    context: {
      project_root: projectRoot,
      files_involved: ["/my/test/file1.ts"],
      cwd_at_time: projectRoot,
      spatial_path: "./",
      spatial_depth: 0,
      session_start: new Date().toISOString(),
      turn_in_session: 1,
    },
    action: { type: "write", description: "Test", tokens_spent: 100 },
    outcome: { valence: "trauma", intensity: 0.8, reflection: "Trauma 1" },
    source: "hook",
    tags: ["test"],
  });

  h.addEvent({
    version: 1,
    timestamp: new Date().toISOString(),
    session_id: "test-session",
    context: {
      project_root: projectRoot,
      files_involved: ["/my/test/file2.ts"],
      cwd_at_time: projectRoot,
      spatial_path: "./",
      spatial_depth: 0,
      session_start: new Date().toISOString(),
      turn_in_session: 2,
    },
    action: { type: "write", description: "Test", tokens_spent: 100 },
    outcome: { valence: "trauma", intensity: 0.7, reflection: "Trauma 2" },
    source: "hook",
    tags: ["test"],
  });

  const traumas1 = h.getTraumas("/my/test/file1.ts");
  assert(traumas1.length === 1, "found 1 trauma for file1.ts");
  assert(traumas1[0].context.files_involved.includes("/my/test/file1.ts"), "correct file path");

  fs.rmSync(projectRoot, { recursive: true });
}

// T4.8 — getRecentEvents(limit) sorted by timestamp desc
console.log("\nT4.8 — getRecentEvents(limit) sorting");
{
  const projectRoot = createTestProject();
  fs.mkdirSync(path.join(projectRoot, ".wolf"), { recursive: true });
  const h = new Hippocampus(projectRoot);

  // Add events with different timestamps
  for (let i = 0; i < 5; i++) {
    h.addEvent({
      version: 1,
      timestamp: new Date(Date.now() + i * 1000).toISOString(), // newer each time
      session_id: "test-session",
      context: {
        project_root: projectRoot,
        files_involved: [`/my/test/file${i}.ts`],
        cwd_at_time: projectRoot,
        spatial_path: "./",
        spatial_depth: 0,
        session_start: new Date().toISOString(),
        turn_in_session: i,
      },
      action: { type: "write", description: `Test ${i}`, tokens_spent: 100 },
      outcome: { valence: "neutral", intensity: 0.3, reflection: "Test" },
      source: "hook",
      tags: ["test"],
    });
  }

  const recent = h.getRecentEvents(3);
  assert(recent.length === 3, "returns requested limit");
  // Most recent first
  assert(recent[0].action.description === "Test 4", "most recent first");
  assert(recent[2].action.description === "Test 2", "third most recent last");

  fs.rmSync(projectRoot, { recursive: true });
}

// T4.9 — getEvents(filters) delegates correctly
console.log("\nT4.9 — getEvents(filters)");
{
  const projectRoot = createTestProject();
  fs.mkdirSync(path.join(projectRoot, ".wolf"), { recursive: true });
  const h = new Hippocampus(projectRoot);

  h.addEvent({
    version: 1,
    timestamp: new Date().toISOString(),
    session_id: "test-session",
    context: {
      project_root: projectRoot,
      files_involved: ["/my/test/file1.ts"],
      cwd_at_time: projectRoot,
      spatial_path: "./",
      spatial_depth: 0,
      session_start: new Date().toISOString(),
      turn_in_session: 1,
    },
    action: { type: "write", description: "Test", tokens_spent: 100 },
    outcome: { valence: "trauma", intensity: 0.8, reflection: "Test" },
    source: "hook",
    tags: ["test"],
  });

  h.addEvent({
    version: 1,
    timestamp: new Date().toISOString(),
    session_id: "test-session",
    context: {
      project_root: projectRoot,
      files_involved: ["/my/test/file2.ts"],
      cwd_at_time: projectRoot,
      spatial_path: "./",
      spatial_depth: 0,
      session_start: new Date().toISOString(),
      turn_in_session: 2,
    },
    action: { type: "write", description: "Test", tokens_spent: 100 },
    outcome: { valence: "neutral", intensity: 0.3, reflection: "Test" },
    source: "hook",
    tags: ["test"],
  });

  const traumaEvents = h.getEvents({ valence: ["trauma"] });
  assert(traumaEvents.length === 1, "filtered to 1 trauma");
  assert(traumaEvents[0].outcome.valence === "trauma", "is trauma");

  const neutralEvents = h.getEvents({ valence: ["neutral"] });
  assert(neutralEvents.length === 1, "filtered to 1 neutral");
  assert(neutralEvents[0].outcome.valence === "neutral", "is neutral");

  fs.rmSync(projectRoot, { recursive: true });
}

// T4.10 — getStats() returns HippoStats shape
console.log("\nT4.10 — getStats() shape");
{
  const projectRoot = createTestProject();
  fs.mkdirSync(path.join(projectRoot, ".wolf"), { recursive: true });
  const h = new Hippocampus(projectRoot);

  const stats = h.getStats();
  assert(typeof stats.total_events === "number", "total_events is number");
  assert(typeof stats.buffer_size === "number", "buffer_size is number");
  assert(typeof stats.trauma_count === "number", "trauma_count is number");
  assert(typeof stats.reward_count === "number", "reward_count is number");
  assert(typeof stats.penalty_count === "number", "penalty_count is number");
  assert(typeof stats.neutral_count === "number", "neutral_count is number");

  fs.rmSync(projectRoot, { recursive: true });
}

// T4.11 — exists() true when file exists
console.log("\nT4.11 — exists() true after init");
{
  const projectRoot = createTestProject();
  fs.mkdirSync(path.join(projectRoot, ".wolf"), { recursive: true });
  const h = new Hippocampus(projectRoot);

  // Before any event, store doesn't exist yet (lazy creation)
  // But we can check after adding an event
  h.addEvent({
    version: 1,
    timestamp: new Date().toISOString(),
    session_id: "test-session",
    context: {
      project_root: projectRoot,
      files_involved: ["/my/test/file.ts"],
      cwd_at_time: projectRoot,
      spatial_path: "./",
      spatial_depth: 0,
      session_start: new Date().toISOString(),
      turn_in_session: 1,
    },
    action: { type: "write", description: "Test", tokens_spent: 100 },
    outcome: { valence: "neutral", intensity: 0.3, reflection: "Test" },
    source: "hook",
    tags: ["test"],
  });

  assert(h.exists() === true, "exists() returns true after event added");

  fs.rmSync(projectRoot, { recursive: true });
}

// T4.12 — exists() false when file missing
console.log("\nT4.12 — exists() false when missing");
{
  const projectRoot = createTestProject();
  const h = new Hippocampus(projectRoot);

  // Don't create .wolf directory - file shouldn't exist
  assert(h.exists() === false, "exists() returns false when file missing");

  fs.rmSync(projectRoot, { recursive: true });
}

// Summary
console.log(`\n${"=".repeat(50)}`);
console.log(`T4 Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
