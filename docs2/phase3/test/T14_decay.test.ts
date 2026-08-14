// T14 — Decay Logic Tests
// Tests for exponential decay, consolidation scoring, and forget threshold

import * as fs from "node:fs";
import * as path from "node:path";
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

function assertApprox(actual: number, expected: number, tolerance: number, msg: string) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`ASSERTION FAILED: ${msg}\n  Expected: ~${expected} (±${tolerance})\n  Actual: ${actual}`);
  }
}

// ─── T14.1 — Trauma Never Decays ───────────────────────────────

async function t14_1_trauma_never_decays() {
  console.log("  T14.1 — Trauma Never Decays");

  // Calculate decay for trauma over 30 days
  const lastDecayCheck = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const decayFactor = consolidation.calculateDecay(lastDecayCheck, "trauma", 1.0);

  assert(decayFactor === 1.0, "Trauma decay factor should remain 1.0");
  console.log("    ✓ Trauma decay factor remains 1.0");
}

// ─── T14.2 — Normal Events Decay Over Time ───────────────────

async function t14_2_normal_decay() {
  console.log("  T14.2 — Normal Events Decay Over Time");

  const lastDecayCheck = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days ago
  const decayFactor = consolidation.calculateDecay(lastDecayCheck, "neutral", 1.0);

  // 5% weekly decay = 0.05 per 7 days
  // So after 7 days, decay should be 1 - 0.05 = 0.95
  assertApprox(decayFactor, 0.95, 0.01, "Neutral decay factor after 7 days");
  console.log(`    ✓ Neutral decay after 7 days: ${decayFactor.toFixed(4)}`);
}

// ─── T14.3 — Decay Compounds Over Multiple Weeks ─────────────

async function t14_3_decay_compounds() {
  console.log("  T14.3 — Decay Compounds Over Multiple Weeks");

  const lastDecayCheck = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString(); // 28 days (4 weeks)
  const decayFactor = consolidation.calculateDecay(lastDecayCheck, "neutral", 1.0);

  // After 4 weeks: 1 - (0.05 * 4) = 0.8 (linear decay)
  assertApprox(decayFactor, 0.8, 0.01, "Decay over 4 weeks");
  console.log(`    ✓ Decay after 4 weeks: ${decayFactor.toFixed(4)}`);
}

// ─── T14.4 — Decay Never Goes Below Zero ─────────────────────

async function t14_4_decay_floor() {
  console.log("  T14.4 — Decay Never Goes Below Zero");

  const lastDecayCheck = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(); // 1 year ago
  const decayFactor = consolidation.calculateDecay(lastDecayCheck, "neutral", 1.0);

  assert(decayFactor >= 0, "Decay factor should never go below 0");
  assert(decayFactor <= 1.0, "Decay factor should never exceed 1.0");
  console.log(`    ✓ Decay factor bounded: ${decayFactor.toFixed(4)}`);
}

// ─── T14.5 — Low Decay Factor Events Decay Further ───────────

async function t14_5_already_decayed() {
  console.log("  T14.5 — Already Decayed Events Decay Further");

  const lastDecayCheck = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days ago
  const decayFactor = consolidation.calculateDecay(lastDecayCheck, "neutral", 0.5);

  // Starting from 0.5, decay by 5%
  assertApprox(decayFactor, 0.5 * 0.95, 0.01, "Already decayed event decays further");
  console.log(`    ✓ Pre-decayed event (0.5) decays to: ${decayFactor.toFixed(4)}`);
}

// ─── T14.6 — Consolidation Score Calculation ──────────────────

async function t14_6_consolidation_score() {
  console.log("  T14.6 — Consolidation Score Calculation");

  const event = {
    id: "test",
    version: 1 as const,
    timestamp: new Date().toISOString(),
    session_id: "test",
    context: {
      project_root: "/test",
      files_involved: ["/test/file.ts"],
      cwd_at_time: "/test",
      spatial_path: "/test/file.ts",
      spatial_depth: 1,
      session_start: new Date().toISOString(),
      turn_in_session: 1,
    },
    action: {
      type: "fix" as const,
      description: "important fix",
      tokens_spent: 100,
    },
    outcome: {
      valence: "reward" as const,
      intensity: 0.9,
      reflection: "great",
    },
    consolidation: {
      stage: "short-term" as const,
      access_count: 3,
      last_accessed: new Date().toISOString(),
      consolidation_score: 0,
      should_consolidate: false,
      decay_factor: 1.0,
      last_decay_check: new Date().toISOString(),
    },
    source: "hook" as const,
    tags: ["important"],
  };

  const score = consolidation.calculateConsolidationScore(event);

  // Should be high because:
  // - intensity 0.9 * 0.3 = 0.27
  // - access_count 3 * 0.05 = 0.15 (capped at 0.3)
  // - reward bonus = 0.2
  // - recency bonus = 0.15
  // Total before decay = 0.77, capped at 1.0
  assert(score > 0.5, "High-value event should have high score");
  assert(score <= 1.0, "Score should be capped at 1.0");
  console.log(`    ✓ High-value event score: ${score.toFixed(4)}`);
}

// ─── T14.7 — Low-Value Event Has Low Score ────────────────────

