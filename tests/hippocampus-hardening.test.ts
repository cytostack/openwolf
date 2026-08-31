import { describe, test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { Hippocampus } from "../dist/hooks/hippocampus/index.js";
import { buildIndex, indexNeedsRebuild, loadIndex } from "../dist/hooks/hippocampus/cue-index.js";
import { loadStore, saveStore } from "../dist/hooks/hippocampus/event-store.js";
import { loadNeocortex } from "../dist/hooks/hippocampus/consolidation.js";
import { withHippocampusLock } from "../dist/hooks/hippocampus/persistence.js";
import type { WolfEvent } from "../src/hippocampus/types.ts";

const tmpProject = () => fs.mkdtempSync(path.join(os.tmpdir(), "wolf-hippo-"));
const hippoUrl = pathToFileURL(path.resolve(import.meta.dirname, "../dist/hooks/hippocampus/index.js")).href;
const hookPath = path.resolve(import.meta.dirname, "../dist/hooks/hooks/post-write.js");

function eventData(
  projectRoot: string,
  file: string,
  overrides: Partial<{
    valence: "reward" | "neutral" | "penalty" | "trauma";
    intensity: number;
    reflection: string;
    timestamp: string;
  }> = {}
): Omit<WolfEvent, "id" | "consolidation"> {
  const now = overrides.timestamp ?? new Date().toISOString();
  return {
    version: 1,
    timestamp: now,
    session_id: "test-session",
    context: {
      project_root: projectRoot,
      files_involved: [file],
      cwd_at_time: projectRoot,
      spatial_path: file.replace(/\/[^/]+$/, ""),
      spatial_depth: file.split("/").length - 1,
      session_start: now,
      turn_in_session: 1,
    },
    action: {
      type: "edit",
      description: `Edited ${file}`,
      tokens_spent: 10,
      files_modified: [file],
      succeeded: true,
    },
    outcome: {
      valence: overrides.valence ?? "neutral",
      intensity: overrides.intensity ?? 0.5,
      reflection: overrides.reflection ?? "test learning",
    },
    source: "manual",
    tags: ["test"],
  };
}

function writerScript(projectRoot: string, index: number): string {
  return `
    const { Hippocampus } = await import(${JSON.stringify(hippoUrl)});
    const root = ${JSON.stringify(projectRoot)};
    new Hippocampus(root).addEvent({
      version: 1,
      timestamp: new Date().toISOString(),
      session_id: "writer-${index}",
      context: {
        project_root: root,
        files_involved: ["src/concurrent-${index}.ts"],
        cwd_at_time: root,
        spatial_path: "src",
        spatial_depth: 1,
        session_start: new Date().toISOString(),
        turn_in_session: 1
      },
      action: { type: "write", description: "writer ${index}", tokens_spent: 1, succeeded: true },
      outcome: { valence: "neutral", intensity: 0.2, reflection: "writer ${index}" },
      source: "manual",
      tags: ["concurrent"]
    });
  `;
}

function writerScriptMany(projectRoot: string, index: number, count: number): string {
  return `
    const { Hippocampus } = await import(${JSON.stringify(hippoUrl)});
    const root = ${JSON.stringify(projectRoot)};
    const h = new Hippocampus(root);
    for (let i = 0; i < ${count}; i++) {
      h.addEvent({
        version: 1,
        timestamp: new Date().toISOString(),
        session_id: "writer-${index}",
        context: {
          project_root: root,
          files_involved: ["src/concurrent-${index}-" + i + ".ts"],
          cwd_at_time: root,
          spatial_path: "src",
          spatial_depth: 1,
          session_start: new Date().toISOString(),
          turn_in_session: i + 1
        },
        action: { type: "write", description: "writer ${index} event " + i, tokens_spent: 1, succeeded: true },
        outcome: { valence: "neutral", intensity: 0.2, reflection: "writer-${index}-" + i },
        source: "manual",
        tags: ["concurrent-many"]
      });
    }
  `;
}

function runChild(script: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
      stdio: "ignore",
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

describe("hippocampus persistence and index consistency", () => {
  test("concurrent writers preserve every event and matching index IDs", async () => {
    const root = tmpProject();
    fs.mkdirSync(path.join(root, ".wolf"), { recursive: true });
    const codes = await Promise.all(
      Array.from({ length: 8 }, (_, index) => runChild(writerScript(root, index)))
    );
    assert.deepStrictEqual(codes, Array(8).fill(0));

    const store = loadStore(path.join(root, ".wolf", "hippocampus.json"));
    const index = loadIndex(path.join(root, ".wolf", "cue-index.json"));
    assert.ok(store && index);
    assert.strictEqual(store!.buffer.length, 8);
    assert.deepStrictEqual(
      new Set(index!.event_ids),
      new Set(store!.buffer.map((event) => event.id))
    );
  });

  test("concurrent writers each adding N events lose none", async () => {
    const root = tmpProject();
    fs.mkdirSync(path.join(root, ".wolf"), { recursive: true });
    const N = 10;
    const W = 8;
    const codes = await Promise.all(
      Array.from({ length: W }, (_, index) => runChild(writerScriptMany(root, index, N)))
    );
    assert.deepStrictEqual(codes, Array(W).fill(0));

    const store = loadStore(path.join(root, ".wolf", "hippocampus.json"));
    const index = loadIndex(path.join(root, ".wolf", "cue-index.json"));
    assert.ok(store && index);
    assert.strictEqual(store!.buffer.length, W * N);
    const ids = store!.buffer.map((event) => event.id);
    assert.strictEqual(new Set(ids).size, W * N, "no duplicate IDs");
    assert.deepStrictEqual(
      new Set(index!.event_ids),
      new Set(ids)
    );
  });

  test("detects missing, extra, partial, and legacy index IDs", () => {
    const root = tmpProject();
    const hippo = new Hippocampus(root);
    const first = hippo.addEvent(eventData(root, "src/a.ts"));
    hippo.addEvent(eventData(root, "src/b.ts", { valence: "trauma" }));
    const events = hippo.getEvents();
    const valid = buildIndex(events);
    assert.strictEqual(indexNeedsRebuild(valid, events), false);

    const missing = structuredClone(valid);
    missing.event_ids = [first.id];
    assert.strictEqual(indexNeedsRebuild(missing, events), true);

    const extra = structuredClone(valid);
    extra.event_ids = [...extra.event_ids!, "evt-stale"];
    assert.strictEqual(indexNeedsRebuild(extra, events), true);

    const partial = structuredClone(valid);
    partial.location_index["src/b.ts"] = [];
    assert.strictEqual(indexNeedsRebuild(partial, events), true);

    const legacy = structuredClone(valid);
    delete legacy.event_ids;
    assert.strictEqual(indexNeedsRebuild(legacy, events), true);
  });



  test("legacy stores without recurrence counters are backfilled on load", () => {
    const root = tmpProject();
    const wolfDir = path.join(root, ".wolf");
    fs.mkdirSync(wolfDir, { recursive: true });
    fs.writeFileSync(
      path.join(wolfDir, "hippocampus.json"),
      JSON.stringify({
        version: 1,
        schema_version: 1,
        project_root: root,
        created_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
        buffer: [],
        stats: {
          total_events: 0,
          reward_count: 0,
          penalty_count: 0,
          trauma_count: 0,
          neutral_count: 0,
          oldest_event: null,
          newest_event: null,
        },
        size_bytes: 0,
        max_size_bytes: 5000000,
        retention_days: 7,
        max_buffer_size: 500,
      }),
      "utf-8"
    );

    const hippo = new Hippocampus(root);
    hippo.addEvent(eventData(root, "src/a.ts", { valence: "trauma", intensity: 0.9 }));

    const stats = hippo.getStats();
    assert.strictEqual(stats.negative_writes, 1);
    assert.strictEqual(stats.recurrences, 0);
    assert.strictEqual(stats.recurrence_rate, 0);

    const persisted = loadStore(path.join(wolfDir, "hippocampus.json"));
    assert.strictEqual(persisted?.stats.negative_writes, 1);
    assert.strictEqual(persisted?.stats.recurrences, 0);
  });
  test("recall repairs a stale persisted index", () => {
    const root = tmpProject();
    const hippo = new Hippocampus(root);
    const event = hippo.addEvent(eventData(root, "src/feature/old.ts", {
      valence: "reward",
      intensity: 0.9,
    }));
    const indexPath = path.join(root, ".wolf", "cue-index.json");
    fs.writeFileSync(indexPath, JSON.stringify(buildIndex([])), "utf-8");

    const recalled = new Hippocampus(root).recall({
      cue: { type: "location", path: "src/feature/new.ts", match_mode: "parent" },
      limit: 5,
    });
    assert.deepStrictEqual(recalled.events.map((item) => item.id), [event.id]);
    assert.deepStrictEqual(loadIndex(indexPath)?.event_ids, [event.id]);
  });

  test("backs up corrupt store and index before recovery", () => {
    const root = tmpProject();
    const wolfDir = path.join(root, ".wolf");
    fs.mkdirSync(wolfDir, { recursive: true });
    fs.writeFileSync(path.join(wolfDir, "hippocampus.json"), "{broken-store", "utf-8");
    fs.writeFileSync(path.join(wolfDir, "cue-index.json"), "{broken-index", "utf-8");

    new Hippocampus(root).addEvent(eventData(root, "src/recovered.ts"));
    const files = fs.readdirSync(wolfDir);
    assert.ok(files.some((file) => /^hippocampus\.corrupt-.*\.json$/.test(file)));
    assert.ok(files.some((file) => /^cue-index\.corrupt-.*\.json$/.test(file)));
    assert.strictEqual(loadStore(path.join(wolfDir, "hippocampus.json"))?.buffer.length, 1);
  });



  test("rejects malformed nested cue-index maps and repairs on recall", () => {
    const root = tmpProject();
    const hippo = new Hippocampus(root);
    const event = hippo.addEvent(eventData(root, "src/malformed.ts"));
    const indexPath = path.join(root, ".wolf", "cue-index.json");
    const malformed = buildIndex(hippo.getEvents()) as unknown as {
      location_index: Record<string, unknown>;
    };
    malformed.location_index["src/malformed.ts"] = null;
    fs.writeFileSync(indexPath, JSON.stringify(malformed), "utf-8");

    assert.strictEqual(loadIndex(indexPath), null);
    const recalled = new Hippocampus(root).recall({
      cue: { type: "location", path: "src/malformed.ts", match_mode: "exact" },
      limit: 5,
    });
    assert.deepStrictEqual(recalled.events.map((item) => item.id), [event.id]);
    assert.strictEqual(
      indexNeedsRebuild(loadIndex(indexPath), hippo.getEvents()),
      false
    );
  });

  test("exact recall shares dot-segment normalization with the cue index", () => {
    const root = tmpProject();
    const hippo = new Hippocampus(root);
    const event = hippo.addEvent(eventData(root, "src/feature/../auth.ts"));
    const recalled = hippo.recall({
      cue: { type: "location", path: "src/auth.ts", match_mode: "exact" },
      limit: 5,
    });
    assert.deepStrictEqual(recalled.events.map((item) => item.id), [event.id]);
  });

  test("eviction removes stale IDs from every cue index", () => {
    const root = tmpProject();
    const hippo = new Hippocampus(root);
    const oldest = hippo.addEvent(eventData(root, "src/oldest.ts", {
      timestamp: "2026-01-01T00:00:00.000Z",
    }));
    hippo.addEvent(eventData(root, "src/newer.ts", {
      timestamp: "2026-01-02T00:00:00.000Z",
    }));

    const storePath = path.join(root, ".wolf", "hippocampus.json");
    const store = loadStore(storePath);
    assert.ok(store);
    store!.max_buffer_size = 2;
    saveStore(storePath, store!);

    hippo.addEvent(eventData(root, "src/newest.ts", {
      timestamp: "2026-01-03T00:00:00.000Z",
    }));

    const persistedStore = loadStore(storePath);
    const index = loadIndex(path.join(root, ".wolf", "cue-index.json"));
    assert.ok(persistedStore && index);
    assert.strictEqual(persistedStore!.buffer.length, 2);
    assert.ok(!persistedStore!.buffer.some((event) => event.id === oldest.id));
    assert.strictEqual(indexNeedsRebuild(index, persistedStore!.buffer), false);
    assert.ok(!index!.event_ids!.includes(oldest.id));
  });

  test("consolidation promotion cap prioritizes existing consolidating events", () => {
    const root = tmpProject();
    const hippo = new Hippocampus(root);
    const existing = hippo.addEvent(eventData(root, "src/existing.ts", {
      valence: "trauma",
      intensity: 1,
    }));
    hippo.consolidate({ maxToPromote: 1 });

    const storePath = path.join(root, ".wolf", "hippocampus.json");
    const store = loadStore(storePath);
    assert.ok(store);
    const existingPersisted = store!.buffer.find((event) => event.id === existing.id);
    assert.ok(existingPersisted);
    existingPersisted!.consolidation.access_count = 3;
    saveStore(storePath, store!);

    const newcomer = hippo.addEvent(eventData(root, "src/newcomer.ts", {
      valence: "trauma",
      intensity: 1,
    }));
    const report = hippo.consolidate({ maxToPromote: 1 });
    const persisted = loadStore(storePath);
    const neocortex = loadNeocortex(path.join(root, ".wolf", "neocortex.json"));
    assert.strictEqual(report.promoted, 1);
    assert.ok(neocortex?.events.some((event) => event.id === existing.id));
    assert.strictEqual(
      persisted?.buffer.find((event) => event.id === newcomer.id)?.consolidation.stage,
      "short-term"
    );
  });

  test("replays a pending long-term transfer before the next event write", () => {
    const root = tmpProject();
    const hippo = new Hippocampus(root);
    const event = hippo.addEvent(eventData(root, "src/pending.ts", {
      valence: "trauma",
      intensity: 1,
    }));
    const wolfDir = path.join(root, ".wolf");
    const storePath = path.join(wolfDir, "hippocampus.json");
    const store = loadStore(storePath);
    assert.ok(store);
    const pending = structuredClone(store!.buffer.find((item) => item.id === event.id)!);
    pending.consolidation.stage = "long-term";
    fs.writeFileSync(
      path.join(wolfDir, "hippocampus-transfer.json"),
      JSON.stringify({
        version: 1,
        created_at: new Date().toISOString(),
        events: [pending],
      }),
      "utf-8"
    );

    new Hippocampus(root).addEvent(eventData(root, "src/after-recovery.ts"));
    const recoveredStore = loadStore(storePath);
    const neocortex = loadNeocortex(path.join(wolfDir, "neocortex.json"));
    assert.ok(!recoveredStore?.buffer.some((item) => item.id === event.id));
    assert.ok(neocortex?.events.some((item) => item.id === event.id));
    assert.strictEqual(
      fs.existsSync(path.join(wolfDir, "hippocampus-transfer.json")),
      false
    );
  });


  test("abandoned hippocampus lock directory times out safely", () => {
    const root = tmpProject();
    const wolfDir = path.join(root, ".wolf");
    const lockDir = path.join(wolfDir, "hippocampus.lock");
    fs.mkdirSync(lockDir, { recursive: true });
    fs.writeFileSync(
      path.join(lockDir, "owner.json"),
      JSON.stringify({ pid: 2147483647, acquired_at: Date.now() }),
      "utf-8"
    );

    const result = withHippocampusLock(wolfDir, 100, () => "acquired");
    assert.strictEqual(result, null);
    fs.rmSync(lockDir, { recursive: true });
  });


  test("persists a long-term transfer hidden beyond the 100-result report cap", () => {
    const root = tmpProject();
    const wolfDir = path.join(root, ".wolf");
    fs.mkdirSync(wolfDir, { recursive: true });
    const now = new Date().toISOString();
    const store = loadStore(path.join(wolfDir, "hippocampus.json")) ?? {
      version: 1 as const,
      schema_version: 1 as const,
      project_root: root,
      created_at: now,
      last_updated: now,
      buffer: [],
      stats: {
        total_events: 0,
        reward_count: 0,
        penalty_count: 0,
        trauma_count: 0,
        neutral_count: 0,
        oldest_event: null,
        newest_event: null,
      },
      size_bytes: 0,
      max_size_bytes: 5_000_000,
      retention_days: 7,
      max_buffer_size: 500,
    };
    store.buffer = Array.from({ length: 101 }, (_, index) => ({
      ...eventData(root, `src/result-${index}.ts`, {
        valence: index === 100 ? "trauma" : "neutral",
        intensity: index === 100 ? 1 : 0.5,
        timestamp: now,
      }),
      id: `evt-result-${index}`,
      consolidation: {
        stage: "consolidating" as const,
        access_count: index === 100 ? 3 : 0,
        last_accessed: now,
        consolidation_score: 0,
        should_consolidate: true,
        decay_factor: 1,
        last_decay_check: now,
      },
    }));
    store.stats.total_events = store.buffer.length;
    store.stats.trauma_count = 1;
    store.stats.neutral_count = 100;
    saveStore(path.join(wolfDir, "hippocampus.json"), store);

    const report = new Hippocampus(root).consolidate({ maxToPromote: 101 });
    const persisted = loadStore(path.join(wolfDir, "hippocampus.json"));
    const neocortex = loadNeocortex(path.join(wolfDir, "neocortex.json"));

    assert.strictEqual(report.results.length, 100);
    assert.deepStrictEqual(report.transferred_event_ids, ["evt-result-100"]);
    assert.ok(!persisted?.buffer.some((event) => event.id === "evt-result-100"));
    assert.ok(neocortex?.events.some((event) => event.id === "evt-result-100"));
    assert.strictEqual(fs.existsSync(path.join(wolfDir, "hippocampus-transfer.json")), false);
  });

  test("invalid transfer journals preserve the source event", () => {
    const root = tmpProject();
    const hippo = new Hippocampus(root);
    const event = hippo.addEvent(eventData(root, "src/invalid-journal.ts", {
      valence: "trauma",
      intensity: 1,
    }));
    const wolfDir = path.join(root, ".wolf");
    const journalPath = path.join(wolfDir, "hippocampus-transfer.json");
    fs.writeFileSync(
      journalPath,
      JSON.stringify({
        version: 1,
        created_at: new Date().toISOString(),
        events: [{ id: event.id }],
      }),
      "utf-8"
    );

    assert.throws(
      () => new Hippocampus(root).addEvent(eventData(root, "src/blocked.ts")),
      /Invalid hippocampus transfer journal/
    );
    assert.ok(loadStore(path.join(wolfDir, "hippocampus.json"))?.buffer.some(
      (item) => item.id === event.id
    ));
    assert.ok(!loadNeocortex(path.join(wolfDir, "neocortex.json"))?.events.some(
      (item) => item.id === event.id
    ));
    assert.strictEqual(fs.existsSync(journalPath), true);
  });

  test("consolidation persists neocortex metadata without transfers", () => {
    const root = tmpProject();
    const hippo = new Hippocampus(root);
    const before = hippo.getNeocortexStats().last_consolidation;
    const report = hippo.consolidate();
    const neocortex = loadNeocortex(path.join(root, ".wolf", "neocortex.json"));

    assert.strictEqual(report.events_processed, 0);
    assert.strictEqual(before, null);
    assert.ok(neocortex?.stats.last_consolidation);
  });

  test("enforces neocortex size after merging current-pass transfers", () => {
    const root = tmpProject();
    const wolfDir = path.join(root, ".wolf");
    const hippo = new Hippocampus(root);
    const event = hippo.addEvent(eventData(root, "src/size-cap.ts", {
      valence: "trauma",
      intensity: 1,
    }));
    hippo.consolidate();

    const storePath = path.join(wolfDir, "hippocampus.json");
    const store = loadStore(storePath);
    assert.ok(store);
    const persisted = store!.buffer.find((item) => item.id === event.id);
    assert.ok(persisted);
    persisted!.consolidation.access_count = 3;
    saveStore(storePath, store!);

    const neocortexPath = path.join(wolfDir, "neocortex.json");
    const neocortex = loadNeocortex(neocortexPath);
    assert.ok(neocortex);
    neocortex!.max_size_bytes = 1;
    fs.writeFileSync(neocortexPath, JSON.stringify(neocortex), "utf-8");

    const report = hippo.consolidate();
    const capped = loadNeocortex(neocortexPath);
    assert.ok(capped);
    assert.ok(capped!.size_bytes <= capped!.max_size_bytes || capped!.events.length === 0);
    assert.strictEqual(report.new_neocortex_size, capped!.size_bytes);
  });

  test("consolidation moves an event and persists a refreshed cue index", () => {
    const root = tmpProject();
    const hippo = new Hippocampus(root);
    const event = hippo.addEvent(eventData(root, "src/promote.ts", {
      valence: "trauma",
      intensity: 1,
    }));
    const firstReport = hippo.consolidate();
    const storePath = path.join(root, ".wolf", "hippocampus.json");
    const consolidatingStore = loadStore(storePath);
    assert.ok(consolidatingStore);
    consolidatingStore!.buffer[0].consolidation.access_count = 3;
    saveStore(storePath, consolidatingStore!);
    const secondReport = hippo.consolidate();

    const store = loadStore(storePath);
    const index = loadIndex(path.join(root, ".wolf", "cue-index.json"));
    const neocortex = loadNeocortex(path.join(root, ".wolf", "neocortex.json"));
    assert.ok(store && index && neocortex);
    assert.ok(firstReport.promoted >= 1);
    assert.ok(secondReport.promoted >= 1);
    assert.ok(!store!.buffer.some((item) => item.id === event.id));
    assert.ok(neocortex!.events.some((item) => item.id === event.id));
    assert.strictEqual(indexNeedsRebuild(index, store!.buffer), false);
    assert.deepStrictEqual(new Set(index!.event_ids), new Set(store!.buffer.map((item) => item.id)));
  });
});

describe("hippocampus recall and hook integration", () => {
  test("parent recall accepts Windows-style cue paths", () => {
    const root = tmpProject();
    const hippo = new Hippocampus(root);
    const event = hippo.addEvent(eventData(root, "src/feature/old.ts"));
    const recalled = hippo.recall({
      cue: { type: "location", path: "src\\feature\\new.ts", match_mode: "parent" },
      limit: 5,
    });
    assert.deepStrictEqual(recalled.events.map((item) => item.id), [event.id]);
  });

  test("state recall excludes events without a state match", () => {
    const root = tmpProject();
    const hippo = new Hippocampus(root);
    const matching = hippo.addEvent({
      ...eventData(root, "src/error.ts", { intensity: 0.8 }),
      action: {
        type: "edit",
        description: "Failed edit",
        tokens_spent: 10,
        files_modified: ["src/error.ts"],
        succeeded: false,
        error_message: "TypeError: Cannot read property",
      },
    });
    hippo.addEvent(eventData(root, "src/unrelated.ts", { intensity: 1 }));

    const recalled = hippo.recall({
      cue: {
        type: "state",
        turn_count: 1,
        error: {
          type: "TypeError",
          message: "TypeError: Different details",
          file: "src\\error.ts",
        },
      },
      limit: 5,
    });

    assert.deepStrictEqual(recalled.events.map((item) => item.id), [matching.id]);
  });

  test("post-write ignores files outside the project", () => {
    const root = tmpProject();
    const wolfDir = path.join(root, ".wolf");
    const hooksDir = path.join(wolfDir, "hooks");
    const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-external-"));
    const target = path.join(externalRoot, "external.ts");
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(target, "export const external = true;\n", "utf-8");
    fs.writeFileSync(path.join(wolfDir, "memory.md"), "# Memory\n", "utf-8");
    fs.writeFileSync(
      path.join(hooksDir, "_session.json"),
      JSON.stringify({ files_written: [], edit_counts: {} }),
      "utf-8"
    );

    const result = spawnSync(process.execPath, [hookPath], {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root, CLAUDE_SESSION_ID: "outside-test" },
      input: JSON.stringify({
        tool_name: "Write",
        tool_input: { file_path: target, content: "export const external = true;\n" },
      }),
      encoding: "utf-8",
    });

    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(fs.existsSync(path.join(wolfDir, "hippocampus.json")), false);
    assert.strictEqual(fs.readFileSync(path.join(wolfDir, "memory.md"), "utf-8"), "# Memory\n");
    const session = JSON.parse(fs.readFileSync(path.join(hooksDir, "_session.json"), "utf-8"));
    assert.deepStrictEqual(session.files_written, []);
  });



  test("addEvent counts negative writes; recordRecurrence bumps the durable counter", () => {
    const root = tmpProject();
    const hippo = new Hippocampus(root);
    hippo.addEvent(eventData(root, "src/ok.ts"));
    hippo.addEvent(eventData(root, "src/fail.ts", { valence: "penalty", intensity: 0.8 }));
    hippo.addEvent(eventData(root, "src/fail2.ts", { valence: "trauma", intensity: 0.9 }));

    let stats = hippo.getStats();
    assert.strictEqual(stats.negative_writes, 2);
    assert.strictEqual(stats.recurrences, 0);
    assert.strictEqual(stats.recurrence_rate, 0);

    hippo.recordRecurrence();
    hippo.recordRecurrence();
    stats = hippo.getStats();
    assert.strictEqual(stats.recurrences, 2);
    assert.strictEqual(stats.recurrence_rate, 1);

    const persisted = loadStore(path.join(root, ".wolf", "hippocampus.json"));
    assert.strictEqual(persisted?.stats.recurrences, 2);
    assert.strictEqual(persisted?.stats.negative_writes, 2);
  });

  test("post-write records a recurrence when a fix-shaped edit matches a past trauma", () => {
    const root = tmpProject();
    const wolfDir = path.join(root, ".wolf");
    const hooksDir = path.join(wolfDir, "hooks");
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.mkdirSync(hooksDir, { recursive: true });
    const target = path.join(root, "src", "fix.ts");
    fs.writeFileSync(target, "export const value = 1;", "utf-8");
    fs.writeFileSync(path.join(wolfDir, "memory.md"), "", "utf-8");
    fs.writeFileSync(
      path.join(hooksDir, "_session.json"),
      JSON.stringify({ files_written: [], edit_counts: { "src/fix.ts": 3 } }),
      "utf-8"
    );
    new Hippocampus(root).addEvent(eventData(root, "src/fix.ts", {
      valence: "trauma",
      intensity: 0.9,
      reflection: "cfg.tts does not exist; use cfg.talk",
    }));

    const result = spawnSync(process.execPath, [hookPath], {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root, CLAUDE_SESSION_ID: "recurrence-test" },
      input: JSON.stringify({
        tool_name: "Edit",
        tool_input: {
          file_path: target,
          old_string: "const cfg = { tts: 1 };",
          new_string: "const cfg = { talk: 1 };",
        },
      }),
      encoding: "utf-8",
    });
    assert.strictEqual(result.status, 0, result.stderr);
    const persisted = loadStore(path.join(wolfDir, "hippocampus.json"));
    assert.ok(persisted);
    assert.strictEqual(persisted!.stats.recurrences, 1);
    // The fix-shaped edit is neutral; only the seeded trauma counts as negative.
    assert.strictEqual(persisted!.stats.negative_writes, 1);
  });
  test("post-write surfaces a seeded past learning", () => {
    const root = tmpProject();
    const wolfDir = path.join(root, ".wolf");
    const hooksDir = path.join(wolfDir, "hooks");
    fs.mkdirSync(path.join(root, "src", "feature"), { recursive: true });
    fs.mkdirSync(hooksDir, { recursive: true });
    const target = path.join(root, "src", "feature", "new.ts");
    fs.writeFileSync(target, "export const value = 2;\n", "utf-8");
    fs.writeFileSync(path.join(wolfDir, "memory.md"), "", "utf-8");
    fs.writeFileSync(
      path.join(hooksDir, "_session.json"),
      JSON.stringify({ files_written: [], edit_counts: { "src/feature/new.ts": 1 } }),
      "utf-8"
    );
    new Hippocampus(root).addEvent(eventData(root, "src/feature/old.ts", {
      valence: "reward",
      intensity: 0.9,
      reflection: "Reuse the stable parser from the earlier fix.",
    }));

    const result = spawnSync(process.execPath, [hookPath], {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root, CLAUDE_SESSION_ID: "hook-test" },
      input: JSON.stringify({
        tool_name: "Edit",
        tool_input: {
          file_path: target,
          old_string: "value = 1",
          new_string: "value = 2",
        },
      }),
      encoding: "utf-8",
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stderr, /Related past learnings/);
    assert.match(result.stderr, /Reuse the stable parser/);
  });
});
