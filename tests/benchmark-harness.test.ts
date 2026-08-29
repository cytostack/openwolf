import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// The benchmark harness core: buildBenchmark(options) -> Baseline.
// Red first: this import resolves only after benchmarks/index.ts exists.

test("buildBenchmark produces a well-formed baseline", async () => {
  const { buildBenchmark } = await import("../benchmarks/index.ts");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-bench-test-"));
  const wolfDir = path.join(root, ".wolf");
  fs.mkdirSync(wolfDir, { recursive: true });
  // Fixture: clean stores (0/0) so outcome reports insufficient data.
  fs.writeFileSync(
    path.join(wolfDir, "hippocampus.json"),
    JSON.stringify({ stats: { recurrences: 0, negative_writes: 0 } })
  );
  fs.writeFileSync(
    path.join(wolfDir, "token-ledger.json"),
    JSON.stringify({
      lifetime: {
        estimated_savings_vs_bare_cli: 100,
        repeated_reads_blocked: 1,
        anatomy_hits: 2,
        recurrences: 0,
        negative_writes: 0,
      },
    })
  );

  const baseline = await buildBenchmark({
    wolfDir,
    iterations: 2000,
    automatedCoverage: false,
  });

  // coverage
  assert.ok(baseline.coverage.seams_total > 0, "seams_total > 0");
  assert.strictEqual(
    baseline.coverage.seams_tested + baseline.coverage.seams_untested,
    baseline.coverage.seams_total,
    "tested + untested === total"
  );
  assert.ok(baseline.coverage.coverage_pct >= 0 && baseline.coverage.coverage_pct <= 100);
  assert.ok(Array.isArray(baseline.coverage.gaps));

  // performance (structure; numbers are machine-specific so never asserted)
  assert.ok(Array.isArray(baseline.performance.ops));
  for (const op of baseline.performance.ops) {
    assert.ok(typeof op.name === "string" && op.name.length > 0);
    assert.ok(op.kind === "pure" || op.kind === "io");
    if (op.ops_per_sec !== null) assert.ok(Number.isFinite(op.ops_per_sec));
    if (op.median_ms !== null) assert.ok(Number.isFinite(op.median_ms));
  }

  // outcome (fixture is 0/0 -> insufficient data)
  assert.strictEqual(baseline.outcome.insufficient_data, true);
  assert.strictEqual(baseline.outcome.recurrence_rate, null);
  assert.strictEqual(baseline.outcome.token_savings_vs_bare_cli, 100);
});
