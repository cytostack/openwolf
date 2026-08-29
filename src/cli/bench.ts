import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { scanProjectUsage, projectTranscriptDir } from "../tracker/transcript-usage.js";

// ─────────────────────────────────────────────────────────────────────────────
// `openwolf bench` (2.5, Phase 6 of the evidence-based roadmap): the A/B
// harness that gates every release claim. Runs a fixed task set against two
// fresh clones of a fixture repo — one with OpenWolf initialized, one bare —
// via headless `claude -p`, then reports MEASURED usage (input, output,
// cache read, cache write, api calls, all from transcripts), task completion,
// and the re-run rate (repeated identical Bash commands — the failure
// signature of over-aggressive output condensation).
//
// Costs real API budget: refuses to run without --yes.
// ─────────────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface BenchOptions {
  repo?: string;
  task?: string;
  repeats?: string;
  yes?: boolean;
}

interface ArmResult {
  task: string;
  arm: "openwolf" | "bare";
  repeat: number;
  /** The exact source revision this arm ran against (#90). */
  commit: string;
  completed: boolean;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  api_calls: number;
  bash_commands: number;
  bash_reruns: number;
}

/**
 * Resolve the repository's current HEAD to an immutable commit SHA, once,
 * before any arm is prepared.
 *
 * Issue #90, reported with PR #112 by @davdittrich.
 */
export function resolveRepoCommit(repo: string): string {
  const out = execFileSync("git", ["ls-remote", repo, "HEAD"], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const sha = out.split(/\s+/)[0]?.trim() ?? "";
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`no HEAD commit for ${repo}`);
  return sha;
}

/**
 * Check out one exact commit into `destDir`.
 *
 * Tries a shallow fetch of the pinned SHA first (supported by GitHub and by
 * local repositories); falls back to a full clone plus checkout for servers
 * that refuse to serve arbitrary SHAs. Either way every arm gets the same
 * tree, which is the point.
 */
export function prepareRepoCheckout(repo: string, commit: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true });
  const git = (args: string[], cwd = destDir): void => {
    execFileSync("git", args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
  };
  try {
    git(["init", "--quiet"]);
    git(["remote", "add", "origin", repo]);
    git(["fetch", "--depth", "1", "--quiet", "origin", commit]);
    git(["checkout", "--quiet", "FETCH_HEAD"]);
  } catch {
    fs.rmSync(destDir, { recursive: true, force: true });
    fs.mkdirSync(destDir, { recursive: true });
    execFileSync("git", ["clone", "--quiet", repo, destDir], { stdio: ["ignore", "ignore", "pipe"] });
    git(["checkout", "--quiet", commit]);
  }
}

