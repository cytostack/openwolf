import { test } from "node:test";
import assert from "node:assert/strict";
import { HOOK_FILES } from "../dist/src/cli/copy-hooks.js";

test("HOOK_FILES is the single source of truth (13 hooks incl. user-prompt + post-test)", () => {
  assert.strictEqual(HOOK_FILES.length, 13);
  assert.ok(HOOK_FILES.includes("user-prompt.js"), "user-prompt.js must be shipped");
  assert.ok(HOOK_FILES.includes("post-test.js"), "post-test.js must be shipped");
});
