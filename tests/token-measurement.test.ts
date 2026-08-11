import { test, describe } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Workstream F1: real token measurement from harness transcripts.

describe("readTranscriptUsage", () => {
  test("sums usage across messages, deduping streamed lines by message id", async () => {
    const { readTranscriptUsage } = await import("../src/hooks/shared.ts");
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wolf-f1-")), "t.jsonl");
    const lines = [
      { type: "assistant", message: { id: "m1", usage: { input_tokens: 100, output_tokens: 5, cache_read_input_tokens: 800, cache_creation_input_tokens: 20 } } },
      // streamed update for the same message — must replace, not double-count
      { type: "assistant", message: { id: "m1", usage: { input_tokens: 100, output_tokens: 42, cache_read_input_tokens: 800, cache_creation_input_tokens: 20 } } },
      { type: "assistant", message: { id: "m2", usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 } } },
      { type: "user", message: { id: "u1" } },
      "not json at all",
    ];
    fs.writeFileSync(f, lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n"));
    const usage = readTranscriptUsage(f);
    assert.ok(usage);
    assert.strictEqual(usage.input_tokens, 220);
    assert.strictEqual(usage.output_tokens, 72);
    assert.strictEqual(usage.cache_read_input_tokens, 1700);
    assert.strictEqual(usage.cache_creation_input_tokens, 20);
    assert.strictEqual(usage.api_calls, 2);
  });

  test("returns null for missing or usage-free transcripts", async () => {
    const { readTranscriptUsage } = await import("../src/hooks/shared.ts");
    assert.strictEqual(readTranscriptUsage("/nonexistent/path.jsonl"), null);
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wolf-f1-")), "empty.jsonl");
    fs.writeFileSync(f, JSON.stringify({ type: "user", message: {} }) + "\n");
    assert.strictEqual(readTranscriptUsage(f), null);
  });
});
