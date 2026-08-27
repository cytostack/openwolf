import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import * as http from "node:http";
import * as net from "node:net";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";
import test, { after, mock } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { once } from "node:events";

const require = createRequire(import.meta.url);
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cron-run-not-found-build-"));
const tsc = require.resolve("typescript/bin/tsc");
const nodeModules = (require.resolve.paths("typescript") ?? [])
  .find((candidate) => ["typescript", "express", "node-cron", "ws"].every((pkg) => fs.existsSync(path.join(candidate, pkg))));

assert.ok(nodeModules, "installed project node_modules must contain TypeScript and daemon packages");
execFileSync("namei", [path.dirname(buildRoot), nodeModules], { stdio: "ignore" });
assert.equal(path.relative(os.tmpdir(), buildRoot).startsWith(".."), false);
assert.equal(fs.existsSync(path.join(buildRoot, "node_modules")), false);
fs.symlinkSync(nodeModules, path.join(buildRoot, "node_modules"), "dir");

const compile = spawnSync(process.execPath, [tsc, "--project", path.join(sourceRoot, "tsconfig.json"), "--outDir", buildRoot], {
  cwd: sourceRoot,
  encoding: "utf8",
});
assert.equal(compile.status, 0, compile.stderr || compile.stdout);

const { CronEngine } = await import(pathToFileURL(path.join(buildRoot, "src/daemon/cron-engine.js")).href);
const { Logger } = await import(pathToFileURL(path.join(buildRoot, "src/utils/logger.js")).href);

after(() => fs.rmSync(buildRoot, { recursive: true, force: true }));

const daemonPath = path.join(buildRoot, "src/daemon/wolf-daemon.js");
const cliPath = path.join(buildRoot, "bin/openwolf.js");

async function port(): Promise<number> {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as net.AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

function task(id = "known-task"): object {
  return {
    id, name: "Known task", schedule: "0 0 1 1 *", description: "fixture",
    action: { type: "consolidate_memory" }, retry: { max_attempts: 1, backoff: "linear", base_delay_seconds: 1 },
    failsafe: { on_failure: "skip" }, enabled: true,
  };
}

async function fixture(tasks: object[] = []): Promise<{ root: string; wolf: string; token: string; port: number }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cron-run-not-found-fixture-"));
  const wolf = path.join(root, ".wolf");
  const token = "a".repeat(64);
  const dashboardPort = await port();
  fs.mkdirSync(wolf);
  fs.writeFileSync(path.join(root, "package.json"), "{}");
  fs.writeFileSync(path.join(wolf, "dashboard-token"), `${token}\n`);
  fs.writeFileSync(path.join(wolf, "config.json"), JSON.stringify({ openwolf: {
    daemon: { port: dashboardPort + 1, log_level: "info" },
    dashboard: { enabled: true, port: dashboardPort, host: "127.0.0.1" },
    cron: { enabled: true, heartbeat_interval_minutes: 60 },
  } }));
  fs.writeFileSync(path.join(wolf, "cron-manifest.json"), JSON.stringify({ version: 1, tasks }));
  fs.writeFileSync(path.join(wolf, "cron-state.json"), JSON.stringify({ last_heartbeat: null, engine_status: "stopped", execution_log: [], dead_letter_queue: [], upcoming: [] }));
  return { root, wolf, token, port: dashboardPort };
}

