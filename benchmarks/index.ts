import { collectCoverage, type CoverageResult } from "./coverage.ts";
import { collectOutcome, type OutcomeResult } from "./outcome.ts";
import { collectPerformance, type PerformanceResult } from "./performance.ts";

export interface Baseline {
  schema_version: 1;
  generated_at: string;
  node_version: string;
  coverage: CoverageResult;
  performance: PerformanceResult;
  outcome: OutcomeResult;
}

export interface BenchmarkOptions {
  wolfDir: string;
  iterations?: number;
  automatedCoverage?: boolean;
}

export async function buildBenchmark(
  opts: BenchmarkOptions
): Promise<Baseline> {
  const coverage = collectCoverage({
    automatedCoverage: opts.automatedCoverage ?? false,
  });
  const performance = await collectPerformance({ iterations: opts.iterations });
  const outcome = collectOutcome(opts.wolfDir);

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    node_version: process.version,
    coverage,
    performance,
    outcome,
  };
}
