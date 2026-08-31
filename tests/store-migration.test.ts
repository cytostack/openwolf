import { test } from "node:test";
import assert from "node:assert/strict";
import { createEmptyStore, migrateStore } from "../dist/hooks/hippocampus/event-store.js";

test("migrateStore strips retired is_recurring/first_event_id and bumps to v2", () => {
  const store = createEmptyStore("C:/bench");
  store.schema_version = 1;
  store.buffer.push({
    id: "evt-legacy",
    outcome: {
      valence: "neutral",
      intensity: 0.5,
      reflection: "x",
      is_recurring: true,
      first_event_id: "evt-x",
    },
  } as any);

  const migrated = migrateStore(store);
  assert.strictEqual(migrated.schema_version, 2);
  const outcome = migrated.buffer[0].outcome as Record<string, unknown>;
  assert.ok(!("is_recurring" in outcome), "is_recurring stripped");
  assert.ok(!("first_event_id" in outcome), "first_event_id stripped");
});

test("migrateStore is idempotent at current version", () => {
  const store = createEmptyStore("C:/bench");
  store.buffer.push({ id: "e", outcome: { valence: "neutral" } } as any);
  migrateStore(store);
  migrateStore(store);
  assert.strictEqual(store.schema_version, 2);
});
