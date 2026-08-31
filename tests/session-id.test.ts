import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalSessionId } from "../src/agents/session-id.ts";

test("canonicalSessionId extracts kilo-style nested properties.info.id", () => {
  assert.strictEqual(
    canonicalSessionId({ properties: { info: { id: "kilo-1" } } }),
    "kilo-1"
  );
});

test("canonicalSessionId falls back through properties.sessionID, top-level sessionID, session_id", () => {
  assert.strictEqual(canonicalSessionId({ properties: { sessionID: "p-1" } }), "p-1");
  assert.strictEqual(canonicalSessionId({ sessionID: "t-1" }), "t-1");
  assert.strictEqual(canonicalSessionId({ session_id: "s-1" }), "s-1");
  assert.strictEqual(canonicalSessionId({}), "");
});
