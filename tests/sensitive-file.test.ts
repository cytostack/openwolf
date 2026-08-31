import { test } from "node:test";
import assert from "node:assert/strict";
import { isSensitiveFile } from "../dist/hooks/hooks/shared.js";

test("isSensitiveFile flags credential-bearing files", () => {
  assert.ok(isSensitiveFile(".env"), ".env");
  assert.ok(isSensitiveFile(".env.local"), ".env.local");
  assert.ok(isSensitiveFile(".npmrc"), ".npmrc");
  assert.ok(isSensitiveFile("credentials.json"), "credentials.json");
  assert.ok(isSensitiveFile("id_rsa"), "id_rsa");
  assert.ok(isSensitiveFile(".pypirc"), ".pypirc");
  assert.ok(isSensitiveFile("kubeconfig"), "kubeconfig");
  assert.ok(isSensitiveFile("server.pem"), ".pem");
});

test("isSensitiveFile allows ordinary source files", () => {
  assert.ok(!isSensitiveFile("foo.ts"), "ts");
  assert.ok(!isSensitiveFile("README.md"), "md");
});
