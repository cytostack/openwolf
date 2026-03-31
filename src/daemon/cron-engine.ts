import * as fs from "node:fs";
import * as path from "node:path";
import cron from "node-cron";
import { readJSON, writeJSON, readText, writeText } from "../utils/fs-safe.js";
import { scanProject } from "../scanner/anatomy-scanner.js";
import { detectWaste } from "../tracker/waste-detector.js";
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
    const defaults: CronState = { last_heartbeat: null, engine_status: "running", execution_log: [], dead_letter_queue: [], upcoming: [] };
    const stored = readJSON<Partial<CronState>>(path.join(this.wolfDir, "cron-state.json"), {});
    return { ...defaults, ...stored };
  }

  private writeState(state: CronState): void {
    writeJSON(path.join(this.wolfDir, "cron-state.json"), state);
  }

  private async executeTask(task: CronTask): Promise<void> {
    const startTime = Date.now();
    this.logger.info(`Executing task: ${task.name}`);

    try {
      await this.runAction(task.action);
      const duration = Date.now() - startTime;

      // Log success
      const state = this.readState();
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
      this.writeState(state);

      this.failureCounts.set(task.id, 0);
      this.broadcast({
        type: "cron_executed",
        task_id: task.id,
        status: "success",
        duration_ms: duration,
      });
      this.logger.info(`Task ${task.name} completed in ${duration}ms`);
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
        const state = this.readState();
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

        this.writeState(state);
        this.failureCounts.set(task.id, 0);
        // Notify UI that this task has permanently failed
        this.broadcast({
          type: "task_error",
          task_id: task.id,
          error: errorMsg,
        });
      }

      this.broadcast({
        type: "cron_executed",
        task_id: task.id,
        status: "failed",
        duration_ms: duration,
      });
    }
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
      case "scan_project":
        scanProject(this.wolfDir, this.projectRoot);
        break;

      case "consolidate_memory":
        this.consolidateMemory(action.params?.older_than_days as number ?? 7);
        break;

      case "generate_token_report":
        this.generateTokenReport();
        break;

      case "ai_task":
        await this.runAiTask(action.params as { prompt: string; context_files: string[] });
        break;

      default:
        throw new Error(`Unknown action type: ${action.type}`);
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

    for (const line of lines) {
      const sessionMatch = line.match(/^## Session: (\d{4}-\d{2}-\d{2})/);
      if (sessionMatch) {
        // Flush previous old session
        if (inOldSession && oldSessionLines.length > 0) {
          const actionCount = oldSessionLines.filter((l) => l.startsWith("|") && !l.startsWith("|--") && !l.startsWith("| Time")).length;
          result.push(`> Consolidated session (${actionCount} actions)`);
          result.push("");
        }

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

    // Flush last old session
    if (inOldSession && oldSessionLines.length > 0) {
      const actionCount = oldSessionLines.filter((l) => l.startsWith("|") && !l.startsWith("|--") && !l.startsWith("| Time")).length;
      result.push(`> Consolidated session (${actionCount} actions)`);
      result.push("");
    }

    writeText(memoryPath, result.join("\n"));
  }

  private generateTokenReport(): void {
    const flags = detectWaste(this.wolfDir);
    const ledgerPath = path.join(this.wolfDir, "token-ledger.json");
    const ledger = readJSON<Record<string, unknown>>(ledgerPath, {});
    (ledger as { waste_flags: unknown[] }).waste_flags = flags;
    (ledger as { optimization_report: { last_generated: string; patterns: unknown[] } }).optimization_report = {
      last_generated: new Date().toISOString(),
      patterns: flags.map((f) => f.pattern),
    };
    writeJSON(ledgerPath, ledger);
  }

  private async runAiTask(params: { prompt: string; context_files: string[] }): Promise<void> {
    // Cap each context file at 20KB (tail = most recent content)
    const MAX_CONTEXT_BYTES = 20 * 1024;
    const contextParts: string[] = [];
    for (const file of params.context_files) {
      const filePath = path.join(this.projectRoot, file);
      try {
        let content = fs.readFileSync(filePath, "utf-8");
        if (Buffer.byteLength(content, "utf-8") > MAX_CONTEXT_BYTES) {
          content = "...[truncated — showing most recent]\n" + content.slice(-MAX_CONTEXT_BYTES);
        }
        contextParts.push(`--- ${file} ---\n${content}`);
      } catch {
        contextParts.push(`--- ${file} --- (not found)`);
      }
    }

    const fullPrompt = `${params.prompt}\n\n---\nContext:\n${contextParts.join("\n\n")}`;
    let result: string;

    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. AI tasks require a direct API key when running as a background daemon.\n" +
        "Add this to your shell profile (~/.zshrc or ~/.zprofile):\n" +
        "  export ANTHROPIC_API_KEY=sk-ant-api03-..."
      );
    }
    result = await this.runViaApi(fullPrompt, process.env.ANTHROPIC_API_KEY);

    // Strip markdown code fences if present
    const fenceMatch = result.match(/```[\w]*\n([\s\S]*?)\n```/s);
    if (fenceMatch) result = fenceMatch[1].trim();

    // Write result to suggestions.json if it looks like JSON
    try {
      const parsed = JSON.parse(result);
      writeJSON(path.join(this.wolfDir, "suggestions.json"), {
        generated_at: new Date().toISOString(),
        ...parsed,
      });
    } catch {
      // Cerebrum update (plain markdown)
      if (result.includes("## User Preferences") || result.includes("## Key Learnings") || result.includes("# Cerebrum")) {
        writeText(path.join(this.wolfDir, "cerebrum.md"), result);
      }
    }
  }

  private async runViaApi(prompt: string, apiKey: string): Promise<string> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${body.slice(0, 200)}`);
    }
    const data = await response.json() as { content: Array<{ type: string; text: string }> };
    return data.content.find((b) => b.type === "text")?.text?.trim() ?? "";
  }

}
