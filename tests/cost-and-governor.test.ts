import { test, describe } from "node:test";
import * as assert from "node:assert";

import { costOfProject, priceFor, formatUsd, CACHE_READ_MULTIPLIER, CACHE_WRITE_MULTIPLIER } from "../src/dashboard/app/lib/pricing.ts";
import { buildSessionTotals, foldEntryMaps, emptyMaps, foldMap, recomputeLifetime } from "../src/hooks/ledger-math.ts";
import type { SessionData, SessionEntry, LedgerData } from "../src/hooks/ledger-math.ts";

function usage(over: Partial<Record<string, number>> = {}) {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    api_calls: 0,
    ...over,
  };
}

describe("model pricing", () => {
  test("resolves ids by longest prefix, including dated snapshots", () => {
    assert.equal(priceFor("claude-opus-5")?.input, 5);
    assert.equal(priceFor("claude-opus-5-20260101")?.input, 5);
    assert.equal(priceFor("claude-fable-5")?.output, 50);
    assert.equal(priceFor("claude-sonnet-5")?.input, 3);
    assert.equal(priceFor("claude-haiku-4-5")?.output, 5);
    assert.equal(priceFor("some-other-model"), null);
  });

  test("cache reads bill at a tenth of input, cache writes at 1.25x", () => {
    // 1M cache-read tokens on a $5/MTok model is $0.50, not $5.
    const read = costOfProject({ "claude-opus-5": usage({ cache_read_input_tokens: 1_000_000 }) });
    assert.equal(read.total.toFixed(2), (5 * CACHE_READ_MULTIPLIER).toFixed(2));
    const write = costOfProject({ "claude-opus-5": usage({ cache_creation_input_tokens: 1_000_000 }) });
    assert.equal(write.total.toFixed(2), (5 * CACHE_WRITE_MULTIPLIER).toFixed(2));
  });

  test("the casepod shape: cache read dominates and the total is exact", () => {
    const cost = costOfProject({
      "claude-opus-5": usage({ input_tokens: 410, output_tokens: 213_731, cache_read_input_tokens: 92_209_468, cache_creation_input_tokens: 1_327_382, api_calls: 205 }),
      "claude-fable-5": usage({ input_tokens: 11_538, output_tokens: 127_583, cache_read_input_tokens: 10_043_293, cache_creation_input_tokens: 624_238, api_calls: 68 }),
      "<synthetic>": usage({ api_calls: 4 }),
    });
    // 92.209468 * 0.5 + 10.043293 * 1.0 = 56.148…
    assert.equal(cost.cacheRead.toFixed(2), "56.15");
    assert.equal(formatUsd(cost.total), "$84.09");
    assert.ok(cost.cacheRead / cost.total > 0.6, "cache read should dominate");
    // A zero-token bookkeeping entry is not a model and must not appear.
    assert.deepEqual(cost.byModel.map((r) => r.model), ["claude-opus-5", "claude-fable-5"]);
    assert.deepEqual(cost.unpriced, []);
  });

  test("an unknown model is listed, not silently priced", () => {
    const cost = costOfProject({ "gpt-9": usage({ output_tokens: 1_000_000, api_calls: 1 }) });
    assert.equal(cost.total, 0);
    assert.equal(cost.priced, false);
    assert.deepEqual(cost.unpriced, ["gpt-9"]);
  });

  test("formatUsd never shows scientific notation or a bare zero for real spend", () => {
    assert.equal(formatUsd(0), "$0.00");
    assert.equal(formatUsd(0.0004), "<$0.01");
    assert.equal(formatUsd(1.5), "$1.50");
    assert.equal(formatUsd(2345.6), "$2,346");
  });
});

describe("governor breakdown by command family", () => {
  const session = {
    reads: [], writes: [], edit_counts: {}, anatomy_hits: 0, anatomy_misses: 0,
    repeated_reads_warned: 0, stop_count: 0, reminders_sent: {},
    bash_governed: [
      { family: "grep", action: "rewrite", original_tokens: 40_000, entered_tokens: 1_800, at: "" },
      { family: "grep", action: "rewrite", original_tokens: 10_000, entered_tokens: 1_200, at: "" },
      { family: "test", action: "suggest", original_tokens: 8_000, entered_tokens: 8_000, at: "" },
    ],
  } as unknown as SessionData;

  test("summarizeSession keeps per-family totals alongside the scalars", () => {
    const totals = buildSessionTotals(session, [], []);
    const fam = totals.bash_governed_by_family!;
    assert.equal(fam.grep.calls, 2);
    assert.equal(fam.grep.original_tokens, 50_000);
    assert.equal(fam.grep.entered_tokens, 3_000);
    assert.equal(fam.test.calls, 1);
    // A suggest-only family keeps its full output: 0 saved, and that is the
    // point of showing the breakdown at all.
    assert.equal(fam.test.original_tokens - fam.test.entered_tokens, 0);
    // The scalars must still agree with the sum of the parts.
    assert.equal(totals.bash_governed_calls, 3);
    assert.equal(totals.bash_governed_original_tokens, 58_000);
  });

  test("families and models fold across sessions and survive a trim", () => {
    const entry = (id: string): SessionEntry => ({
      id, agent: "claude", started: "", ended: "", reads: [], writes: [],
      totals: buildSessionTotals(session, [], []),
      real_usage: { ...usage({ api_calls: 1 }), per_model: { "claude-opus-5": usage({ cache_read_input_tokens: 1_000, api_calls: 1 }) } },
    } as unknown as SessionEntry);

    const ledger = {
      version: 1, created_at: "", lifetime: { total_sessions: 0 } as any,
      sessions: [entry("a"), entry("b")],
    } as LedgerData;
    recomputeLifetime(ledger);
    assert.equal(ledger.lifetime_maps!.bash_governed_by_family.grep.calls, 4);
    assert.equal(ledger.lifetime_maps!.real_by_model["claude-opus-5"].cache_read_input_tokens, 2_000);

    // Roll one session off into the baseline maps: the lifetime figure must
    // not move. numericFields() strips maps, which is why they are separate.
    const baselineMaps = emptyMaps();
    foldEntryMaps(baselineMaps, ledger.sessions.shift()!);
    ledger.lifetime_baseline_maps = baselineMaps;
    recomputeLifetime(ledger);
    assert.equal(ledger.lifetime_maps!.bash_governed_by_family.grep.calls, 4);
    assert.equal(ledger.lifetime_maps!.real_by_model["claude-opus-5"].cache_read_input_tokens, 2_000);
  });

  test("foldMap ignores malformed buckets instead of producing NaN", () => {
    const target: Record<string, { calls: number }> = {};
    foldMap(target, { a: { calls: 2 } });
    foldMap(target, { a: { calls: "nope" as unknown as number }, b: null as unknown as { calls: number } });
    assert.equal(target.a.calls, 2);
    assert.ok(!("b" in target));
  });
});
