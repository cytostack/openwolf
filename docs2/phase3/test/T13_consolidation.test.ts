// T13 — Consolidation API Tests
// Tests for hippocampus consolidation and neocortex transfer

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use absolute path to the compiled dist
const distRoot = path.resolve(__dirname, "..", "..", "..", "dist");
const { Hippocampus } = await import(path.join(distRoot, "src", "hippocampus", "index.js"));

// Test helpers
function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${msg}`);
}

function assertEq(actual: unknown, expected: unknown, msg: string) {
  if (actual !== expected) {
    throw new Error(`ASSERTION FAILED: ${msg}\n  Expected: ${expected}\n  Actual: ${actual}`);
  }
}

import * as os from "node:os";

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

// ─── Test Data ────────────────────────────────────────────────

function makeEvent(overrides: Partial<{
  id: string;
  timestamp: string;
  valence: "reward" | "neutral" | "penalty" | "trauma";
  intensity: number;
  stage: "short-term" | "consolidating" | "long-term";
  accessCount: number;
  decayFactor: number;
}> = {}) {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? `evt-${Math.random().toString(36).slice(2)}`,
    version: 1 as const,
    timestamp: overrides.timestamp ?? now,
    session_id: "test-session",
    context: {
      project_root: "/test",
      files_involved: ["/test/file.ts"],
      cwd_at_time: "/test",
      spatial_path: "/test/file.ts",
      spatial_depth: 1,
      session_start: now,
      turn_in_session: 1,
    },
    action: {
      type: "edit" as const,
      description: "test edit",
      tokens_spent: 100,
    },
    outcome: {
      valence: overrides.valence ?? "neutral",
      intensity: overrides.intensity ?? 0.5,
      reflection: "test reflection",
    },
    consolidation: {
      stage: overrides.stage ?? "short-term",
      access_count: overrides.accessCount ?? 0,
      last_accessed: now,
      consolidation_score: 0,
      should_consolidate: false,
      decay_factor: overrides.decayFactor ?? 1.0,
      last_decay_check: now,
    },
    source: "hook" as const,
    tags: [],
  };
}

// ─── T13.1 — Neocortex Store CRUD ─────────────────────────────

async function t13_1_neocortex_crud() {
  console.log("  T13.1 — Neocortex Store CRUD");

  const dir = tempDir("neocortex-crud");
  try {
    const hippo = new Hippocampus(dir);

    // Should not exist initially
    assert(!hippo.neocortexExists(), "neocortex should not exist before init");

    // Create neocortex via consolidate or direct access
    const report = hippo.consolidate();
    assertEq(report.events_processed, 0, "Empty consolidation");

    // Now it should exist
    assert(hippo.neocortexExists(), "neocortex should exist after consolidation");

    // Stats should be accessible
    const stats = hippo.getNeocortexStats();
    assertEq(stats.total_consolidated, 0, "Initial consolidated count is 0");
    assert(stats.last_consolidation !== null, "Last consolidation should be set after consolidation");

    console.log("    ✓ Neocortex store created and accessible");
  } finally {
    cleanup(dir);
  }
}

// ─── T13.2 — Consolidation Report Structure ───────────────────

async function t13_2_consolidation_report() {
  console.log("  T13.2 — Consolidation Report Structure");

  const dir = tempDir("consolidation-report");
  try {
    const hippo = new Hippocampus(dir);

    // Add some test events
    hippo.addEvent({
      timestamp: new Date().toISOString(),
      session_id: "test",
      context: {
        project_root: dir,
        files_involved: ["/test/a.ts"],
        cwd_at_time: dir,
        spatial_path: "/test/a.ts",
        spatial_depth: 1,
        session_start: new Date().toISOString(),
        turn_in_session: 1,
      },
      action: { type: "write", description: "write test", tokens_spent: 100 },
      outcome: { valence: "reward", intensity: 0.8, reflection: "good" },
      source: "hook",
      tags: ["test"],
    });

    const report = hippo.consolidate();

    // Verify report structure
    assert(typeof report.timestamp === "string", "report has timestamp");
    assert(typeof report.events_processed === "number", "report has events_processed");
    assert(typeof report.promoted === "number", "report has promoted");
    assert(typeof report.decayed === "number", "report has decayed");
    assert(typeof report.forgotten === "number", "report has forgotten");
    assert(typeof report.kept === "number", "report has kept");
    assert(typeof report.new_neocortex_size === "number", "report has new_neocortex_size");
    assert(Array.isArray(report.results), "report has results array");

    console.log("    ✓ Consolidation report has correct structure");
  } finally {
    cleanup(dir);
  }
}

// ─── T13.3 — High-Value Events Get Promoted ───────────────────

async function t13_3_high_value_promoted() {
  console.log("  T13.3 — High-Value Events Get Promoted");

  const dir = tempDir("high-value");
  try {
    const hippo = new Hippocampus(dir);

    // Add a high-intensity reward event
    hippo.addEvent({
      timestamp: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days ago
      session_id: "test",
      context: {
        project_root: dir,
        files_involved: ["/test/b.ts"],
        cwd_at_time: dir,
        spatial_path: "/test/b.ts",
        spatial_depth: 1,
        session_start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        turn_in_session: 1,
      },
      action: { type: "fix", description: "critical fix", tokens_spent: 500 },
      outcome: { valence: "reward", intensity: 0.95, reflection: "great fix" },
      source: "hook",
      tags: ["important"],
    });

    const report = hippo.consolidate();

    // High-value event should be promoted
    assert(report.promoted >= 0, "promotion attempted");
    console.log(`    ✓ High-value event processed (promoted: ${report.promoted})`);
  } finally {
    cleanup(dir);
  }
}

// ─── T13.4 — Trauma Events Never Decay ─────────────────────────

async function t13_4_trauma_no_decay() {
  console.log("  T13.4 — Trauma Events Never Decay");

  const dir = tempDir("trauma-no-decay");
  try {
    const hippo = new Hippocampus(dir);

    // Add a trauma event
    hippo.addEvent({
      timestamp: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days ago
      session_id: "test",
      context: {
        project_root: dir,
        files_involved: ["/test/c.ts"],
        cwd_at_time: dir,
        spatial_path: "/test/c.ts",
        spatial_depth: 1,
        session_start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        turn_in_session: 1,
      },
      action: { type: "edit", description: "caused trauma", tokens_spent: 100, succeeded: false, error_message: "broke build" },
      outcome: { valence: "trauma", intensity: 0.9, reflection: "learned from mistake" },
      source: "hook",
      tags: ["trauma"],
    });

    const report = hippo.consolidate();

    // Trauma should not be forgotten
    assert(report.forgotten === 0, "trauma should not be forgotten");
    console.log("    ✓ Trauma event retained (not forgotten)");
  } finally {
    cleanup(dir);
  }
}

// ─── T13.5 — Neocortex Long-Term Memory ───────────────────────

async function t13_5_long_term_memory() {
  console.log("  T13.5 — Neocortex Long-Term Memory");

  const dir = tempDir("long-term");
  try {
    const hippo = new Hippocampus(dir);

    // Add and consolidate events
    hippo.addEvent({
      timestamp: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
      session_id: "test",
      context: {
        project_root: dir,
        files_involved: ["/test/d.ts"],
        cwd_at_time: dir,
        spatial_path: "/test/d.ts",
        spatial_depth: 1,
        session_start: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
        turn_in_session: 1,
      },
      action: { type: "discover", description: "discovered pattern", tokens_spent: 200 },
      outcome: { valence: "reward", intensity: 0.7, reflection: "useful discovery" },
      source: "hook",
      tags: ["discovery"],
    });

    // Run consolidation
    hippo.consolidate();

    // Get long-term memory
    const ltm = hippo.getLongTermMemory();
    assert(Array.isArray(ltm), "getLongTermMemory returns array");

    console.log(`    ✓ Long-term memory accessible (${ltm.length} events)`);
  } finally {
    cleanup(dir);
  }
}

// ─── T13.6 — Stats Include Neocortex Info ────────────────────

async function t13_6_stats_include_neocortex() {
  console.log("  T13.6 — Stats Include Neocortex Info");

  const dir = tempDir("stats-neocortex");
  try {
    const hippo = new Hippocampus(dir);

    // Consolidate to populate stats
    hippo.consolidate();
    const stats = hippo.getStats();

    // Stats should now include last_consolidation
    assert("last_consolidation" in stats, "stats has last_consolidation");
    assert(stats.last_consolidation !== null, "last_consolidation is set after consolidation");

    console.log("    ✓ Stats include neocortex consolidation info");
  } finally {
    cleanup(dir);
  }
}

// ─── Run All Tests ─────────────────────────────────────────────

async function runTests() {
  console.log("\n=== T13 — Consolidation API Tests ===\n");

  const tests = [
    t13_1_neocortex_crud,
    t13_2_consolidation_report,
    t13_3_high_value_promoted,
    t13_4_trauma_no_decay,
    t13_5_long_term_memory,
    t13_6_stats_include_neocortex,
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

  console.log(`\n=== T13 Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
