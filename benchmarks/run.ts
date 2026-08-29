import * as fs from "node:fs";
import * as path from "node:path";
import { buildBenchmark, type Baseline } from "./index.ts";

function renderMarkdown(b: Baseline): string {
  const c = b.coverage;
  const p = b.performance;
  const o = b.outcome;

  const lines: string[] = [];
  lines.push("# OpenWolf Benchmark");
  lines.push("");
  lines.push(`> Generated ${b.generated_at} · Node ${b.node_version}`);
  lines.push("");

  lines.push("## Coverage");
  lines.push("");
  lines.push(
    `- Seams: **${c.seams_tested}/${c.seams_total}** tested (${c.coverage_pct}%)`
  );
  lines.push(
    `- Automated line coverage: ${c.automated.line_coverage_pct === null ? "not run (pass --coverage)" : `${c.automated.line_coverage_pct}%`}`
  );
  lines.push("");
  if (c.gaps.length > 0) {
    lines.push(`### Gaps (${c.gaps.length} untested seams)`);
    lines.push("");
    for (const gap of c.gaps) lines.push(`- \`${gap}\``);
  } else {
    lines.push("No coverage gaps.");
  }
  lines.push("");

  lines.push("## Performance");
  lines.push("");
  if (p.error) {
    lines.push(`⚠️ ${p.error}`);
  } else {
    lines.push("| Op | Kind | Iterations | ops/sec | median (ms) | p95 (ms) |");
    lines.push("|---|---|---:|---:|---:|---:|");
    for (const op of p.ops) {
      lines.push(
        `| ${op.name} | ${op.kind} | ${op.iterations} | ${op.ops_per_sec ?? "—"} | ${op.median_ms ?? "—"} | ${op.p95_ms ?? "—"} |`
      );
    }
  }
  lines.push("");

  lines.push("## Outcome");
  lines.push("");
  if (o.insufficient_data) {
    lines.push("⚠️ **Insufficient data**: no negative writes recorded yet (dogfood dormant), so recurrence_rate is undefined.");
  } else {
    lines.push(`- recurrence_rate: **${o.recurrence_rate}**`);
  }
  lines.push(
    `- token savings vs bare CLI: ${o.token_savings_vs_bare_cli ?? "n/a"}`
  );
  lines.push(`- repeated reads blocked: ${o.repeated_reads_blocked ?? "n/a"}`);
  lines.push(`- anatomy hits: ${o.anatomy_hits ?? "n/a"}`);
  lines.push(`- recurrences / negative writes: ${o.recurrences} / ${o.negative_writes}`);
  lines.push("");

  return lines.join("\n");
}

async function main(): Promise<void> {
  const root = process.cwd();
  const wolfDir = path.join(root, ".wolf");
  const iterations = Number(process.env.BENCH_ITERATIONS ?? 100_000);
  const automatedCoverage = process.argv.includes("--coverage");

  const baseline = await buildBenchmark({ wolfDir, iterations, automatedCoverage });

  const benchDir = path.join(root, "benchmarks");
  fs.mkdirSync(benchDir, { recursive: true });
  fs.writeFileSync(
    path.join(benchDir, "baseline.json"),
    JSON.stringify(baseline, null, 2) + "\n"
  );
  fs.mkdirSync(path.join(root, "docs3"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs3", "benchmark.md"), renderMarkdown(baseline));

  const c = baseline.coverage;
  console.log(
    `Wrote benchmarks/baseline.json + docs3/benchmark.md — coverage ${c.seams_tested}/${c.seams_total} (${c.coverage_pct}%), ${c.gaps.length} gaps`
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
