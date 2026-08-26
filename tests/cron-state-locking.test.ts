import { after, mock, test } from "node:test";
import * as assert from "node:assert";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { Logger } from "../src/utils/logger.ts";

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "openwolf-cron-state-locking-"));
let compiledRoot = process.env.OPENWOLF_TEST_COMPILED_ROOT;
if (!compiledRoot) {
  compiledRoot = path.join(scratchDir, "compiled");
  let dependencyRoot = path.dirname(fileURLToPath(import.meta.url));
  while (!fs.existsSync(path.join(dependencyRoot, "node_modules", "typescript", "bin", "tsc"))) {
    const parent = path.dirname(dependencyRoot);
    assert.notStrictEqual(parent, dependencyRoot, "installed TypeScript compiler not found");
    dependencyRoot = parent;
  }
  const nodeModulesPath = path.join(dependencyRoot, "node_modules");
  const tscPath = path.join(nodeModulesPath, "typescript", "bin", "tsc");
  fs.writeFileSync(path.join(scratchDir, "package.json"), '{"type":"module"}');
  fs.symlinkSync(nodeModulesPath, path.join(scratchDir, "node_modules"));
  execFileSync(process.execPath, [tscPath, "-p", path.resolve("tsconfig.json"), "--outDir", compiledRoot], {
    env: { ...process.env, NODE_COMPILE_CACHE: path.join(scratchDir, "node-compile-cache") },
  });
}
const { CronEngine } = await import(pathToFileURL(path.join(compiledRoot, "src/daemon/cron-engine.js")).href);
const { cronRetry } = await import(pathToFileURL(path.join(compiledRoot, "src/cli/cron-cmd.js")).href);
const daemonPath = path.join(compiledRoot, "src/daemon/wolf-daemon.js");

after(() => fs.rmSync(scratchDir, { recursive: true, force: true }));

function projectFixture(): { projectRoot: string; wolfDir: string; statePath: string } {
  const projectRoot = fs.mkdtempSync(path.join(scratchDir, "project-"));
  const wolfDir = path.join(projectRoot, ".wolf");
  fs.mkdirSync(wolfDir);
  return { projectRoot, wolfDir, statePath: path.join(wolfDir, "cron-state.json") };
}

function writeTask(wolfDir: string, overrides: Record<string, unknown> = {}): void {
  fs.writeFileSync(path.join(wolfDir, "cron-manifest.json"), JSON.stringify({
    version: 1,
    tasks: [{
      id: "task-1",
      name: "Task One",
      schedule: "0 * * * *",
      description: "test task",
      action: { type: "scan_project" },
      retry: { max_attempts: 2, backoff: "exponential", base_delay_seconds: 3 },
      failsafe: { on_failure: "log", dead_letter: true },
      enabled: true,
      ...overrides,
    }],
  }));
}

function emptyState(): Record<string, unknown> {
  return {
    last_heartbeat: null,
    engine_status: "running",
    execution_log: [],
    dead_letter_queue: [],
    upcoming: [],
  };
}

function loggerCapture(): { logger: Logger; info: string[]; error: string[] } {
  const info: string[] = [];
  const error: string[] = [];
  const logger = {
    debug: () => {},
    info: (message: string) => info.push(message),
    warn: () => {},
    error: (message: string) => error.push(message),
  } as unknown as Logger;
  return { logger, info, error };
}

function captureStateWrites(statePath: string): { count: () => number; restore: () => void } {
  let writes = 0;
  const original = fs.writeFileSync;
  const method = mock.method(fs, "writeFileSync", ((...args: unknown[]) => {
    const target = String(args[0]);
    if (target === statePath || (target.startsWith(statePath + ".") && target.endsWith(".tmp"))) {
      writes++;
    }
    return (original as (...callArgs: unknown[]) => unknown)(...args);
  }) as typeof fs.writeFileSync);
  syncBuiltinESMExports();
  return {
    count: () => writes,
    restore: () => {
      method.mock.restore();
      syncBuiltinESMExports();
    },
  };
}

function writeLiveLock(statePath: string, stateBytes: string): void {
  fs.writeFileSync(statePath, stateBytes);
  fs.writeFileSync(statePath + ".lock", JSON.stringify({
    pid: process.pid,
    hostname: os.hostname(),
    acquiredAt: Date.now(),
  }));
}

