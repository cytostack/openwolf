import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateTokens } from "../dist/hooks/hooks/shared.js";

test("estimateTokens applies the documented char-per-token ratios", () => {
  const code = "const x = 1;".repeat(10);
  assert.strictEqual(estimateTokens(code, "code"), Math.ceil(code.length / 3.5));
  const prose = "hello world ".repeat(10);
  assert.strictEqual(estimateTokens(prose, "prose"), Math.ceil(prose.length / 4.0));
});

test("estimateTokens is deterministic and monotone", () => {
  const t = "some fixed input text";
  assert.strictEqual(estimateTokens(t, "mixed"), estimateTokens(t, "mixed"));
  assert.ok(estimateTokens(t + " more", "mixed") >= estimateTokens(t, "mixed"));
});
