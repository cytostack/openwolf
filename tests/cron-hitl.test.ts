import { test } from "node:test";
import assert from "node:assert/strict";
import { CronEngine } from "../dist/src/daemon/cron-engine.js";
import { Logger } from "../dist/src/utils/logger.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

test("ai_task with human_gate is recorded as pending, not executed", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-cron-"));
  const wolfDir = path.join(root, ".wolf");
  fs.mkdirSync(wolfDir, { recursive: true });
  fs.writeFileSync(
    path.join(wolfDir, "cron-manifest.json"),
    JSON.stringify({
      version: 1,
      tasks: [
        {
          id: "t1",
          name: "gated",
          schedule: "0 0 * * *",
          description: "x",
          action: {
            type: "ai_task",
            params: { prompt: "x", context_files: [], human_gate: ["write outside project"] },
          },
          retry: { max_attempts: 1, backoff: "linear", base_delay_seconds: 1 },
          failsafe: { on_failure: "skip" },
          enabled: true,
        },
      ],
    })
  );

  const logger = new Logger(path.join(wolfDir, "daemon.log"), "info");
  const engine = new CronEngine(wolfDir, root, logger, () => {});
  await engine.runTask("t1");

  const state = JSON.parse(fs.readFileSync(path.join(wolfDir, "cron-state.json"), "utf-8"));
  const pending = state.execution_log.find((e: { status: string }) => e.status === "pending");
  assert.ok(pending, "pending entry recorded");
  assert.ok(pending.error.includes("human approval"), pending.error);
});