async function unusedPort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  server.close();
  await once(server, "close");
  return port;
}

async function startDaemon(projectRoot: string, port: number): Promise<ChildProcess> {
  const logPath = path.join(projectRoot, ".wolf", "daemon.log");
  const readyText = `Dashboard server listening on 127.0.0.1:${port}`;
  fs.writeFileSync(logPath, "");

  let resolveReady: () => void;
  let rejectReady: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const checkLog = () => {
    const lines = fs.readFileSync(logPath, "utf-8").split(/\r?\n/);
    if (lines.some((line) => line.endsWith(readyText))) resolveReady();
  };
  const watcher = fs.watch(logPath, checkLog);
  checkLog();
  const child = spawn(process.execPath, [daemonPath], {
    env: {
      ...process.env,
      OPENWOLF_PROJECT_ROOT: projectRoot,
      OPENWOLF_DASHBOARD_PORT: String(port),
    },
    stdio: "ignore",
  });
  const onExit = (code: number | null) => {
    rejectReady(new Error(`daemon exited ${code} before writing ${readyText}; daemon.log: ${fs.readFileSync(logPath, "utf-8")}`));
  };
  child.once("exit", onExit);
  try {
    await ready;
    return child;
  } finally {
    watcher.close();
    child.off("exit", onExit);
  }
}

function writeDaemonConfig(wolfDir: string, port: number): void {
  fs.writeFileSync(path.join(wolfDir, "config.json"), JSON.stringify({
    openwolf: {
      daemon: { port: 18790, log_level: "info" },
      dashboard: { enabled: true, port, host: "127.0.0.1" },
      cron: { enabled: false, heartbeat_interval_minutes: 30 },
    },
  }));
}

