import { test, describe } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { verifyHookDelivery } from "../src/hooks/hook-attachments.ts";
import { readUsageSequence, attributeCacheRebuilds } from "../src/tracker/cache-attribution.ts";
import { positionWeightedCostUsd } from "../src/hooks/ledger-math.ts";

function writeTranscript(lines: unknown[]): string {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wolf-att-")), "t.jsonl");
  fs.writeFileSync(p, lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf-8");
  return p;
}

function hookLine(opts: { hookName: string; command: string; exitCode: number; stdout?: string; stderr?: string; type?: string }) {
  return {
    type: "attachment",
    uuid: "u",
    timestamp: "2026-08-20T10:00:00Z",
    attachment: {
      type: opts.type ?? (opts.exitCode === 0 ? "hook_success" : "hook_non_blocking_error"),
      hookName: opts.hookName,
      hookEvent: opts.hookName.split(":")[0],
      command: opts.command,
      exitCode: opts.exitCode,
      stdout: opts.stdout ?? "",
      stderr: opts.stderr ?? "",
    },
  };
}

describe("verifyHookDelivery", () => {
  test("counts fired/failed/delivered for OpenWolf hooks only", () => {
    const inject = JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "x".repeat(400) } });
    const p = writeTranscript([
      hookLine({ hookName: "SessionStart:startup", command: `node "$CLAUDE_PROJECT_DIR/.wolf/hooks/session-start.js"`, exitCode: 0, stdout: inject }),
      hookLine({ hookName: "PreToolUse:Read", command: `node "$CLAUDE_PROJECT_DIR/.wolf/hooks/pre-read.js"`, exitCode: 0 }),
      hookLine({ hookName: "PostToolUse:Write", command: `node "$CLAUDE_PROJECT_DIR/.wolf/hooks/post-write.js"`, exitCode: 1, stderr: "ERR_MODULE_NOT_FOUND: symbol-extractor.js" }),
      // Somebody else's hook: never counted.
      hookLine({ hookName: "PreToolUse:Bash", command: "node /somewhere/else/guard.js", exitCode: 1 }),
      { type: "assistant", message: { id: "m1", usage: { output_tokens: 5 } } },
    ]);
    const v = verifyHookDelivery(p)!;
    assert.strictEqual(v.hooks_fired, 3);
    assert.strictEqual(v.hooks_failed, 1);
    assert.strictEqual(v.injections_delivered, 1);
    assert.strictEqual(v.injection_tokens_delivered, 100);
    assert.strictEqual(v.per_hook["post-write.js"].failed, 1);
    assert.ok(v.last_failure!.stderr_head.includes("ERR_MODULE_NOT_FOUND"));
  });

  test("returns null when the transcript format has drifted (schema probe)", () => {
    const p = writeTranscript([{ totally: "different" }, { schema: "now" }, { no: "type field" }]);
    assert.strictEqual(verifyHookDelivery(p), null);
    assert.strictEqual(verifyHookDelivery("/nonexistent/path.jsonl"), null);
  });
});

describe("cache attribution", () => {
  const call = (i: number, over: Record<string, unknown> = {}) => ({
    type: "assistant",
    timestamp: `2026-08-20T10:${String(i).padStart(2, "0")}:00Z`,
    requestId: `r${i}`,
    version: "2.1.240",
    message: { id: `m${i}`, model: "claude-fable-5", usage: { input_tokens: 10, output_tokens: 50, cache_read_input_tokens: 400_000, cache_creation_input_tokens: 2_000 }, ...(over.message as object ?? {}) },
    ...over,
  });

  test("attributes a model switch rebuild", () => {
    const p = writeTranscript([
      call(1),
      call(2),
      { ...call(3), message: { id: "m3", model: "claude-opus-5", usage: { input_tokens: 10, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 390_000 } } },
    ]);
    const seq = readUsageSequence(p)!;
    const report = attributeCacheRebuilds(seq.calls, seq.compactions);
    assert.strictEqual(report.rebuilds.length, 1);
    assert.strictEqual(report.rebuilds[0].cause, "model_switch");
    assert.strictEqual(report.total_rebuild_tokens, 390_000);
  });

  test("attributes compaction via the compact_boundary marker", () => {
    const p = writeTranscript([
      call(1),
      { type: "system", subtype: "compact_boundary", timestamp: "2026-08-20T10:01:30Z" },
      { ...call(2), message: { id: "m2", model: "claude-fable-5", usage: { input_tokens: 10, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 200_000 } } },
    ]);
    const seq = readUsageSequence(p)!;
    const report = attributeCacheRebuilds(seq.calls, seq.compactions);
    assert.strictEqual(report.rebuilds[0].cause, "compaction");
  });

  test("attributes cache expiry on a long idle gap, ignores small growth", () => {
    const p = writeTranscript([
      call(1),
      { ...call(2), timestamp: "2026-08-20T12:00:00Z", message: { id: "m2", model: "claude-fable-5", usage: { input_tokens: 10, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 350_000 } } },
      call(3, { timestamp: "2026-08-20T12:01:00Z" }), // normal 2k creation: not a rebuild
    ]);
    const seq = readUsageSequence(p)!;
    const report = attributeCacheRebuilds(seq.calls, seq.compactions);
    assert.strictEqual(report.rebuilds.length, 1);
    assert.strictEqual(report.rebuilds[0].cause, "cache_expired");
  });
});

describe("positionWeightedCostUsd", () => {
  test("matches the audit's arithmetic", () => {
    // 10k tokens at call 500 of 1458 at $0.30/MTok cache read ~= $2.87
    const early = positionWeightedCostUsd(10_000, 500, 1458, 0.30);
    assert.ok(Math.abs(early - 2.874) < 0.01, String(early));
    const late = positionWeightedCostUsd(10_000, 1450, 1458, 0.30);
    assert.ok(late < 0.03 && late > 0.0, String(late));
    assert.strictEqual(positionWeightedCostUsd(10_000, 2000, 1458, 0.30), 0);
  });
});
