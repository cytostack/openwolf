import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import cron from "node-cron";
import { readJSON, writeJSON, readText, writeText, appendText } from "../utils/fs-safe.js";
import { scanProject } from "../scanner/anatomy-scanner.js";
import { detectWaste } from "../tracker/waste-detector.js";
import { scanProjectUsage, projectTranscriptDir } from "../tracker/transcript-usage.js";
import { readUsageSequence, attributeCacheRebuilds, type CacheRebuild } from "../tracker/cache-attribution.js";
import { withFileLock } from "../hooks/anatomy-lock.js";
import { loadStore, quickStaleCheck } from "../hooks/anatomy-store.js";
import type { Logger } from "../utils/logger.js";

interface CronAction {
  type: string;
  params?: Record<string, unknown>;
}

interface CronTask {
  id: string;
  name: string;
  schedule: string;
  description: string;
  action: CronAction;
  retry: { max_attempts: number; backoff: string; base_delay_seconds: number };
  failsafe: { on_failure: string; dead_letter?: boolean; alert_after_consecutive_failures?: number };
  enabled: boolean;
}

interface CronManifest {
  version: number;
  tasks: CronTask[];
}

interface ExecutionEntry {
  task_id: string;
  status: "success" | "failed";
  timestamp: string;
  duration_ms: number;
  error?: string;
}

interface CronState {
  last_heartbeat: string | null;
  engine_status: string;
  execution_log: ExecutionEntry[];
  dead_letter_queue: Array<{ task_id: string; error: string; timestamp: string; attempts: number }>;
  upcoming: unknown[];
}

export class CronEngine {
  private wolfDir: string;
  private projectRoot: string;
  private logger: Logger;
  private broadcast: (msg: unknown) => void;
  private scheduledTasks: cron.ScheduledTask[] = [];
  private failureCounts = new Map<string, number>();

  constructor(
    wolfDir: string,
    projectRoot: string,
    logger: Logger,
    broadcast: (msg: unknown) => void
  ) {
    this.wolfDir = wolfDir;
    this.projectRoot = projectRoot;
    this.logger = logger;
    this.broadcast = broadcast;
  }

  start(): void {
    const manifest = this.readManifest();
    for (const task of manifest.tasks) {
      if (!task.enabled) continue;
      if (!cron.validate(task.schedule)) {
        this.logger.warn(`Invalid cron schedule for ${task.id}: ${task.schedule}`);
        continue;
      }
      const scheduled = cron.schedule(task.schedule, () => {
        this.executeTask(task).catch((err) => {
          this.logger.error(`Task ${task.id} failed: ${err}`);
        });
      });
      this.scheduledTasks.push(scheduled);
      this.logger.info(`Scheduled task: ${task.name} (${task.schedule})`);
    }
  }

  stop(): void {
    for (const task of this.scheduledTasks) {
      task.stop();
    }
    this.scheduledTasks = [];
  }

  async runTask(taskId: string): Promise<void> {
    const manifest = this.readManifest();
    const task = manifest.tasks.find((t) => t.id === taskId);
    if (!task) {
      this.logger.warn(`Task not found: ${taskId}`);
      return;
    }
    await this.executeTask(task);
  }

  private readManifest(): CronManifest {
    return readJSON<CronManifest>(
      path.join(this.wolfDir, "cron-manifest.json"),
      { version: 1, tasks: [] }
    );
  }

  private readState(): CronState {
    return readJSON<CronState>(
      path.join(this.wolfDir, "cron-state.json"),
      { last_heartbeat: null, engine_status: "running", execution_log: [], dead_letter_queue: [], upcoming: [] }
    );
  }

  private writeState(state: CronState): void {
    writeJSON(path.join(this.wolfDir, "cron-state.json"), state);
  }

  /**
   * Locked read-modify-write for cron-state.json: the daemon heartbeat and
   * websocket handlers write it concurrently, and unlocked interleaves
   * dropped execution-log / dead-letter entries.
   */
  private mutateState(mutator: (state: CronState) => void): boolean {
    const lockPath = path.join(this.wolfDir, "cron-state.json.lock");
    const done = withFileLock(lockPath, 2000, () => {
      const state = this.readState();
      mutator(state);
      this.writeState(state);
      return true;
    });
    return done !== null;
  }

