import { describe, test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { surveyCommand } from "../dist/src/cli/survey.js";

const tmpProject = () => fs.mkdtempSync(path.join(os.tmpdir(), "wolf-survey-"));

function writeWolf(root: string, files: Record<string, unknown>): void {
  const wolfDir = path.join(root, ".wolf");
  fs.mkdirSync(wolfDir, { recursive: true });
  for (const [rel, data] of Object.entries(files)) {
    const p = path.join(wolfDir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, typeof data === "string" ? data : JSON.stringify(data), "utf-8");
  }
}

describe("surveyCommand", () => {
  test("reads legacy hippocampus stores and derives negative writes from buffer", () => {
    const root = tmpProject();
    writeWolf(root, {
      "hippocampus.json": {
        version: 1, schema_version: 1, project_root: root,
        created_at: new Date().toISOString(), last_updated: new Date().toISOString(),
        buffer: [
          { id: "e1", outcome: { valence: "trauma", intensity: 0.8, reflection: "File edited 3 times" } },
          { id: "e2", outcome: { valence: "trauma", intensity: 0.9, reflection: "File edited 5 times" } },
          { id: "e3", outcome: { valence: "neutral" } },
        ],
        stats: { total_events: 3, trauma_count: 2, penalty_count: 0, neutral_count: 1, reward_count: 0 },
      },
      "token-ledger.json": {
        version: 1, created_at: new Date().toISOString(),
        lifetime: { total_sessions: 4, total_reads: 100, total_writes: 10, repeated_reads_blocked: 40, anatomy_hits: 5, anatomy_misses: 95, total_tokens_estimated: 5000, estimated_savings_vs_bare_cli: 700 },
        sessions: [],
      },
      "buglog.json": { version: 1, bugs: [{ error_message: "x", occurrences: 1 }] },
    });
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
    try {
      surveyCommand([root]);
    } finally {
      console.log = orig;
    }
    const out = logs.join("\n");
    assert.ok(out.includes("0/2"), out);
    assert.ok(out.includes("0.0%"), out);
    assert.ok(out.includes("OUTDATED") || out.includes("no-hooks") || out.includes("legacy") || out.includes("outcome-detectors"), out);
    assert.ok(out.includes("40"), out);
    assert.ok(out.includes("1"), out);
  });

  test("marks repos with no .wolf as not analyzed", () => {
    const root = tmpProject();
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
    try {
      surveyCommand([root]);
    } finally {
      console.log = orig;
    }
    const out = logs.join("\n");
    assert.ok(out.includes("NO .WOLF"), out);
  });
});