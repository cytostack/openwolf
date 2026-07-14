import { test } from "node:test";
import * as assert from "node:assert";

import { trackRead, type FileReadEntry } from "../src/hooks/read-tracking.ts";

const firstRead: FileReadEntry = {
  count: 1,
  tokens: 42,
  first_read: "2026-07-15T00:00:00.000Z",
  read_mtime: 1_700_000_000_000,
};

test("starts a new read entry with the current mtime", () => {
  const result = trackRead(undefined, 1_700_000_000_000, "2026-07-15T00:00:00.000Z");

  assert.strictEqual(result.repeated, false);
  assert.deepStrictEqual(result.entry, {
    count: 1,
    tokens: 0,
    first_read: "2026-07-15T00:00:00.000Z",
    read_mtime: 1_700_000_000_000,
  });
});

test("warns and preserves the baseline when the mtime is unchanged", () => {
  const result = trackRead(firstRead, firstRead.read_mtime, "2026-07-15T00:01:00.000Z");

  assert.strictEqual(result.repeated, true);
  assert.deepStrictEqual(result.entry, { ...firstRead, count: 2 });
});

test("starts a fresh baseline when the mtime changed", () => {
  const result = trackRead(firstRead, 1_700_000_100_000, "2026-07-15T00:01:00.000Z");

  assert.strictEqual(result.repeated, false);
  assert.deepStrictEqual(result.entry, {
    count: 1,
    tokens: 0,
    first_read: "2026-07-15T00:01:00.000Z",
    read_mtime: 1_700_000_100_000,
  });
});

test("warns for a legacy entry and records its current mtime", () => {
  const { read_mtime: _readMtime, ...legacyEntry } = firstRead;
  const result = trackRead(legacyEntry, 1_700_000_000_000, "2026-07-15T00:01:00.000Z");

  assert.strictEqual(result.repeated, true);
  assert.deepStrictEqual(result.entry, { ...firstRead, count: 2 });
});

test("warns conservatively when the current mtime is unavailable", () => {
  const result = trackRead(firstRead, undefined, "2026-07-15T00:01:00.000Z");

  assert.strictEqual(result.repeated, true);
  assert.deepStrictEqual(result.entry, { ...firstRead, count: 2 });
});
