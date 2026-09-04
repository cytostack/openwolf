#!/usr/bin/env node
/**
 * OpenWolf A/B benchmark (Workstream J1.3): run the same task set against two
 * fresh clones of a fixture repo, one with OpenWolf initialized and one bare,
 * using headless `claude -p`, then report MEASURED usage (input, output,
 * cache read, cache write, api calls) per arm from the harness transcripts.
 *
 * Usage:
 *   node scripts/benchmark/run-ab.mjs --repo <path-or-git-url> [--repeats 3] [--task <name>] --yes
 *
 * Costs real API budget: it refuses to run without --yes.
 * Not shipped in the npm tarball; results and methodology live in README.md.
 */
import { execFileSync, execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

const repo = arg("repo", null);
const repeats = parseInt(arg("repeats", "3"), 10);
const onlyTask = arg("task", null);
const yes = process.argv.includes("--yes");

if (!repo) {
  console.error("Usage: node scripts/benchmark/run-ab.mjs --repo <path-or-git-url> [--repeats N] [--task name] --yes");
  process.exit(1);
}

const tasksDir = path.join(__dirname, "tasks");
const tasks = fs.readdirSync(tasksDir)
  .filter((f) => f.endsWith(".md"))
  .filter((f) => !onlyTask || f.includes(onlyTask))
  .map((f) => ({
    name: f.replace(/\.md$/, ""),
    prompt: fs.readFileSync(path.join(tasksDir, f), "utf-8").trim(),
  }));

if (tasks.length === 0) {
  console.error("No tasks matched.");
  process.exit(1);
}

const runs = tasks.length * repeats * 2;
console.log(`A/B benchmark: ${tasks.length} task(s) x ${repeats} repeat(s) x 2 arms = ${runs} headless claude runs.`);
console.log(`Rough cost guess: ${runs} runs x ~50-300k tokens each. This spends real API budget.`);
if (!yes) {
  console.error("Refusing to run without --yes.");
  process.exit(1);
}

// The scanner is the same code the daemon uses — measured numbers, not estimates.
const { scanProjectUsage, projectTranscriptDir } = await import(
  path.join(ROOT, "dist", "src", "tracker", "transcript-usage.js")
);

function cloneFixture(dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  if (fs.existsSync(repo)) {
    execFileSync("git", ["clone", "--depth", "1", "--quiet", path.resolve(repo), dest], { stdio: "inherit" });
  } else {
    execFileSync("git", ["clone", "--depth", "1", "--quiet", repo, dest], { stdio: "inherit" });
  }
}

/** Usage snapshot for a project dir (null-safe zeros). */
function usageOf(projectDir) {
  const u = scanProjectUsage(projectDir);
  return u ?? { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, api_calls: 0 };
}

function diffUsage(after, before) {
  return {
    input_tokens: after.input_tokens - before.input_tokens,
    output_tokens: after.output_tokens - before.output_tokens,
    cache_read_input_tokens: after.cache_read_input_tokens - before.cache_read_input_tokens,
    cache_creation_input_tokens: after.cache_creation_input_tokens - before.cache_creation_input_tokens,
    api_calls: after.api_calls - before.api_calls,
  };
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

const results = []; // {task, arm, repeat, usage}

for (const task of tasks) {
  for (let r = 0; r < repeats; r++) {
    for (const arm of ["openwolf", "bare"]) {
      const workDir = path.join(os.tmpdir(), `owbench-${task.name}-${arm}-${r}`);
      cloneFixture(workDir);

      if (arm === "openwolf") {
        execSync(`node ${path.join(ROOT, "dist", "bin", "openwolf.js")} init`, {
          cwd: workDir, stdio: "ignore", env: { ...process.env, OPENWOLF_NONINTERACTIVE: "1" },
        });
      }

      const before = usageOf(workDir);
      console.log(`\n[${task.name}] repeat ${r + 1}/${repeats} arm=${arm}`);
      try {
        execFileSync("claude", ["-p", task.prompt, "--output-format", "json"], {
          cwd: workDir, stdio: ["ignore", "ignore", "inherit"], timeout: 30 * 60 * 1000,
        });
      } catch (err) {
        console.error(`  run failed: ${err.message} (recorded as-is; transcripts still count)`);
      }
      const usage = diffUsage(usageOf(workDir), before);
      console.log(`  in ${usage.input_tokens} | out ${usage.output_tokens} | cache-read ${usage.cache_read_input_tokens} | cache-write ${usage.cache_creation_input_tokens} | calls ${usage.api_calls}`);
      results.push({ task: task.name, arm, repeat: r, usage });

      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }
}

// ── Report: medians per task per arm, each dimension separately ─────────────
console.log("\n================ A/B RESULTS (medians) ================\n");
const dims = ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "api_calls"];
const table = [];
for (const task of tasks) {
  for (const arm of ["bare", "openwolf"]) {
    const rows = results.filter((x) => x.task === task.name && x.arm === arm);
    const med = Object.fromEntries(dims.map((d) => [d, median(rows.map((x) => x.usage[d]))]));
    table.push({ task: task.name, arm, ...med });
  }
}
console.table(table);

const outPath = path.join(__dirname, `results-${new Date().toISOString().slice(0, 10)}.json`);
fs.writeFileSync(outPath, JSON.stringify({ repo, repeats, results, medians: table }, null, 2));
console.log(`\nRaw results written to ${outPath}`);
console.log("Report input, cache read, and cache write separately; do not collapse them into one number.");
