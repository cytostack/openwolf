import { test, describe } from "node:test";
import * as assert from "node:assert";

import {
  emptyLedger,
  recomputeLifetime,
  migrateLegacyBlockedCounts,
  buildSessionTotals,
  type LedgerData,
  type SessionEntry,
  type SessionData,
} from "../src/hooks/ledger-math.ts";

function sessionEntry(id: string, totals: Partial<SessionEntry["totals"]>): SessionEntry {
  return {
    id,
    agent: "claude",
    started: "2026-08-01T00:00:00.000Z",
    ended: "2026-08-01T01:00:00.000Z",
    reads: [],
    writes: [],
    totals: {
      input_tokens_estimated: 0,
      output_tokens_estimated: 0,
      reads_count: 0,
      writes_count: 0,
      repeated_reads_blocked: 0,
      anatomy_lookups: 0,
      ...totals,
    },
  };
}

describe("migrateLegacyBlockedCounts", () => {
  test("relabels legacy warn-counts stored in repeated_reads_blocked", () => {
    const ledger: LedgerData = emptyLedger();
    // Legacy sessions: blocked > 0 but no savings (impossible under 2.0.5+
    // semantics, where every denial credits the denied read's tokens).
    ledger.sessions = [
      sessionEntry("s1", { repeated_reads_blocked: 34 }),
      sessionEntry("s2", { repeated_reads_blocked: 8, savings_estimated: 0 }),
      sessionEntry("s3", { repeated_reads_blocked: 0 }),
    ];

    const migrated = migrateLegacyBlockedCounts(ledger);
    recomputeLifetime(ledger);

    assert.strictEqual(migrated, 2);
    assert.strictEqual(ledger.lifetime.repeated_reads_warned, 42);
    assert.strictEqual(ledger.lifetime.repeated_reads_blocked, 0);
    assert.strictEqual(ledger.lifetime.estimated_savings_vs_bare_cli, 0);
  });

  test("leaves genuine post-2.0.5 denials untouched", () => {
    const ledger: LedgerData = emptyLedger();
    ledger.sessions = [
      sessionEntry("s1", { repeated_reads_blocked: 3, savings_estimated: 1200, repeated_reads_warned: 5 }),
    ];

    const migrated = migrateLegacyBlockedCounts(ledger);
    recomputeLifetime(ledger);

    assert.strictEqual(migrated, 0);
    assert.strictEqual(ledger.lifetime.repeated_reads_blocked, 3);
    assert.strictEqual(ledger.lifetime.repeated_reads_warned, 5);
    assert.strictEqual(ledger.lifetime.estimated_savings_vs_bare_cli, 1200);
  });

  test("migrates a legacy lifetime_baseline too", () => {
    const ledger: LedgerData = emptyLedger();
    ledger.lifetime_baseline = { repeated_reads_blocked: 11, total_reads: 100 };

    const migrated = migrateLegacyBlockedCounts(ledger);
    recomputeLifetime(ledger);

    assert.strictEqual(migrated, 1);
    assert.strictEqual(ledger.lifetime.repeated_reads_warned, 11);
    assert.strictEqual(ledger.lifetime.repeated_reads_blocked, 0);
    assert.strictEqual(ledger.lifetime.total_reads, 100);
  });

  test("is idempotent across re-runs", () => {
    const ledger: LedgerData = emptyLedger();
    ledger.sessions = [sessionEntry("s1", { repeated_reads_blocked: 7 })];

    assert.strictEqual(migrateLegacyBlockedCounts(ledger), 1);
    assert.strictEqual(migrateLegacyBlockedCounts(ledger), 0);
    recomputeLifetime(ledger);
    assert.strictEqual(ledger.lifetime.repeated_reads_warned, 7);
  });
});

describe("buildSessionTotals warn/deny split", () => {
  test("records warnings and denials in separate totals fields", () => {
    const session: SessionData = {
      session_id: "s-now",
      started: "2026-08-19T00:00:00.000Z",
      files_read: {},
      files_written: [],
      edit_counts: {},
      anatomy_hits: 0,
      anatomy_misses: 0,
      repeated_reads_warned: 4,
      reads_denied: 2,
      denied_tokens_saved: 900,
      stop_count: 1,
      reminders_sent: {},
    };

    const totals = buildSessionTotals(session, [], []);
    assert.strictEqual(totals.repeated_reads_warned, 4);
    assert.strictEqual(totals.repeated_reads_blocked, 2);
    assert.strictEqual(totals.savings_estimated, 900);
  });
});