function findTasksDir(): string | null {
  const candidates = [
    path.resolve(__dirname, "..", "..", "..", "scripts", "benchmark", "tasks"),
    path.resolve(__dirname, "..", "..", "scripts", "benchmark", "tasks"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function findOwnBin(): string {
  const candidates = [
    path.resolve(__dirname, "..", "..", "bin", "openwolf.js"),
    path.resolve(__dirname, "..", "..", "..", "dist", "bin", "openwolf.js"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return "openwolf";
}

/** Re-run rate from the run's transcripts: repeated identical Bash commands. */
function bashRerunStats(workDir: string): { commands: number; reruns: number } {
  let commands = 0;
  let reruns = 0;
  try {
    const dir = projectTranscriptDir(workDir);
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".jsonl")) continue;
      const seen = new Map<string, number>();
      for (const line of fs.readFileSync(path.join(dir, f), "utf-8").split("\n")) {
        if (!line.includes('"Bash"')) continue;
        try {
          const entry = JSON.parse(line);
          for (const c of entry?.message?.content ?? []) {
            if (c.type === "tool_use" && c.name === "Bash" && typeof c.input?.command === "string") {
              commands++;
              const n = (seen.get(c.input.command) ?? 0) + 1;
              seen.set(c.input.command, n);
              if (n > 1) reruns++;
            }
          }
        } catch {}
      }
    }
  } catch {}
  return { commands, reruns };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export function benchCommand(opts: BenchOptions): void {
  const repo = opts.repo;
  if (!repo) {
    console.log("Usage: openwolf bench --repo <path-or-git-url> [--task name] [--repeats N] --yes");
    process.exitCode = 1;
    return;
  }
  const tasksDir = findTasksDir();
  if (!tasksDir) {
    console.log("Benchmark task set not found (scripts/benchmark/tasks). Run from a source checkout.");
    process.exitCode = 1;
    return;
  }
  const tasks = fs.readdirSync(tasksDir)
    .filter((f) => f.endsWith(".md"))
    .filter((f) => !opts.task || f.includes(opts.task))
    .map((f) => ({ name: f.replace(/\.md$/, ""), prompt: fs.readFileSync(path.join(tasksDir, f), "utf-8").trim() }));
  if (tasks.length === 0) {
    console.log("No tasks matched.");
    process.exitCode = 1;
    return;
  }
  const repeats = Math.max(1, parseInt(opts.repeats ?? "3", 10) || 3);
  const runs = tasks.length * repeats * 2;
  console.log(`openwolf bench: ${tasks.length} task(s) x ${repeats} repeat(s) x 2 arms = ${runs} headless claude runs.`);
  console.log("This spends real API budget (each run can use 50-300k tokens).");
  if (!opts.yes) {
    console.log("Refusing to run without --yes.");
    process.exitCode = 1;
    return;
  }

  const ownBin = findOwnBin();
  const results: ArmResult[] = [];

  // Pin ONE revision before any arm is prepared. Every arm and repeat used to
  // clone the repository's mutable HEAD independently, so a branch that moved
  // mid-run gave different arms different source trees. Arms are supposed to
  // differ only in whether OpenWolf is enabled; source drift silently
  // confounds every token, turn, and timing comparison in the report (#90).
  let pinnedCommit: string;
  try {
    pinnedCommit = resolveRepoCommit(repo);
  } catch (err) {
    console.log(`could not resolve a commit for ${repo}: ${String(err).slice(0, 120)}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Pinned source revision: ${pinnedCommit}`);

  for (const task of tasks) {
    for (let r = 0; r < repeats; r++) {
      for (const arm of ["bare", "openwolf"] as const) {
        const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `owbench-${task.name}-${arm}-`));
        const repoDir = path.join(workDir, "repo");
        try {
          prepareRepoCheckout(repo, pinnedCommit, repoDir);
        } catch (err) {
          console.log(`checkout of ${pinnedCommit.slice(0, 12)} failed: ${String(err).slice(0, 120)}`);
          process.exitCode = 1;
          return;
        }
        if (arm === "openwolf") {
          try {
            execFileSync(process.execPath, [ownBin, "init"], { cwd: repoDir, stdio: "ignore", timeout: 120000 });
          } catch {}
        }

        console.log(`[${task.name}] repeat ${r + 1}/${repeats} arm=${arm} ...`);
        let completed = true;
        try {
          execFileSync("claude", ["-p", task.prompt, "--output-format", "json"], {
            cwd: repoDir, stdio: ["ignore", "ignore", "inherit"], timeout: 30 * 60 * 1000,
          });
        } catch {
          completed = false;
        }

        const usage = scanProjectUsage(repoDir) ?? {
          input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0, api_calls: 0,
        };
        const rerun = bashRerunStats(repoDir);
        results.push({
          task: task.name,
          arm,
          repeat: r,
          commit: pinnedCommit,
          completed,
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
          cache_read_input_tokens: usage.cache_read_input_tokens,
          cache_creation_input_tokens: usage.cache_creation_input_tokens,
          api_calls: usage.api_calls,
          bash_commands: rerun.commands,
          bash_reruns: rerun.reruns,
        });
        try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
      }
    }
  }

  // ── Report: medians per task per arm, cache dimensions separate ───────────
  console.log("\n================ BENCH RESULTS (medians) ================");
  const dims = ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "api_calls"] as const;
  for (const task of tasks) {
    console.log(`\n  ${task.name}`);
    for (const arm of ["bare", "openwolf"] as const) {
      const rows = results.filter((x) => x.task === task.name && x.arm === arm);
      const med = dims.map((d) => `${d.replace(/_input_tokens|_tokens/, "")} ${median(rows.map((x) => x[d])).toLocaleString("en-US")}`).join(" | ");
      const done = rows.filter((x) => x.completed).length;
      const cmds = rows.reduce((s, x) => s + x.bash_commands, 0);
      const rr = rows.reduce((s, x) => s + x.bash_reruns, 0);
      const rrPct = cmds > 0 ? ((rr / cmds) * 100).toFixed(1) : "0.0";
      console.log(`    ${arm.padEnd(8)} ${med} | completed ${done}/${rows.length} | bash re-run rate ${rrPct}%`);
    }
  }
  console.log("\n  Gate guidance: openwolf arm should show lower output-side context growth");
  console.log("  and a bash re-run rate within 2 points of bare (higher = condensation");
  console.log("  is destroying information the model needs).");

  console.log(`\n  Source revision (all arms): ${pinnedCommit}`);
  const outPath = path.join(process.cwd(), `openwolf-bench-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ repo, commit: pinnedCommit, repeats, results }, null, 2));
  console.log(`\n  Raw results: ${outPath}`);
}
