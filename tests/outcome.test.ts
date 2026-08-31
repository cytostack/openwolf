import { test } from "node:test";
import assert from "node:assert/strict";
import { computeOutcome } from "../benchmarks/outcome.ts";

test("computeOutcome: rate = recurrences / negative_writes", () => {
  const r = computeOutcome({}, { recurrences: 2, negative_writes: 4 });
  assert.strictEqual(r.recurrence_rate, 0.5);
  assert.strictEqual(r.recurrences, 2);
  assert.strictEqual(r.negative_writes, 4);
  assert.strictEqual(r.insufficient_data, false);
});

test("computeOutcome: zero negative writes -> null + insufficient", () => {
  const r = computeOutcome({}, { recurrences: 0, negative_writes: 0 });
  assert.strictEqual(r.recurrence_rate, null);
  assert.strictEqual(r.insufficient_data, true);
});

test("computeOutcome: falls back to lifetime when stats absent", () => {
  const r = computeOutcome({ recurrences: 3, negative_writes: 6 }, {});
  assert.strictEqual(r.recurrence_rate, 0.5);
});
