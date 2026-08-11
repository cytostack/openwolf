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

describe("stop reminder bookkeeping", () => {
  test("counts time-only semantic memory rows written during the session", async () => {
    const { countSemanticEntries } = await import("../src/hooks/shared.ts");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-stop-"));
    fs.writeFileSync(
      path.join(root, "memory.md"),
      [
        "| 08:00 | Older semantic summary | src/old.ts | passed | ~10 |",
        "| 17:34 | Session end: 45 writes across 13 files | 38 reads | ~100 tok |",
        "| 17:35 | Implemented truth maintenance | src/hippocampus/ | passed | ~100 |",
      ].join("\n")
    );
    const started = new Date();
    started.setHours(17, 0, 0, 0);
    assert.strictEqual(countSemanticEntries(root, started.toISOString()), 1);
  });

  test("detects a bookkeeping file updated after session start", async () => {
    const { wasFileUpdatedSince } = await import("../src/hooks/shared.ts");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-stop-"));
    const file = path.join(root, "buglog.json");
    const started = new Date(Date.now() - 1000).toISOString();
    fs.writeFileSync(file, "{}\n");
    assert.strictEqual(wasFileUpdatedSince(file, started), true);
    assert.strictEqual(wasFileUpdatedSince(file, new Date(Date.now() + 1000).toISOString()), false);
  });
});
