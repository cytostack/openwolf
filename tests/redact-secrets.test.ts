import { test } from "node:test";
import assert from "node:assert/strict";
import { redactSecrets } from "../dist/hooks/hooks/shared.js";

test("redactSecrets strips API keys, PATs, and PEM blocks", () => {
  assert.strictEqual(redactSecrets("key is sk-abcdefghijklmnop"), "key is [redacted]");
  assert.strictEqual(redactSecrets("token ghp_123456789012345678901234567890123456"), "token [redacted]");
  assert.strictEqual(
    redactSecrets("-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----"),
    "[redacted]"
  );
});

test("redactSecrets leaves ordinary text untouched", () => {
  assert.strictEqual(redactSecrets("edited src/foo.ts"), "edited src/foo.ts");
});
