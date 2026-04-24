import * as fs from "node:fs";
import * as path from "node:path";
import { findProjectRoot } from "../scanner/project-root.js";
import { readJSON, writeJSON } from "../utils/fs-safe.js";
import { Logger } from "../utils/logger.js";
import { CronEngine } from "../daemon/cron-engine.js";

interface CronTask {
  id: string;
  name: string;
  schedule: string;
  description: string;
  enabled: boolean;
}

interface CronManifest {
  version: number;
  tasks: CronTask[];
}

interface CronState {
  engine_status: string;
  execution_log: Array<{ task_id: string; status: string; timestamp: string }>;
  dead_letter_queue: Array<{ task_id: string; error: string; timestamp: string }>;
}

export function cronList(): void {
  const projectRoot = findProjectRoot();
  const wolfDir = path.join(projectRoot, ".wolf");

  if (!fs.existsSync(wolfDir)) {
    console.log("OpenWolf not initialized. Run: openwolf init");
    return;
  }

  const manifest = readJSON<CronManifest>(path.join(wolfDir, "cron-manifest.json"), {
    version: 1,
    tasks: [],
  });

  const state = readJSON<CronState>(path.join(wolfDir, "cron-state.json"), {
    engine_status: "unknown",
    execution_log: [],
    dead_letter_queue: [],
  });

  console.log("Cron Tasks");
  console.log("==========\n");

  if (manifest.tasks.length === 0) {
    console.log("  No tasks configured.");
    return;
  }

  for (const task of manifest.tasks) {
    const status = task.enabled ? "enabled" : "disabled";
    const lastRun = state.execution_log
      .filter((e) => e.task_id === task.id)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
    const lastRunStr = lastRun ? `${lastRun.status} at ${lastRun.timestamp}` : "never";
    const isDead = state.dead_letter_queue.some((d) => d.task_id === task.id);

    console.log(`  ${task.name} (${task.id})`);
    console.log(`    Schedule: ${task.schedule}`);
    console.log(`    Status: ${status}${isDead ? " [DEAD-LETTERED]" : ""}`);
    console.log(`    Last run: ${lastRunStr}`);
    console.log(`    ${task.description}`);
    console.log("");
  }
}

export async function cronRun(id: string): Promise<void> {
  const projectRoot = findProjectRoot();
  const wolfDir = path.join(projectRoot, ".wolf");

  if (!fs.existsSync(wolfDir)) {
    console.log("OpenWolf not initialized. Run: openwolf init");
    return;
  }

  // Read dashboard port from config
  interface WolfConfig { openwolf: { dashboard: { port: number } } }
  const config = readJSON<WolfConfig>(path.join(wolfDir, "config.json"), {
    openwolf: { dashboard: { port: 18791 } },
  });
  const port = config.openwolf?.dashboard?.port ?? 18791;

  // Try calling the daemon's HTTP endpoint first
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/cron/run/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const body = await res.json() as { status?: string; error?: string };
    if (res.ok) {
      console.log(`Task ${id} triggered via daemon.`);
      return;
    }
    console.log(`Daemon returned error: ${body.error ?? res.statusText}`);
    console.log("Falling back to direct execution...");
  } catch {
    console.log("Daemon not reachable. Running task directly...");
  }

  // Fallback: run the task directly via CronEngine
  const logger = new Logger(path.join(wolfDir, "daemon.log"), "info");
  const engine = new CronEngine(wolfDir, projectRoot, logger, () => {});
  try {
    await engine.runTask(id);
    console.log(`Task ${id} executed successfully.`);
  } catch (err) {
    console.error(`Task ${id} failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

export function cronRetry(id: string): void {
  const projectRoot = findProjectRoot();
  const wolfDir = path.join(projectRoot, ".wolf");

  if (!fs.existsSync(wolfDir)) {
    console.log("OpenWolf not initialized. Run: openwolf init");
    return;
  }

  const statePath = path.join(wolfDir, "cron-state.json");
  const state = readJSON<CronState>(statePath, {
    engine_status: "unknown",
    execution_log: [],
    dead_letter_queue: [],
  });

  const idx = state.dead_letter_queue.findIndex((d) => d.task_id === id);
  if (idx === -1) {
    console.log(`Task ${id} not found in dead letter queue.`);
    return;
  }

  state.dead_letter_queue.splice(idx, 1);
  writeJSON(statePath, state);
  console.log(`Removed ${id} from dead letter queue. It will retry on next schedule.`);
}
