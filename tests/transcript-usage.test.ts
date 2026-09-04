import { test, describe } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { scanProjectUsage, projectTranscriptDir } from "../src/tracker/transcript-usage.ts";

function line(obj: unknown): string {
  return JSON.stringify(obj) + "\n";
}

function usageLine(opts: {
  msgId: string;
  requestId?: string;
  model?: string;
  cwd?: string;
  sidechain?: boolean;
  timestamp?: string;
  in?: number;
  out?: number;
  cacheRead?: number;
  cacheWrite?: number;
}): string {
  return line({
    type: "assistant",
    requestId: opts.requestId,
    cwd: opts.cwd,
    isSidechain: opts.sidechain ?? false,
    timestamp: opts.timestamp,
    message: {
      id: opts.msgId,
      model: opts.model ?? "claude-fable-5",
      usage: {
        input_tokens: opts.in ?? 10,
        output_tokens: opts.out ?? 20,
        cache_read_input_tokens: opts.cacheRead ?? 0,
        cache_creation_input_tokens: opts.cacheWrite ?? 0,
      },
    },
  });
}

const PROJECT = "/Users/someone/work/proj";

function makeDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wolf-tu-"));
}

describe("projectTranscriptDir", () => {
  test("slugs the absolute path with dashes", () => {
    const dir = projectTranscriptDir("/Users/x/Workspace/my_app.v2", "/home/u");
    assert.strictEqual(dir, path.join("/home/u", ".claude", "projects", "-Users-x-Workspace-my-app-v2"));
  });
});

describe("scanProjectUsage", () => {
  test("dedupes by message id + request id globally across files", () => {
    const dir = makeDir();
    // Original session file.
    fs.writeFileSync(path.join(dir, "a.jsonl"),
      usageLine({ msgId: "m1", requestId: "r1", cwd: PROJECT, in: 100, out: 50 }) +
      // Streaming duplicate of the same message: last usage wins, counted once.
      usageLine({ msgId: "m1", requestId: "r1", cwd: PROJECT, in: 100, out: 60 }) +
      usageLine({ msgId: "m2", requestId: "r2", cwd: PROJECT, in: 10, out: 5 }));
    // Resumed session replays m1/r1 into a new file: still counted once.
    fs.writeFileSync(path.join(dir, "b.jsonl"),
      usageLine({ msgId: "m1", requestId: "r1", cwd: PROJECT, in: 100, out: 60 }) +
      // Same message re-sent under a NEW request (retry): counted separately.
      usageLine({ msgId: "m1", requestId: "r9", cwd: PROJECT, in: 100, out: 60 }));

    const usage = scanProjectUsage(PROJECT, dir)!;
    assert.strictEqual(usage.api_calls, 3); // m1:r1, m2:r2, m1:r9
    assert.strictEqual(usage.output_tokens, 60 + 5 + 60);
    assert.strictEqual(usage.input_tokens, 210);
    assert.strictEqual(usage.transcripts, 2);
  });

  test("aggregates per model and tracks the sidechain share", () => {
    const dir = makeDir();
    fs.writeFileSync(path.join(dir, "s.jsonl"),
      usageLine({ msgId: "m1", requestId: "r1", cwd: PROJECT, model: "claude-fable-5", out: 100 }) +
      usageLine({ msgId: "m2", requestId: "r2", cwd: PROJECT, model: "claude-haiku-4-5", out: 30, sidechain: true }) +
      usageLine({ msgId: "m3", requestId: "r3", cwd: PROJECT, model: "claude-haiku-4-5", out: 40, sidechain: true, timestamp: "2026-08-20T10:00:00Z" }));

    const usage = scanProjectUsage(PROJECT, dir)!;
    assert.strictEqual(usage.by_model["claude-fable-5"].output_tokens, 100);
    assert.strictEqual(usage.by_model["claude-haiku-4-5"].output_tokens, 70);
    assert.strictEqual(usage.by_model["claude-haiku-4-5"].api_calls, 2);
    assert.strictEqual(usage.sidechain.output_tokens, 70);
    assert.strictEqual(usage.sidechain.api_calls, 2);
    assert.strictEqual(usage.last_activity, "2026-08-20T10:00:00Z");
  });

  test("skips transcripts whose cwd points at a different project (slug collision)", () => {
    const dir = makeDir();
    fs.writeFileSync(path.join(dir, "mine.jsonl"),
      usageLine({ msgId: "m1", requestId: "r1", cwd: PROJECT, out: 10 }));
    fs.writeFileSync(path.join(dir, "other.jsonl"),
      usageLine({ msgId: "x1", requestId: "q1", cwd: "/Users/someone/work/proj-two", out: 999 }));

    const usage = scanProjectUsage(PROJECT, dir)!;
    assert.strictEqual(usage.output_tokens, 10);
    assert.strictEqual(usage.transcripts, 1);
  });

  test("returns null for a missing or empty directory", () => {
    assert.strictEqual(scanProjectUsage(PROJECT, "/nonexistent/nowhere"), null);
    const dir = makeDir();
    assert.strictEqual(scanProjectUsage(PROJECT, dir), null);
    fs.writeFileSync(path.join(dir, "junk.jsonl"), "not json\n" + line({ type: "user" }));
    assert.strictEqual(scanProjectUsage(PROJECT, dir), null);
  });
});
