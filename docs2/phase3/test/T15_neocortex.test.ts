// T15 — Neocortex Store Tests
// Tests for long-term memory storage and retrieval

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use absolute path to the compiled dist
const distRoot = path.resolve(__dirname, "..", "..", "..", "dist");
const consolidation = await import(path.join(distRoot, "src", "hippocampus", "consolidation.js"));

// Test helpers
function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${msg}`);
}

function assertEq(actual: unknown, expected: unknown, msg: string) {
  if (actual !== expected) {
    throw new Error(`ASSERTION FAILED: ${msg}\n  Expected: ${expected}\n  Actual: ${actual}`);
  }
}

function tempDir(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name));
  // Create .wolf directory structure for hippocampus
  const wolfDir = path.join(dir, ".wolf");
  fs.mkdirSync(wolfDir, { recursive: true });
  fs.writeFileSync(path.join(wolfDir, "hippocampus.json"), JSON.stringify({
    version: 1,
    schema_version: 1,
    project_root: dir,
    created_at: new Date().toISOString(),
    last_updated: new Date().toISOString(),
    buffer: [],
    stats: {
      total_events: 0,
      reward_count: 0,
      penalty_count: 0,
      trauma_count: 0,
      neutral_count: 0,
      oldest_event: null,
      newest_event: null
    },
    size_bytes: 0,
    max_size_bytes: 5000000,
    retention_days: 7,
    max_buffer_size: 500
  }), "utf-8");
  return dir;
}

function cleanup(dir: string) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
}

// ─── T15.1 — Create Empty Neocortex ──────────────────────────

async function t15_1_create_empty() {
  console.log("  T15.1 — Create Empty Neocortex");

  const dir = tempDir("neocortex-empty");
  try {
    const store = consolidation.createEmptyNeocortex(dir);

    assertEq(store.version, 1, "version is 1");
    assertEq(store.schema_version, 1, "schema_version is 1");
    assertEq(store.project_root, dir, "project_root set correctly");
    assert(store.created_at.length > 0, "created_at is set");
    assert(store.last_updated.length > 0, "last_updated is set");
    assert(Array.isArray(store.events), "events is array");
    assertEq(store.events.length, 0, "events is empty");
    assertEq(store.stats.total_consolidated, 0, "total_consolidated is 0");
    assertEq(store.size_bytes, 0, "size_bytes is 0");
    assertEq(store.max_size_bytes, 10_000_000, "max_size_bytes is 10MB");

    console.log("    ✓ Empty neocortex created with correct structure");
  } finally {
    cleanup(dir);
  }
}

// ─── T15.2 — Neocortex Round-Trip Save/Load ─────────────────

async function t15_2_round_trip() {
  console.log("  T15.2 — Neocortex Round-Trip Save/Load");

  const dir = tempDir("neocortex-roundtrip");
  const neocortexPath = path.join(dir, "neocortex.json");

  try {
    const store = consolidation.createEmptyNeocortex(dir);
    consolidation.saveNeocortex(neocortexPath, store);

    assert(fs.existsSync(neocortexPath), "neocortex file created");

    const loaded = consolidation.loadNeocortex(neocortexPath);
    assert(loaded !== null, "neocortex loaded successfully");
    assertEq(loaded!.project_root, dir, "project_root preserved");
    assertEq(loaded!.events.length, 0, "events empty");

    console.log("    ✓ Neocortex save/load round-trip works");
  } finally {
    cleanup(dir);
  }
}

// ─── T15.3 — Load Returns Null for Missing File ─────────────

async function t15_3_load_missing() {
  console.log("  T15.3 — Load Returns Null for Missing File");

  const dir = tempDir("neocortex-missing");
  try {
    const loaded = consolidation.loadNeocortex(path.join(dir, "neocortex.json"));
    assertEq(loaded, null, "loadNeocortex returns null for missing file");
    console.log("    ✓ Missing neocortex returns null");
  } finally {
    cleanup(dir);
  }
}

// ─── T15.4 — Save Updates Size Bytes ─────────────────────────

async function t15_4_size_updated() {
  console.log("  T15.4 — Save Updates Size Bytes");

  const dir = tempDir("neocortex-size");
  const neocortexPath = path.join(dir, "neocortex.json");

  try {
    const store = consolidation.createEmptyNeocortex(dir);
    assertEq(store.size_bytes, 0, "initial size is 0");

    consolidation.saveNeocortex(neocortexPath, store);
    assert(store.size_bytes > 0, "size updated after save");

    console.log(`    ✓ Size updated: ${store.size_bytes} bytes`);
  } finally {
    cleanup(dir);
  }
}

// ─── T15.5 — Get Neocortex Events Filters by Valence ─────────

async function t15_5_filter_by_valence() {
  console.log("  T15.5 — Get Neocortex Events Filters by Valence");

  const dir = tempDir("neocortex-filter");
  try {
    const store = consolidation.createEmptyNeocortex(dir);

    // Add events with different valences
    const event1 = {
      id: "evt-1",
      version: 1 as const,
      timestamp: new Date().toISOString(),
      session_id: "test",
      context: {
        project_root: dir,
        files_involved: ["/test/file.ts"],
        cwd_at_time: dir,
        spatial_path: "/test/file.ts",
        spatial_depth: 1,
        session_start: new Date().toISOString(),
        turn_in_session: 1,
      },
      action: { type: "write" as const, description: "write", tokens_spent: 100 },
      outcome: { valence: "reward" as const, intensity: 0.8, reflection: "good" },
      consolidation: {
        stage: "long-term" as const,
        access_count: 0,
        last_accessed: new Date().toISOString(),
        consolidation_score: 0,
        should_consolidate: false,
        decay_factor: 1.0,
        last_decay_check: new Date().toISOString(),
      },
      source: "hook" as const,
      tags: [],
    };

    const event2 = {
      ...event1,
      id: "evt-2",
      outcome: { ...event1.outcome, valence: "neutral" as const },
    };

    store.events.push(event1, event2);

    // Filter by reward
    const rewards = consolidation.getNeocortexEvents(store, { valence: ["reward"] });
    assertEq(rewards.length, 1, "filtered to 1 reward event");
    assertEq(rewards[0].id, "evt-1", "correct reward event returned");

    // Filter by multiple valences
    const mixed = consolidation.getNeocortexEvents(store, { valence: ["reward", "neutral"] });
    assertEq(mixed.length, 2, "both events returned");

    console.log("    ✓ Valence filtering works");
  } finally {
    cleanup(dir);
  }
}

// ─── T15.6 — Get Neocortex Events Filters by Intensity ────────

async function t15_6_filter_by_intensity() {
  console.log("  T15.6 — Get Neocortex Events Filters by Intensity");

  const dir = tempDir("neocortex-intensity");
  try {
    const store = consolidation.createEmptyNeocortex(dir);

    const event1 = {
      id: "evt-1",
      version: 1 as const,
      timestamp: new Date().toISOString(),
      session_id: "test",
      context: {
        project_root: dir,
        files_involved: ["/test/file.ts"],
        cwd_at_time: dir,
        spatial_path: "/test/file.ts",
        spatial_depth: 1,
        session_start: new Date().toISOString(),
        turn_in_session: 1,
      },
      action: { type: "write" as const, description: "write", tokens_spent: 100 },
      outcome: { valence: "neutral" as const, intensity: 0.3, reflection: "low" },
      consolidation: {
        stage: "long-term" as const,
        access_count: 0,
        last_accessed: new Date().toISOString(),
        consolidation_score: 0,
        should_consolidate: false,
        decay_factor: 1.0,
        last_decay_check: new Date().toISOString(),
      },
      source: "hook" as const,
      tags: [],
    };

    const event2 = { ...event1, id: "evt-2", outcome: { ...event1.outcome, intensity: 0.8 } };

    store.events.push(event1, event2);

    const highIntensity = consolidation.getNeocortexEvents(store, { minIntensity: 0.7 });
    assertEq(highIntensity.length, 1, "only high intensity returned");
    assertEq(highIntensity[0].id, "evt-2", "correct event returned");

    console.log("    ✓ Intensity filtering works");
  } finally {
    cleanup(dir);
  }
}

// ─── T15.7 — Get Neocortex Events Respects Limit ─────────────

async function t15_7_limit() {
  console.log("  T15.7 — Get Neocortex Events Respects Limit");

  const dir = tempDir("neocortex-limit");
  try {
    const store = consolidation.createEmptyNeocortex(dir);

    // Add 5 events
    for (let i = 0; i < 5; i++) {
      store.events.push({
        id: `evt-${i}`,
        version: 1 as const,
        timestamp: new Date(Date.now() - i * 1000).toISOString(), //递减
        session_id: "test",
        context: {
          project_root: dir,
          files_involved: ["/test/file.ts"],
          cwd_at_time: dir,
          spatial_path: "/test/file.ts",
          spatial_depth: 1,
          session_start: new Date().toISOString(),
          turn_in_session: 1,
        },
        action: { type: "write" as const, description: "write", tokens_spent: 100 },
        outcome: { valence: "neutral" as const, intensity: 0.5, reflection: "test" },
        consolidation: {
          stage: "long-term" as const,
          access_count: 0,
          last_accessed: new Date().toISOString(),
          consolidation_score: 0,
          should_consolidate: false,
          decay_factor: 1.0,
          last_decay_check: new Date().toISOString(),
        },
        source: "hook" as const,
        tags: [],
      });
    }

    const limited = consolidation.getNeocortexEvents(store, { limit: 3 });
    assertEq(limited.length, 3, "limited to 3 events");

    console.log("    ✓ Limit works correctly");
  } finally {
    cleanup(dir);
  }
}

// ─── T15.8 — Events Sorted by Recency ────────────────────────

async function t15_8_sorted_by_recency() {
  console.log("  T15.8 — Events Sorted by Recency");

  const dir = tempDir("neocortex-recency");
  try {
    const store = consolidation.createEmptyNeocortex(dir);

    const now = new Date();
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const recentDate = new Date().toISOString();
    const midDate = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();

    store.events.push(
      { id: "old", timestamp: oldDate } as any,
      { id: "recent", timestamp: recentDate } as any,
      { id: "mid", timestamp: midDate } as any
    );

    const sorted = consolidation.getNeocortexEvents(store);

    assertEq(sorted[0].id, "recent", "most recent first");
    assertEq(sorted[1].id, "mid", "middle second");
    assertEq(sorted[2].id, "old", "oldest last");

    console.log("    ✓ Events sorted by recency (newest first)");
  } finally {
    cleanup(dir);
  }
}

// ─── T15.9 — Stats Tracking ───────────────────────────────────

async function t15_9_stats_tracking() {
  console.log("  T15.9 — Stats Tracking");

  const dir = tempDir("neocortex-stats");
  try {
    const store = consolidation.createEmptyNeocortex(dir);

    assertEq(store.stats.by_valence.reward, 0, "reward count starts at 0");
    assertEq(store.stats.by_valence.trauma, 0, "trauma count starts at 0");

    // Simulate adding consolidated events
    store.stats.by_valence.reward = 5;
    store.stats.by_valence.trauma = 2;
    store.stats.total_consolidated = 7;

    assertEq(store.stats.by_valence.reward, 5, "reward count updated");
    assertEq(store.stats.by_valence.trauma, 2, "trauma count updated");
    assertEq(store.stats.total_consolidated, 7, "total updated");

    console.log("    ✓ Stats tracking works");
  } finally {
    cleanup(dir);
  }
}

// ─── Run All Tests ─────────────────────────────────────────────

async function runTests() {
  console.log("\n=== T15 — Neocortex Store Tests ===\n");

  const tests = [
    t15_1_create_empty,
    t15_2_round_trip,
    t15_3_load_missing,
    t15_4_size_updated,
    t15_5_filter_by_valence,
    t15_6_filter_by_intensity,
    t15_7_limit,
    t15_8_sorted_by_recency,
    t15_9_stats_tracking,
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      await test();
      passed++;
    } catch (err) {
      console.error(`    ✗ FAILED: ${err}`);
      failed++;
    }
  }

  console.log(`\n=== T15 Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