async function startDaemon(f: { root: string; wolf: string; port: number }) {
  const child = spawn(process.execPath, [daemonPath], {
    cwd: f.root,
    env: { ...process.env, OPENWOLF_PROJECT_ROOT: f.root, OPENWOLF_DASHBOARD_PORT: String(f.port) },
    stdio: "ignore",
  });
  const logPath = path.join(f.wolf, "daemon.log");
  const ready = () => fs.existsSync(logPath) && fs.readFileSync(logPath, "utf8").includes("Dashboard server listening");
  try {
    await new Promise<void>((resolve, reject) => {
      let watcher: fs.FSWatcher | undefined;
      const finish = (fn: () => void) => {
        clearTimeout(timeout);
        watcher?.close();
        fn();
      };
      const timeout = setTimeout(() => finish(() => reject(new Error("daemon readiness timeout"))), 5000);
      if (ready()) return finish(resolve);
      watcher = fs.watch(f.wolf, () => {
        if (ready()) finish(resolve);
      });
    });
  } catch (error) {
    if (child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
    throw error;
  }
  return child;
}

async function stop(child: ReturnType<typeof spawn>) {
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  await exited;
}

async function cli(root: string, id: string) {
  const child = spawn(process.execPath, [cliPath, "cron", "run", id], {
    cwd: root, env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "OPENWOLF_PROJECT_ROOT")), stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = ""; let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const [code] = await once(child, "exit") as [number];
  return { code, stdout, stderr };
}

test("unknown cron task rejects before execution", async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cron-run-not-found-fixture-"));
  const wolfDir = path.join(projectRoot, ".wolf");
  const statePath = path.join(wolfDir, "cron-state.json");
  fs.mkdirSync(wolfDir);
  fs.writeFileSync(path.join(wolfDir, "cron-manifest.json"), JSON.stringify({ version: 1, tasks: [] }));

  let broadcasts = 0;
  const engine = new CronEngine(wolfDir, projectRoot, new Logger(path.join(wolfDir, "daemon.log"), "info"), () => {
    broadcasts += 1;
  });
  const runtimeEngine = engine as { executeTask: (task: unknown) => Promise<void> };
  const executeTask = mock.method(runtimeEngine, "executeTask", async () => {});

  try {
    await assert.rejects(
      () => engine.runTask("does-not-exist"),
      (error: unknown) => error instanceof Error && error.name === "CronTaskNotFoundError"
        && (error as Error & { taskId?: string }).taskId === "does-not-exist",
    );
    assert.equal(executeTask.mock.callCount(), 0);
    assert.equal(broadcasts, 0);
    assert.equal(fs.existsSync(statePath), false);
  } finally {
    executeTask.mock.restore();
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("authenticated HTTP and CLI cron boundaries preserve typed failures", async () => {
  const missing = await fixture();
  const daemon = await startDaemon(missing);
  try {
    const authenticated = await fetch(`http://127.0.0.1:${missing.port}/api/cron/run/does-not-exist`, { method: "POST", headers: { Authorization: `Bearer ${missing.token}` } });
    assert.equal(authenticated.status, 404);
    assert.deepEqual(await authenticated.json(), { error: "Task not found", task_id: "does-not-exist" });
    const unauthenticated = await fetch(`http://127.0.0.1:${missing.port}/api/cron/run/does-not-exist`, { method: "POST" });
    assert.equal(unauthenticated.status, 401);
  } finally {
    await stop(daemon);
    fs.rmSync(missing.root, { recursive: true, force: true });
  }

  const controlled = await fixture();
  let requests = 0;
  const server = http.createServer((req, res) => {
    requests += 1;
    assert.equal(req.headers.authorization, `Bearer ${controlled.token}`);
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Task not found", task_id: "does-not-exist" }));
  });
  server.listen(controlled.port, "127.0.0.1");
  await once(server, "listening");
  try {
    const result = await cli(controlled.root, "does-not-exist");
    assert.equal(result.code, 1);
    assert.equal(requests, 1);
    assert.match(result.stdout, /Daemon returned error: Task not found/);
    assert.doesNotMatch(result.stdout, /Falling back|executed successfully|triggered via daemon|not reachable/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(controlled.root, { recursive: true, force: true });
  }

  const direct = await fixture();
  try {
    const result = await cli(direct.root, "does-not-exist");
    assert.equal(result.code, 1);
    assert.match(result.stdout, /Daemon not reachable/);
    assert.match(result.stderr, /Task does-not-exist failed: Task not found/);
    assert.doesNotMatch(result.stdout, /executed successfully|triggered via daemon/);
  } finally {
    fs.rmSync(direct.root, { recursive: true, force: true });
  }
});

test("known cron tasks retain engine, HTTP, and CLI success", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cron-run-not-found-known-"));
  const wolf = path.join(root, ".wolf");
  fs.mkdirSync(wolf);
  fs.writeFileSync(path.join(wolf, "cron-manifest.json"), JSON.stringify({ version: 1, tasks: [task()] }));
  const engine = new CronEngine(wolf, root, new Logger(path.join(wolf, "daemon.log"), "info"), () => {});
  const runtimeEngine = engine as { executeTask: (value: unknown) => Promise<void> };
  const executeTask = mock.method(runtimeEngine, "executeTask", async () => {});
  try {
    await engine.runTask("known-task");
    assert.equal(executeTask.mock.callCount(), 1);
  } finally {
    executeTask.mock.restore();
    fs.rmSync(root, { recursive: true, force: true });
  }

  const daemonFixture = await fixture([task()]);
  const daemon = await startDaemon(daemonFixture);
  try {
    const response = await fetch(`http://127.0.0.1:${daemonFixture.port}/api/cron/run/known-task`, { method: "POST", headers: { Authorization: `Bearer ${daemonFixture.token}` } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok", task_id: "known-task" });
    const daemonResult = await cli(daemonFixture.root, "known-task");
    assert.equal(daemonResult.code, 0);
    assert.match(daemonResult.stdout, /Task known-task triggered via daemon/);
  } finally {
    await stop(daemon);
    fs.rmSync(daemonFixture.root, { recursive: true, force: true });
  }

  const directFixture = await fixture([task()]);
  try {
    const directResult = await cli(directFixture.root, "known-task");
    assert.equal(directResult.code, 0);
    assert.match(directResult.stdout, /Task known-task executed successfully/);
  } finally {
    fs.rmSync(directFixture.root, { recursive: true, force: true });
  }

  const ordinaryFailure = await fixture([task()]);
  const ordinaryDaemon = await startDaemon(ordinaryFailure);
  try {
    fs.unlinkSync(path.join(ordinaryFailure.wolf, "daemon.log"));
    fs.mkdirSync(path.join(ordinaryFailure.wolf, "daemon.log"));
    const response = await fetch(`http://127.0.0.1:${ordinaryFailure.port}/api/cron/run/known-task`, { method: "POST", headers: { Authorization: `Bearer ${ordinaryFailure.token}` } });
    assert.equal(response.status, 500);
  } finally {
    await stop(ordinaryDaemon);
    fs.rmSync(ordinaryFailure.root, { recursive: true, force: true });
  }
});
