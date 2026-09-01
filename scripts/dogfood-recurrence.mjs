#!/usr/bin/env node
/**
 * OpenWolf hippocampus — recurrence dogfood harness.
 *
 * Drives the *real* production hooks (user-prompt.js → penalty, post-write.js
 * → fix-shaped edit → recordRecurrence) end-to-end, in an isolated temp project
 * directory, to manufacture the "犯错 → 修 → 再犯" cycle and produce the first
 * clean non-zero `recurrence_rate` reading.
 *
 * This is genuine dogfood: it does NOT re-implement the detection logic. It
 * feeds synthetic-but-realistic tool payloads through the exact hook scripts
 * that run in production, then reads the resulting `hippocampus.json` stats.
 *
 * Usage:
 *   node scripts/dogfood-recurrence.mjs                 # isolated temp project
 *   node scripts/dogfood-recurrence.mjs --verbose       # per-step detail
 *   node scripts/dogfood-recurrence.mjs --project-root <dir>   # target a real repo
 *   node scripts/dogfood-recurrence.mjs --rounds 5      # repeat the re-offend block
 *
 * Flags:
 *   --project-root <dir>   run against a specific project (defaults to a fresh tmp dir)
 *   --rounds <n>           number of full 犯错→修→再犯 cycles (default 2)
 *   --verbose              print each hook invocation + stderr
 *   --keep                 do not delete the temp project dir on exit
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOKS_DIR = path.resolve(__dirname, "..", ".wolf", "hooks");

// ─── Args ────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { projectRoot: null, rounds: 2, verbose: false, keep: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--project-root") args.projectRoot = argv[++i];
    else if (a === "--rounds") args.rounds = Number(argv[++i]);
    else if (a === "--verbose") args.verbose = true;
    else if (a === "--keep") args.keep = true;
  }
  return args;
}

// ─── Hook runner ─────────────────────────────────────────────────────────
function runHook(hookName, payload, projectDir, sessionId, verbose) {
  return new Promise((resolve) => {
    const env = {
      CLAUDE_PROJECT_DIR: projectDir,
      CLAUDE_SESSION_ID: sessionId,
      CLAUDE_SESSION_START: new Date().toISOString(),
    };
    const child = spawn(process.execPath, [path.join(HOOKS_DIR, hookName)], {
      cwd: projectDir,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      if (verbose) {
        process.stdout.write(`\n  ── ${hookName} (exit ${code}) ──\n`);
        process.stdout.write(`  stdin: ${JSON.stringify(payload)}\n`);
        if (stderr.trim()) process.stdout.write(`  ${stderr.trim().replace(/\n/g, "\n  ")}\n`);
      }
      resolve({ code, stderr });
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

// ─── Stats reader ────────────────────────────────────────────────────────
function readStats(projectDir) {
  const p = path.join(projectDir, ".wolf", "hippocampus.json");
  try {
    const store = JSON.parse(fs.readFileSync(p, "utf-8"));
    const s = store.stats ?? {};
    return {
      penalty_count: s.penalty_count ?? 0,
      recurrences: s.recurrences ?? 0,
      negative_writes: s.negative_writes ?? 0,
      rate: (s.negative_writes ?? 0) > 0 ? (s.recurrences ?? 0) / (s.negative_writes ?? 0) : 0,
    };
  } catch {
    return null;
  }
}

// ─── Scenario: a concrete 犯错→修→再犯 loop ──────────────────────────────
// Each step is a real hook invocation. Corrections carry a path so the penalty
// is location-tagged (test-failure penalties have files_involved:[] and can
// never match a fix-edit, so user-correction is the correct penalty source).
function buildSteps(rounds) {
  const steps = [];
  for (let r = 1; r <= rounds; r++) {
    steps.push({
      label: `penalty ${r} (tax.ts — wrong rate)`,
      hook: "user-prompt.js",
      payload: {
        prompt: `The tax rate is wrong — fix it in src/tax.ts`,
        tool_name: "UserPromptSubmit",
        tool_input: {},
      },
    });
    steps.push({
      label: `fix ${r} (tax.ts)`,
      hook: "post-write.js",
      payload: {
        tool_name: "Edit",
        tool_input: {
          file_path: "src/tax.ts",
          old_string: `const TAX_RATE = 1.${r + 1}; // WRONG rate`,
          new_string: "const TAX_RATE = 1.1;",
        },
      },
    });
  }
  // One unresolved penalty (no fix edit) — demonstrates a sub-1.0 rate.
  steps.push({
    label: "penalty (shipping.ts — unresolved)",
    hook: "user-prompt.js",
    payload: {
      prompt: "There's a bug in src/shipping.ts — the fee is incorrect",
      tool_name: "UserPromptSubmit",
      tool_input: {},
    },
  });
  return steps;
}

// ─── Main ────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sessionId = "dogfood-recurrence";

  let projectDir = args.projectRoot;
  let tempDir = null;
  if (!projectDir) {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dogfood-recurrence-"));
    projectDir = tempDir;
    // The hooks bail silently when `.wolf/` is absent (they only run inside an
    // existing OpenWolf project), so seed the directory before driving them.
    fs.mkdirSync(path.join(projectDir, ".wolf"), { recursive: true });
    fs.mkdirSync(path.join(projectDir, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "src", "tax.ts"),
      "export const TAX_RATE = 1.1;\n",
    );
    fs.writeFileSync(
      path.join(projectDir, "src", "shipping.ts"),
      "export const SHIPPING_FEE = 5;\n",
    );
  }

  process.stdout.write(`\nOpenWolf recurrence dogfood\n`);
  process.stdout.write(`  hooks dir : ${HOOKS_DIR}\n`);
  process.stdout.write(`  project   : ${projectDir}\n`);
  process.stdout.write(`  session   : ${sessionId}\n`);

  const before = readStats(projectDir) ?? { penalty_count: 0, recurrences: 0, negative_writes: 0, rate: 0 };
  process.stdout.write(`\n  before    : penalty=${before.penalty_count} recurrences=${before.recurrences} rate=${before.rate.toFixed(3)}\n`);

  const steps = buildSteps(args.rounds);
  for (const step of steps) {
    await runHook(step.hook, step.payload, projectDir, sessionId, args.verbose);
    const s = readStats(projectDir);
    process.stdout.write(
      `  ✓ ${step.label.padEnd(38)} → penalty=${s.penalty_count} recurrences=${s.recurrences}\n`,
    );
  }

  const after = readStats(projectDir);
  const expectedPenalty = args.rounds + 1; // one per round + the unresolved one
  const expectedRecurrences = args.rounds; // every fix edit after a penalty
  const passed =
    after.penalty_count === expectedPenalty && after.recurrences === expectedRecurrences;

  process.stdout.write(`\n  after     : penalty=${after.penalty_count} recurrences=${after.recurrences} negative_writes=${after.negative_writes} recurrence_rate=${after.rate.toFixed(3)}\n`);
  process.stdout.write(`  expected  : penalty=${expectedPenalty} recurrences=${expectedRecurrences}\n`);
  process.stdout.write(`\n  ${passed ? "PASS" : "FAIL"} — recurrence_rate ${after.rate > 0 ? `is non-zero (${after.rate.toFixed(3)})` : "still 0"}\n`);

  if (tempDir && !args.keep) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    process.stdout.write(`  (temp project removed)\n`);
  } else if (tempDir) {
    process.stdout.write(`  (temp project kept at ${tempDir})\n`);
  }

  process.stdout.write("\n");
  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  console.error("dogfood failed:", err);
  process.exit(2);
});