  private async executeTask(task: CronTask): Promise<void> {
    const startTime = Date.now();
    this.logger.info(`Executing task: ${task.name}`);

    try {
      await this.runAction(task.action);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const duration = Date.now() - startTime;
      const failures = (this.failureCounts.get(task.id) ?? 0) + 1;
      this.failureCounts.set(task.id, failures);

      this.logger.error(`Task ${task.name} failed (attempt ${failures}): ${errorMsg}`);

      if (failures < task.retry.max_attempts) {
        // Retry with backoff
        const delay = this.calculateDelay(task.retry.backoff, task.retry.base_delay_seconds, failures);
        this.logger.info(`Retrying ${task.name} in ${delay}ms`);
        setTimeout(() => {
          this.executeTask(task).catch(() => {});
        }, delay);
      } else {
        // Dead letter or skip
        const persisted = this.mutateState((state) => {
          state.execution_log.push({
            task_id: task.id,
            status: "failed",
            timestamp: new Date().toISOString(),
            duration_ms: duration,
            error: errorMsg,
          });

          if (task.failsafe.dead_letter) {
            state.dead_letter_queue.push({
              task_id: task.id,
              error: errorMsg,
              timestamp: new Date().toISOString(),
              attempts: failures,
            });
          }
        });
        if (!persisted) {
          throw new Error("Cron state lock acquisition timed out while persisting task result");
        }
        this.failureCounts.set(task.id, 0);
      }

      this.broadcast({
        type: "cron_executed",
        task_id: task.id,
        status: "failed",
        duration_ms: duration,
      });
      return;
    }

    const duration = Date.now() - startTime;
    const persisted = this.mutateState((state) => {
      state.execution_log.push({
        task_id: task.id,
        status: "success",
        timestamp: new Date().toISOString(),
        duration_ms: duration,
      });
      // Keep last 100 entries
      if (state.execution_log.length > 100) {
        state.execution_log = state.execution_log.slice(-100);
      }
    });
    if (!persisted) {
      throw new Error("Cron state lock acquisition timed out while persisting task result");
    }

    this.failureCounts.set(task.id, 0);
    this.broadcast({
      type: "cron_executed",
      task_id: task.id,
      status: "success",
      duration_ms: duration,
    });
    this.logger.info(`Task ${task.name} completed in ${duration}ms`);
  }

  private calculateDelay(backoff: string, baseSec: number, attempt: number): number {
    const baseMs = baseSec * 1000;
    switch (backoff) {
      case "exponential":
        return baseMs * Math.pow(2, attempt - 1);
      case "linear":
        return baseMs * attempt;
      default:
        return 0;
    }
  }