test("runTask fails result persistence contention without retrying a successful action", { timeout: 8_000 }, async () => {
  const { projectRoot, wolfDir, statePath } = projectFixture();
  writeTask(wolfDir, {
    retry: { max_attempts: 2, backoff: "exponential", base_delay_seconds: 0 },
  });
  const ownerBytes = JSON.stringify({ ...emptyState(), last_heartbeat: "engine-owner" }, null, 2);
  writeLiveLock(statePath, ownerBytes);
  const writes = captureStateWrites(statePath);
  const { logger } = loggerCapture();
  const broadcasts: unknown[] = [];
  const engine = new CronEngine(wolfDir, projectRoot, logger, (message) => broadcasts.push(message));
  let actionCalls = 0;
  const action = mock.method(engine as unknown as { runAction: (action: unknown) => Promise<void> }, "runAction", async () => {
    actionCalls++;
  });
  const scheduled: Array<{ callback: TimerHandler; delay: number | undefined }> = [];
  const originalSetTimeout = globalThis.setTimeout;
  let thrown: unknown;
  const timer = mock.method(globalThis, "setTimeout", (function (
    this: typeof globalThis,
    ...args: Parameters<typeof setTimeout>
  ) {
    scheduled.push({ callback: args[0], delay: args[1] });
    return Reflect.apply(originalSetTimeout, this, args);
  }) as typeof setTimeout);
  try {
    try {
      await engine.runTask("task-1");
    } catch (error) {
      thrown = error;
    }
    assert.strictEqual(scheduled.length, 0);
    assert.strictEqual(actionCalls, 1);
  } finally {
    timer.mock.restore();
  }
  try {
    assert.strictEqual(writes.count(), 0, "unlocked engine writer must not run");
    assert.strictEqual(fs.readFileSync(statePath, "utf-8"), ownerBytes);
    assert.deepStrictEqual(broadcasts, []);
    assert.match(String(thrown), /Cron state lock acquisition timed out while persisting task result/);
  } finally {
    action.mock.restore();
    writes.restore();
    if (fs.existsSync(statePath + ".lock")) fs.unlinkSync(statePath + ".lock");
  }
});

  test("cron retry contention preserves concurrent owner state", { timeout: 9_000 }, async () => {
    const { projectRoot, wolfDir, statePath } = projectFixture();
    const ownerBytes = JSON.stringify({
      ...emptyState(),
      last_heartbeat: "cli-owner",
      execution_log: [{ task_id: "other", status: "success", timestamp: "kept" }],
      dead_letter_queue: [
        { task_id: "task-1", error: "target", timestamp: "one" },
        { task_id: "other", error: "keep", timestamp: "two" },
      ],
    }, null, 2);
    writeLiveLock(statePath, ownerBytes);
    const writes = captureStateWrites(statePath);
    const logs: string[] = [];
    const log = mock.method(console, "log", (...args: unknown[]) => { logs.push(args.join(" ")); });
    const cwd = process.cwd();
    let thrown: unknown;
    try {
      process.chdir(projectRoot);
      try {
        cronRetry("task-1");
      } catch (error) {
        thrown = error;
      }
      assert.strictEqual(writes.count(), 0, "unlocked cronRetry writer must not run");
      assert.deepStrictEqual(logs, []);
      assert.strictEqual(fs.readFileSync(statePath, "utf-8"), ownerBytes);
      assert.match(String(thrown), /Cron state lock acquisition timed out while retrying dead-letter task/);
    } finally {
      process.chdir(cwd);
      log.mock.restore();
      writes.restore();
      if (fs.existsSync(statePath + ".lock")) fs.unlinkSync(statePath + ".lock");
    }
  });

  test("daemon shutdown contention preserves concurrent owner state", { timeout: 8_000 }, async () => {
    const { projectRoot, wolfDir, statePath } = projectFixture();
    const port = await unusedPort();
    writeDaemonConfig(wolfDir, port);
    const daemon = await startDaemon(projectRoot, port);
    const daemonExit = once(daemon, "exit");
    try {
      const ownerBytes = JSON.stringify({ ...emptyState(), last_heartbeat: "shutdown-owner" }, null, 2);
      fs.writeFileSync(statePath + ".lock", JSON.stringify({
        pid: process.pid,
        hostname: os.hostname(),
        acquiredAt: Date.now(),
      }), { flag: "wx" });
      fs.writeFileSync(statePath, ownerBytes);
      daemon.kill("SIGTERM");
      const [code, signal] = await daemonExit;
      assert.strictEqual(fs.readFileSync(statePath, "utf-8"), ownerBytes, "shutdown must preserve lock-owner bytes");
      assert.strictEqual(code, 0);
      assert.strictEqual(signal, null);
      assert.ok(fs.existsSync(statePath + ".lock"));
      assert.match(fs.readFileSync(path.join(wolfDir, "daemon.log"), "utf-8"), /Cron state lock acquisition timed out while persisting daemon shutdown state/);
    } finally {
      if (daemon.exitCode === null && daemon.signalCode === null) daemon.kill("SIGTERM");
      if (daemon.exitCode === null) await daemonExit;
      if (fs.existsSync(statePath + ".lock")) fs.unlinkSync(statePath + ".lock");
    }
  });

  test("daemon shutdown records stopped state while holding the available lock", { timeout: 6_000 }, async () => {
    const { projectRoot, wolfDir, statePath } = projectFixture();
    const port = await unusedPort();
    writeDaemonConfig(wolfDir, port);
    const daemon = await startDaemon(projectRoot, port);
    const daemonExit = once(daemon, "exit");
    try {
      daemon.kill("SIGTERM");
      const [code, signal] = await daemonExit;
      assert.strictEqual(code, 0);
      assert.strictEqual(signal, null);
      assert.strictEqual(JSON.parse(fs.readFileSync(statePath, "utf-8")).engine_status, "stopped");
      assert.ok(!fs.existsSync(statePath + ".lock"));
    } finally {
      if (daemon.exitCode === null && daemon.signalCode === null) daemon.kill("SIGTERM");
      if (daemon.exitCode === null) await daemonExit;
    }
  });

  test("lock-available task result and dead-letter retry preserve existing state", async () => {
    const { projectRoot, wolfDir, statePath } = projectFixture();
    writeTask(wolfDir);
    fs.writeFileSync(statePath, JSON.stringify({
      ...emptyState(),
      execution_log: [{ task_id: "other", status: "failed", timestamp: "kept", duration_ms: 1 }],
      dead_letter_queue: [
        { task_id: "task-1", error: "target", timestamp: "one", attempts: 2 },
        { task_id: "other", error: "keep", timestamp: "two", attempts: 3 },
      ],
    }));
    const { logger } = loggerCapture();
    const engine = new CronEngine(wolfDir, projectRoot, logger, () => {});
    let actionCalls = 0;
    const action = mock.method(engine as unknown as { runAction: (action: unknown) => Promise<void> }, "runAction", async () => {
      actionCalls++;
    });
    const cwd = process.cwd();
    const logs: string[] = [];
    const log = mock.method(console, "log", (...args: unknown[]) => { logs.push(args.join(" ")); });
    try {
      await engine.runTask("task-1");
      process.chdir(projectRoot);
      cronRetry("task-1");
      const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
      assert.strictEqual(actionCalls, 1);
      assert.strictEqual(state.execution_log.length, 2);
      assert.strictEqual(state.execution_log[1].status, "success");
      assert.deepStrictEqual(state.dead_letter_queue.map((entry: { task_id: string }) => entry.task_id), ["other"]);
      assert.strictEqual(state.execution_log[0].timestamp, "kept");
      assert.deepStrictEqual(logs, ["Removed task-1 from dead letter queue. It will retry on next schedule."]);
      assert.ok(!fs.existsSync(statePath + ".lock"));
    } finally {
      process.chdir(cwd);
      log.mock.restore();
      action.mock.restore();
    }
  });

  test("cron retry missing task does not write state", () => {
    const { projectRoot, statePath } = projectFixture();
    const bytes = JSON.stringify(emptyState(), null, 2);
    fs.writeFileSync(statePath, bytes);
    const writes = captureStateWrites(statePath);
    const logs: string[] = [];
    const log = mock.method(console, "log", (...args: unknown[]) => { logs.push(args.join(" ")); });
    const cwd = process.cwd();
    try {
      process.chdir(projectRoot);
      cronRetry("missing");
      assert.strictEqual(writes.count(), 0);
      assert.strictEqual(fs.readFileSync(statePath, "utf-8"), bytes);
      assert.deepStrictEqual(logs, ["Task missing not found in dead letter queue."]);
    } finally {
      process.chdir(cwd);
      log.mock.restore();
      writes.restore();
    }
  });

  test("genuine action failure schedules one configured retry", { timeout: 8_000 }, async () => {
    const { projectRoot, wolfDir, statePath } = projectFixture();
    writeTask(wolfDir, {
      retry: { max_attempts: 2, backoff: "exponential", base_delay_seconds: 0 },
    });
    fs.writeFileSync(statePath, JSON.stringify(emptyState()));
    const { logger, error } = loggerCapture();
    const broadcasts: unknown[] = [];
    let resolveSuccess: () => void;
    const success = new Promise<void>((resolve) => { resolveSuccess = resolve; });
    const engine = new CronEngine(wolfDir, projectRoot, logger, (message) => {
      broadcasts.push(message);
      if ((message as { status?: string }).status === "success") resolveSuccess();
    });
    let actionCalls = 0;
    let resolveSecondAction: () => void;
    const secondAction = new Promise<void>((resolve) => { resolveSecondAction = resolve; });
    const action = mock.method(engine as unknown as { runAction: (action: unknown) => Promise<void> }, "runAction", async () => {
      actionCalls++;
      if (actionCalls === 1) throw new Error("action failed");
      resolveSecondAction();
    });
    const scheduled: Array<{ callback: TimerHandler; delay: number | undefined }> = [];
    const originalSetTimeout = globalThis.setTimeout;
    const timer = mock.method(globalThis, "setTimeout", (function (
      this: typeof globalThis,
      ...args: Parameters<typeof setTimeout>
    ) {
      scheduled.push({ callback: args[0], delay: args[1] });
      return Reflect.apply(originalSetTimeout, this, args);
    }) as typeof setTimeout);
    try {
      await engine.runTask("task-1");
      assert.strictEqual(scheduled.length, 1);
      assert.strictEqual(scheduled[0].delay, 0);
    } finally {
      timer.mock.restore();
    }
    try {
      await secondAction;
      await success;
      const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
      assert.strictEqual(actionCalls, 2);
      assert.match(error[0], /failed \(attempt 1\): action failed/);
      assert.deepStrictEqual(broadcasts.map((message) => (message as { status: string }).status), ["failed", "success"]);
      assert.strictEqual(state.execution_log.length, 1);
      assert.strictEqual(state.execution_log[0].status, "success");
    } finally {
      action.mock.restore();
    }
  });
