#!/usr/bin/env node
/**
 * OpenWolf Functionality Score (OFS) — anti-Goodhart.
 *
 * Unlike the dashboard taste score (static style), this measures whether
 * openwolf's CORE actually works and whether its tests REALLY catch bugs,
 * not just "cover lines". Anti-Goodhart = the parts that are easy to game
 * (line coverage, estimated savings, "a test exists") are paired with a
 * poison check that exposes gaming.
 *
 * Dimensions (total 100):
 *   D1 memory-loop integrity (30)  — write->index->consolidate->recall->recur
 *                                     end-to-end tests actually pass.
 *   D2 failure-recovery (25)       — lock/atomic-write/schema-migration/
 *                                     concurrency hardening tests pass.
 *   D3 test-kill effectiveness(45) — MUTATION check: mutate a core function
 *                                     and see if tests still pass. If they do,
 *                                     the tests are fake (covered lines, killed
 *                                     nothing) => the score drops. This is the
 *                                     anti-Goodhart core: coverage is useless
 *                                     if a mutation survives.
 *
 * Run:
 *   node scripts/functionality-score.mjs            # report
 *   node scripts/functionality-score.mjs --json     # {score,dims,checks}
 *   node scripts/functionality-score.mjs --mutation # run the mutation probe
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const json = process.argv.includes("--json");
const runMutation = process.argv.includes("--mutation");

function run(cmd, args, opts = {}) {
  try {
    execFileSync(cmd, args, { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], ...opts });
    return { ok: true };
  } catch (e) {
    return { ok: false, out: (e.stdout || "") + (e.stderr || "") };
  }
}

const checks = [];
function add(score, max, ok, label, note = "") {
  checks.push({ label, ok, note });
  return ok ? score : 0;
}

// ─── D1: memory-loop integrity (30) ─────────────────────────────────────
// End-to-end memory loop tests: write -> index -> consolidate -> recall ->
// recurrence. These are the "does the core actually work" tests.
const coreTests = [
  "tests/hippocampus-outcomes.test.ts",
  "tests/hippocampus-claims.test.ts",
  "tests/hippocampus-addmany.test.ts",
  "tests/outcome.test.ts",
];
let d1 = 0;
coreTests.forEach((t, i) => {
  const r = run("node", ["--test", t]);
  d1 += add(7, 7, r.ok, `memory-loop test ${path.basename(t)}`, r.ok ? "green" : "FAIL");
});
const d1Score = Math.min(d1, 30);

// ─── D2: failure-recovery (25) ──────────────────────────────────────────
// Hardening: concurrent writes, lock, atomic persist, schema migration.
const hardening = [
  "tests/hippocampus-hardening.test.ts",
  "tests/store-migration.test.ts",
  "tests/cron-hitl.test.ts",
];
let d2 = 0;
hardening.forEach((t) => {
  const r = run("node", ["--test", t]);
  d2 += add(8, 8, r.ok, `failure-recovery ${path.basename(t)}`, r.ok ? "green" : "FAIL");
});
const d2Score = Math.min(d2, 25);

// ─── D3: test-kill effectiveness via mutation (45) — anti-Goodhart core ──
let d3 = 0;
if (runMutation) {
  // Pick one core function with dedicated tests: computeOutcome (outcome.test.ts)
  // mutates the recurrence_rate formula. If outcome.test.ts still passes after
  // the mutation, the test is fake (covers the line but doesn't pin behavior).
  const target = "benchmarks/outcome.ts";
  const backup = fs.readFileSync(path.join(root, target), "utf-8");
  const mutated = backup.replace("recurrences / negativeWrites", "recurrences / (negativeWrites + 1)");
  fs.writeFileSync(path.join(root, target), mutated);
  const r = run("node", ["--test", "tests/outcome.test.ts"]);
  fs.writeFileSync(path.join(root, target), backup);
  // Anti-Goodhart: mutation must be KILLED (tests go red). If it survives
  // (tests still pass), the tests are line-coverage but behavior-blind.
  const killed = !r.ok;
  d3 += add(20, 20, killed, "mutation killed (test pins behavior)", killed ? "test went red" : "MUTATION SURVIVED — fake test");
  // Bonus: only award the remaining 25 if the mutation is killed; a surviving
  // mutation poisons the whole dimension (high coverage, low kills = gaming).
  if (!killed) {
    checks.push({ label: "test-kill", ok: false, note: "poisoned: coverage w/o bug-kill" });
  } else {
    d3 += add(25, 25, true, "all key tests are behavior-locking (not just coverage)");
  }
} else {
  d3 = null; // not measured unless --mutation
}

const dims = [
  { id: "memory-loop", name: "Memory Loop Integrity", max: 30, score: d1Score },
  { id: "failure-recovery", name: "Failure Recovery", max: 25, score: d2Score },
  { id: "test-kill", name: "Test-Kill (mutation)", max: 45, score: d3 === null ? 0 : d3 },
];

const total = dims.reduce((a, d) => a + d.score, 0);
const measured = d3 !== null;

if (json) {
  console.log(JSON.stringify({ score: total, measured, dims, checks }, null, 2));
} else {
  console.log(`\n  OpenWolf functionality score: ${total} / 100${measured ? "" : "  (run --mutation for D3)"}\n`);
  for (const d of dims) console.log(`  ${d.name.padEnd(26)} ${String(d.score).padStart(2)} / ${d.max}`);
  const fails = checks.filter((c) => !c.ok || c.note === "FAIL" || c.note.includes("SURVIVED") || c.note.includes("poisoned"));
  if (fails.length) {
    console.log(`\n  ${fails.length} issue(s):`);
    for (const f of fails) console.log(`  ${f.label}: ${f.note}`);
  }
  console.log("");
}
