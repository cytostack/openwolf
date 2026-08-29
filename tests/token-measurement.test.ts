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



describe("hippocampus ledger deltas", () => {
  test("addSessionToLedger accumulates recurrence counters into lifetime", async () => {
    const { addSessionToLedger } = await import("../dist/src/tracker/token-ledger.js");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-ledger-"));
    const wolfDir = path.join(root, ".wolf");
    fs.mkdirSync(wolfDir, { recursive: true });

    addSessionToLedger(wolfDir, {
      id: "s1",
      started: new Date().toISOString(),
      ended: new Date().toISOString(),
      reads: [],
      writes: [],
      totals: {
        input_tokens_estimated: 10,
        output_tokens_estimated: 5,
        reads_count: 1,
        writes_count: 1,
        repeated_reads_blocked: 0,
        anatomy_lookups: 0,
        recurrences: 2,
        negative_writes: 4,
      },
    });
    addSessionToLedger(wolfDir, {
      id: "s2",
      started: new Date().toISOString(),
      ended: new Date().toISOString(),
      reads: [],
      writes: [],
      totals: {
        input_tokens_estimated: 0,
        output_tokens_estimated: 0,
        reads_count: 0,
        writes_count: 0,
        repeated_reads_blocked: 0,
        anatomy_lookups: 0,
        recurrences: 1,
        negative_writes: 1,
      },
    });

    const ledger = JSON.parse(fs.readFileSync(path.join(wolfDir, "token-ledger.json"), "utf-8"));
    assert.strictEqual(ledger.lifetime.recurrences, 3);
    assert.strictEqual(ledger.lifetime.negative_writes, 5);
    assert.strictEqual(ledger.sessions[0].totals.recurrences, 2);
  });

  test("openwolf report shows the last-5 session recurrence trend", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-report-"));
    const wolfDir = path.join(root, ".wolf");
    fs.mkdirSync(wolfDir, { recursive: true });
    const ledger = {
      version: 1,
      lifetime: { recurrences: 3, negative_writes: 6, total_sessions: 3 },
      sessions: [
        { id: "a", ended: "2026-01-01", totals: { recurrences: 2, negative_writes: 2 } },
        { id: "b", ended: "2026-01-02", totals: { recurrences: 1, negative_writes: 2 } },
        { id: "c", ended: "2026-01-03", totals: { recurrences: 0, negative_writes: 2 } },
      ],
    };
    fs.writeFileSync(path.join(wolfDir, "token-ledger.json"), JSON.stringify(ledger), "utf-8");

    const { spawnSync } = await import("node:child_process");
    const cli = path.resolve(import.meta.dirname, "../dist/bin/openwolf.js");
    const result = spawnSync(process.execPath, [cli, "report"], {
      cwd: root,
      encoding: "utf-8",
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /Recurrences \/ negative writes:\s+3 \/ 6/);
    assert.match(result.stdout, /Last 3 sessions:\s+2\/2 \| 1\/2 \| 0\/2/);
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
    const now = new Date();
    now.setHours(18, 0, 0, 0); // fixed clock: injected now must drive the count, not wall clock
    assert.strictEqual(countSemanticEntries(root, started.toISOString(), now), 1);
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