async function t14_7_low_score() {
  console.log("  T14.7 — Low-Value Event Has Low Score");

  const event = {
    id: "test",
    version: 1 as const,
    timestamp: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(), // 60 days ago
    session_id: "test",
    context: {
      project_root: "/test",
      files_involved: ["/test/file.ts"],
      cwd_at_time: "/test",
      spatial_path: "/test/file.ts",
      spatial_depth: 1,
      session_start: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
      turn_in_session: 1,
    },
    action: {
      type: "read" as const,
      description: "read file",
      tokens_spent: 10,
    },
    outcome: {
      valence: "neutral" as const,
      intensity: 0.2,
      reflection: "nothing special",
    },
    consolidation: {
      stage: "short-term" as const,
      access_count: 0,
      last_accessed: new Date().toISOString(),
      consolidation_score: 0,
      should_consolidate: false,
      decay_factor: 0.5, // Already decayed
      last_decay_check: new Date().toISOString(),
    },
    source: "hook" as const,
    tags: [],
  };

  const score = consolidation.calculateConsolidationScore(event);

  assert(score < 0.3, "Low-value old event should have low score");
  console.log(`    ✓ Low-value old event score: ${score.toFixed(4)}`);
}

// ─── T14.8 — Determine Consolidation Action ────────────────────

async function t14_8_determine_action() {
  console.log("  T14.8 — Determine Consolidation Action");

  const now = new Date();

  // Short-term event with high score should be promoted
  const highScoreEvent = {
    id: "test-high",
    version: 1 as const,
    timestamp: new Date().toISOString(),
    session_id: "test",
    context: {
      project_root: "/test",
      files_involved: ["/test/file.ts"],
      cwd_at_time: "/test",
      spatial_path: "/test/file.ts",
      spatial_depth: 1,
      session_start: new Date().toISOString(),
      turn_in_session: 1,
    },
    action: {
      type: "fix" as const,
      description: "critical fix",
      tokens_spent: 500,
    },
    outcome: {
      valence: "reward" as const,
      intensity: 0.95,
      reflection: "great",
    },
    consolidation: {
      stage: "short-term" as const,
      access_count: 5,
      last_accessed: new Date().toISOString(),
      consolidation_score: 0,
      should_consolidate: false,
      decay_factor: 1.0,
      last_decay_check: new Date().toISOString(),
    },
    source: "hook" as const,
    tags: [],
  };

  const result = consolidation.determineConsolidationAction(highScoreEvent, now);
  assert(result.action === "promote" || result.action === "keep", "High-score event should be promoted or kept");
  console.log(`    ✓ High-score event action: ${result.action}`);
}

// ─── T14.9 — Very Old Low-Intensity Forgotten ─────────────────

async function t14_9_forget_old_low_intensity() {
  console.log("  T14.9 — Very Old Low-Intensity Forgotten");

  const now = new Date();

  const forgottenEvent = {
    id: "test-old",
    version: 1 as const,
    timestamp: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString(), // 180 days ago
    session_id: "test",
    context: {
      project_root: "/test",
      files_involved: ["/test/file.ts"],
      cwd_at_time: "/test",
      spatial_path: "/test/file.ts",
      spatial_depth: 1,
      session_start: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString(),
      turn_in_session: 1,
    },
    action: {
      type: "read" as const,
      description: "read",
      tokens_spent: 5,
    },
    outcome: {
      valence: "neutral" as const,
      intensity: 0.1,
      reflection: "nothing",
    },
    consolidation: {
      stage: "consolidating" as const,
      access_count: 0,
      last_accessed: new Date().toISOString(),
      consolidation_score: 0,
      should_consolidate: false,
      decay_factor: 0.3,
      last_decay_check: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    },
    source: "hook" as const,
    tags: [],
  };

  const result = consolidation.determineConsolidationAction(forgottenEvent, now);
  assert(result.action === "forget", "Very old low-intensity event should be forgotten");
  console.log(`    ✓ Old low-intensity event action: ${result.action}`);
}

// ─── T14.10 — Long-Term Threshold Boundary (0.1 vs 0.2) ───────

async function t14_10_long_term_threshold_boundary() {
  console.log("  T14.10 — Long-Term Threshold Boundary (0.1 vs 0.2)");

  const now = new Date();

  // Event with score ~0.15 - should be kept (threshold is 0.1 for long-term)
  const boundaryEvent = {
    id: "test-boundary",
    version: 1 as const,
    timestamp: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    session_id: "test",
    context: {
      project_root: "/test",
      files_involved: ["/test/file.ts"],
      cwd_at_time: "/test",
      spatial_path: "/test/file.ts",
      spatial_depth: 1,
      session_start: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
      turn_in_session: 1,
    },
    action: {
      type: "edit" as const,
      description: "edit",
      tokens_spent: 50,
    },
    outcome: {
      valence: "neutral" as const,
      intensity: 0.5, // Moderate intensity
      reflection: "normal",
    },
    consolidation: {
      stage: "long-term" as const,
      access_count: 2, // Some access
      last_accessed: new Date().toISOString(),
      consolidation_score: 0,
      should_consolidate: false,
      decay_factor: 0.5, // Some decay
      last_decay_check: new Date().toISOString(),
    },
    source: "hook" as const,
    tags: [],
  };

  const result = consolidation.determineConsolidationAction(boundaryEvent, now);
  // Score ~0.15, threshold is 0.1, so should be kept
  assert(result.action === "keep", "Event with score 0.15 should be kept (threshold is 0.1)");
  console.log(`    ✓ Boundary event kept: ${result.action} (score was ~0.15, threshold 0.1)`);
}

// ─── Run All Tests ─────────────────────────────────────────────

async function runTests() {
  console.log("\n=== T14 — Decay Logic Tests ===\n");

  const tests = [
    t14_1_trauma_never_decays,
    t14_2_normal_decay,
    t14_3_decay_compounds,
    t14_4_decay_floor,
    t14_5_already_decayed,
    t14_6_consolidation_score,
    t14_7_low_score,
    t14_8_determine_action,
    t14_9_forget_old_low_intensity,
    t14_10_long_term_threshold_boundary,
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

  console.log(`\n=== T14 Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