  private async runAction(action: CronAction): Promise<void> {
    switch (action.type) {
      case "scan_project": {
        // 2.4 freshness without nagging: scan only when the index is actually
        // stale (stat sweep of indexed files) or git HEAD moved — the blind
        // 6h interval rescanned fresh indexes and still missed fast staleness.
        if (this.anatomyIsFresh()) {
          this.logger.info("anatomy rescan skipped: index matches the tree (stat sweep + git HEAD)");
          break;
        }
        await scanProject(this.wolfDir, this.projectRoot);
        break;
      }

      case "consolidate_memory":
        this.consolidateMemory(action.params?.older_than_days as number ?? 7);
        break;

      case "generate_token_report":
        this.generateTokenReport();
        break;

      // 2.5: OpenWolf makes no model calls of any kind. The old "ai_task"
      // action shelled out to `claude -p`, which is the one thing that made
      // "local file I/O only, no API calls" untrue. Tasks of this type are
      // left in place but refused, so a stale manifest fails loudly instead
      // of silently reaching the network.
      case "ai_task":
        throw new Error(
          "ai_task is no longer supported: OpenWolf makes no model calls. Remove this task from .wolf/cron-manifest.json."
        );

      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
  }

  /** True when the anatomy index still matches the tree (2.4 stale gating). */
  private anatomyIsFresh(): boolean {
    try {
      const store = loadStore(this.wolfDir);
      if (!store || Object.keys(store.files).length === 0) return false;
      // git HEAD moved since the last scan: branch switches/pulls add files
      // the stat sweep cannot see (it only checks indexed paths).
      try {
        const state = readJSON<{ git_head?: string | null }>(path.join(this.wolfDir, "_scan-state.json"), {});
        if (state.git_head) {
          const head = execFileSync("git", ["rev-parse", "HEAD"], {
            cwd: this.projectRoot, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000,
          }).trim();
          if (head && head !== state.git_head) return false;
        }
      } catch {}
      return !quickStaleCheck(store, this.projectRoot).stale;
    } catch {
      return false;
    }
  }

  private consolidateMemory(olderThanDays: number): void {
    const memoryPath = path.join(this.wolfDir, "memory.md");
    const content = readText(memoryPath);
    if (!content) return;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);

    const lines = content.split("\n");
    const result: string[] = [];
    let inOldSession = false;
    let oldSessionLines: string[] = [];
    let currentSessionDate: Date | null = null;

    // Idempotent: a session already reduced to its "> Consolidated session"
    // marker has zero table rows; recounting would rewrite it as "(0 actions)"
    // and destroy the original count on every re-run.
    const flushOldSession = () => {
      if (!inOldSession || oldSessionLines.length === 0) return;
      const existingMarker = oldSessionLines.find((l) => l.startsWith("> Consolidated session"));
      if (existingMarker) {
        result.push(existingMarker);
        result.push("");
        return;
      }
      const actionCount = oldSessionLines.filter((l) => l.startsWith("|") && !l.startsWith("|--") && !l.startsWith("| Time")).length;
      result.push(`> Consolidated session (${actionCount} actions)`);
      result.push("");
    };

    for (const line of lines) {
      const sessionMatch = line.match(/^## Session: (\d{4}-\d{2}-\d{2})/);
      if (sessionMatch) {
        flushOldSession();

        currentSessionDate = new Date(sessionMatch[1]);
        if (currentSessionDate < cutoff) {
          inOldSession = true;
          oldSessionLines = [];
          result.push(line); // Keep the header
        } else {
          inOldSession = false;
          result.push(line);
        }
        continue;
      }

      if (inOldSession) {
        oldSessionLines.push(line);
      } else {
        result.push(line);
      }
    }

    flushOldSession();

    writeText(memoryPath, result.join("\n"));
  }

  private generateTokenReport(): void {
    const flags = detectWaste(this.wolfDir);
    // Ground truth (J1): scan every harness transcript for this project —
    // including subagent sidechains and sessions the Stop hook never saw.
    // Scanned OUTSIDE the lock; only the result assignment happens inside.
    let measured: ReturnType<typeof scanProjectUsage> = null;
    try {
      measured = scanProjectUsage(this.projectRoot);
    } catch {}

    // Cache-invalidation attribution (2.2): name what broke the prompt cache
    // and what it cost, per recent transcript. Nothing else in the ecosystem
    // attributes this, and it is the largest single waste class.
    let cacheRebuilds: { generated_at: string; by_cause: Record<string, { events: number; tokens: number }>; recent: CacheRebuild[] } | null = null;
    try {
      const dir = projectTranscriptDir(this.projectRoot);
      const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
      const byCause: Record<string, { events: number; tokens: number }> = {};
      const recent: CacheRebuild[] = [];
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith(".jsonl")) continue;
        const p = path.join(dir, f);
        try {
          if (fs.statSync(p).mtimeMs < cutoff) continue;
        } catch { continue; }
        const seq = readUsageSequence(p);
        if (!seq) continue;
        const report = attributeCacheRebuilds(seq.calls, seq.compactions);
        for (const r of report.rebuilds) {
          const bucket = byCause[r.cause] ?? (byCause[r.cause] = { events: 0, tokens: 0 });
          bucket.events++;
          bucket.tokens += r.creation_tokens;
          recent.push(r);
        }
      }
      if (recent.length > 0) {
        recent.sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""));
        cacheRebuilds = { generated_at: new Date().toISOString(), by_cause: byCause, recent: recent.slice(0, 8) };
      }
    } catch {}
    const ledgerPath = path.join(this.wolfDir, "token-ledger.json");
    // Same lock the hooks' ledger writer uses: an unlocked rewrite here could
    // clobber a concurrent Stop-hook flush and lose whole sessions.
    withFileLock(ledgerPath + ".lock", 2000, () => {
      const ledger = readJSON<Record<string, unknown>>(ledgerPath, {});
      (ledger as { waste_flags: unknown[] }).waste_flags = flags;
      if (measured) (ledger as { measured_project: unknown }).measured_project = measured;
      if (cacheRebuilds) (ledger as { cache_rebuilds: unknown }).cache_rebuilds = cacheRebuilds;
      (ledger as { optimization_report: { last_generated: string; patterns: unknown[] } }).optimization_report = {
        last_generated: new Date().toISOString(),
        patterns: flags.map((f) => f.pattern),
      };
      writeJSON(ledgerPath, ledger);
    });
  }

}
