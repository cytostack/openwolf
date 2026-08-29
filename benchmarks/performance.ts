import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

export interface PerfOp {
  name: string;
  kind: "pure" | "io";
  iterations: number;
  ops_per_sec: number | null;
  median_ms: number | null;
  p95_ms: number | null;
}

export interface PerformanceResult {
  error?: string;
  ops: PerfOp[];
}

const DIST = path.join(import.meta.dirname, "..", "dist", "hooks", "hippocampus");
const SPEC_DIST = path.join(import.meta.dirname, "..", "dist", "hooks", "specs");

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function measure(
  name: string,
  kind: "pure" | "io",
  iterations: number,
  fn: () => void
): PerfOp {
  const warm = Math.min(iterations, 200);
  for (let i = 0; i < warm; i++) fn();

  const t0 = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const totalMs = performance.now() - t0;
  const opsPerSec = totalMs > 0 ? iterations / (totalMs / 1000) : Infinity;

  const samples = Math.min(200, iterations);
  const durations: number[] = [];
  for (let i = 0; i < samples; i++) {
    const a = performance.now();
    fn();
    durations.push(performance.now() - a);
  }
  durations.sort((x, y) => x - y);

  return {
    name,
    kind,
    iterations,
    ops_per_sec: Number.isFinite(opsPerSec) ? Math.round(opsPerSec) : null,
    median_ms: round3(durations[Math.floor(durations.length / 2)] ?? 0),
    p95_ms: round3(durations[Math.floor(durations.length * 0.95)] ?? 0),
  };
}

function makeEventData(i: number) {
  const timestamp = new Date(Date.now() + i).toISOString();
  return {
    version: 1 as const,
    timestamp,
    session_id: "bench-session",
    context: {
      project_root: "C:/bench",
      files_involved: [`src/f${i}.ts`],
      cwd_at_time: "C:/bench",
      spatial_path: `src/f${i}.ts`,
      spatial_depth: 1,
      session_start: timestamp,
      turn_in_session: i,
    },
    action: { type: "edit", description: "benchmark edit", tokens_spent: 10 },
    outcome: { valence: "neutral", intensity: 0.5, reflection: "bench" },
    source: "manual",
    tags: ["bench"],
  };
}

function makeEvent(i: number) {
  const data = makeEventData(i);
  return {
    ...data,
    id: `evt-bench-${i}`,
    consolidation: {
      stage: "short-term",
      access_count: 0,
      last_accessed: data.timestamp,
      consolidation_score: 0,
      should_consolidate: false,
      decay_factor: 1.0,
      last_decay_check: data.timestamp,
    },
  };
}

export async function collectPerformance(options?: {
  iterations?: number;
}): Promise<PerformanceResult> {
  const micro = options?.iterations ?? 100_000;

  let mods: Record<string, any>;
  try {
    mods = {
      eventStore: await import(pathToFileURL(path.join(DIST, "event-store.js")).href),
      cueIndex: await import(pathToFileURL(path.join(DIST, "cue-index.js")).href),
      consolidation: await import(pathToFileURL(path.join(DIST, "consolidation.js")).href),
      hippocampus: await import(pathToFileURL(path.join(DIST, "index.js")).href),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `dist not built (${msg}); run pnpm build`, ops: [] };
  }

  const { eventStore, cueIndex, consolidation, hippocampus } = mods;
  const events = Array.from({ length: 100 }, (_, i) => makeEvent(i));
  const ev = makeEvent(0);

  const ops: PerfOp[] = [];

  ops.push(
    measure("calculateDecay", "pure", micro, () => {
      consolidation.calculateDecay("2026-01-01T00:00:00.000Z", "neutral", 1.0);
    })
  );

  ops.push(
    measure("calculateConsolidationScore", "pure", micro, () => {
      consolidation.calculateConsolidationScore(ev);
    })
  );

  const buildN = Math.max(100, Math.floor(micro / 20));
  ops.push(
    measure("buildIndex", "pure", buildN, () => {
      cueIndex.buildIndex(events);
    })
  );

  const addN = Math.max(100, Math.floor(micro / 10));
  const store = eventStore.createEmptyStore("C:/bench");
  ops.push(
    measure("addEventToStore", "pure", addN, () => {
      eventStore.addEventToStore(store, ev);
    })
  );

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-perf-"));
  try {
    const h = new hippocampus.Hippocampus(tmp);
    const batch = Array.from({ length: 50 }, (_, i) => makeEventData(i));
    ops.push(
      measure("Hippocampus.addMany", "io", 20, () => {
        h.addMany(batch);
      })
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // SDD spec layer (src/specs): state machine, task parsing, context injection.
  let specMods: Record<string, any>;
  try {
    specMods = {
      types: await import(pathToFileURL(path.join(SPEC_DIST, "types.js")).href),
      phaseMachine: await import(pathToFileURL(path.join(SPEC_DIST, "phase-machine.js")).href),
      tasksParse: await import(pathToFileURL(path.join(SPEC_DIST, "tasks-parse.js")).href),
      inject: await import(pathToFileURL(path.join(SPEC_DIST, "inject.js")).href),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `spec dist not built (${msg}); run pnpm build`, ops };
  }

  const specState = {
    ...specMods.types.createEmptySpecState("2026-01-01T00:00:00.000Z"),
    activeSpec: "001-user-auth",
    currentTask: "T042",
  };
  const tasksMd = "- [x] T001 - done\n- [ ] T002 - next\n".repeat(50);

  ops.push(
    measure("spec.advancePhase", "pure", micro, () => {
      specMods.phaseMachine.advancePhase(specState, "plan");
    })
  );
  ops.push(
    measure("spec.nextTask", "pure", micro, () => {
      specMods.tasksParse.nextTask(tasksMd);
    })
  );
  ops.push(
    measure("spec.buildSpecContext", "pure", micro, () => {
      specMods.inject.buildSpecContext(specState);
    })
  );

  return { ops };
}
