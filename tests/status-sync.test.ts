import { test } from "node:test";
import assert from "node:assert/strict";
import { syncActiveSpecToStatusMd } from "../src/specs/status-check.ts";

test("syncActiveSpecToStatusMd appends a block when none exists", () => {
  const out = syncActiveSpecToStatusMd("# STATUS\n\nHand-written progress.\n", "spec-1");
  assert.ok(out.includes("<!-- openwolf:active-spec -->"));
  assert.ok(out.includes("Active spec: spec-1"));
  assert.ok(out.includes("Hand-written progress."), "hand-written text preserved");
});

test("syncActiveSpecToStatusMd updates an existing block without touching prose", () => {
  const before = "# STATUS\n\nNotes.\n\n<!-- openwolf:active-spec -->\nActive spec: old\n<!-- /openwolf:active-spec -->\n\nMore notes.\n";
  const out = syncActiveSpecToStatusMd(before, "new");
  assert.ok(out.includes("Active spec: new"));
  assert.ok(!out.includes("Active spec: old"));
  assert.ok(out.includes("Notes.") && out.includes("More notes."), "prose preserved");
});

test("syncActiveSpecToStatusMd is idempotent", () => {
  const once = syncActiveSpecToStatusMd("x", "s");
  const twice = syncActiveSpecToStatusMd(once, "s");
  assert.strictEqual(twice, once);
});
