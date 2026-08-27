import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { pathToFileURL } from "node:url";
import { test, mock } from "node:test";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import type { Logger } from "../src/utils/logger.ts";

const captureKey = "__openwolfFileWatcherCapture";
const require = createRequire(import.meta.url);
const mutableFs = require("node:fs") as typeof fs;

type WatchCapture = {
  root: string;
  options: { ignored: unknown };
  callbacks: Map<string, (filePath: string) => void>;
};

test("filters session watcher files before daemon callbacks", async (t) => {
  const compiledRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openwolf-watcher-compiled-"));
  const wolfDir = fs.mkdtempSync(path.join(os.tmpdir(), "openwolf-watcher-"));
  t.after(() => {
    delete (globalThis as Record<string, unknown>)[captureKey];
    fs.rmSync(wolfDir, { recursive: true, force: true });
    fs.rmSync(compiledRoot, { recursive: true, force: true });
  });

  const heartbeatPath = path.join(wolfDir, "hooks", "_heartbeat.json");
  const statusPath = path.join(wolfDir, "STATUS.md");
  fs.mkdirSync(path.dirname(heartbeatPath), { recursive: true });
  fs.writeFileSync(heartbeatPath, '{"alive":true}');
  fs.writeFileSync(statusPath, "# status\n");

  const source = fs.readFileSync(new URL("../src/daemon/file-watcher.ts", import.meta.url), "utf8");
  const compiledWatcherPath = path.join(compiledRoot, "src", "daemon", "file-watcher.js");
  fs.mkdirSync(path.dirname(compiledWatcherPath), { recursive: true });
  fs.mkdirSync(path.join(compiledRoot, "src", "utils"), { recursive: true });
  fs.writeFileSync(path.join(compiledRoot, "package.json"), JSON.stringify({ type: "module" }));
  fs.writeFileSync(path.join(compiledRoot, "src", "utils", "fs-safe.js"), "export function readJSON() {}\n");
  fs.writeFileSync(compiledWatcherPath, transpileModule(source, {
    compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
  }).outputText);

  const chokidarDir = path.join(compiledRoot, "node_modules", "chokidar");
  fs.mkdirSync(chokidarDir, { recursive: true });
  fs.writeFileSync(
    path.join(chokidarDir, "package.json"),
    JSON.stringify({ type: "module", exports: "./index.js" })
  );
  fs.writeFileSync(
    path.join(chokidarDir, "index.js"),
    `export function watch(root, options) {
      const callbacks = new Map();
      globalThis.${captureKey} = { root, options, callbacks };
      return { on(event, callback) { callbacks.set(event, callback); return this; } };
    }\n`
  );

  const realStatSync = mutableFs.statSync;
  const realReadFileSync = mutableFs.readFileSync;
  let statCalls = 0;
  let readCalls = 0;
  const statMock = mock.method(mutableFs, "statSync", function (...args: Parameters<typeof fs.statSync>) {
    statCalls++;
    return Reflect.apply(realStatSync, mutableFs, args);
  });
  const readMock = mock.method(mutableFs, "readFileSync", function (...args: Parameters<typeof fs.readFileSync>) {
    readCalls++;
    return Reflect.apply(realReadFileSync, mutableFs, args);
  });
  syncBuiltinESMExports();
  t.after(() => {
    statMock.mock.restore();
    readMock.mock.restore();
    syncBuiltinESMExports();
  });

  const watcherModule = await import(pathToFileURL(compiledWatcherPath).href);
  let debugCalls = 0;
  const broadcasts: unknown[] = [];
  const logger = {
    debug: () => { debugCalls++; },
    info: () => {},
    warn: () => {},
    error: () => {},
  } as unknown as Logger;

  watcherModule.startFileWatcher(wolfDir, logger, (message) => broadcasts.push(message));

  const capture = (globalThis as Record<string, unknown>)[captureKey] as WatchCapture | undefined;
  assert.ok(capture, "watch must capture its registration");
  assert.equal(capture.root, wolfDir);
  assert.equal(typeof capture.options.ignored, "function", "ignored option must be a Chokidar v4 predicate");
  const ignored = capture.options.ignored as (candidatePath: string) => boolean;

  const callbackCalls = { add: 0, change: 0, unlink: 0 };
  const dispatch = (event: keyof typeof callbackCalls, relativePath: string) => {
    const filePath = path.join(wolfDir, relativePath);
    if (ignored(filePath)) return;
    callbackCalls[event]++;
    capture.callbacks.get(event)?.(filePath);
  };

  assert.equal(ignored(path.join(wolfDir, "hooks", "sessions")), true);
  assert.equal(ignored(path.join(wolfDir, "hooks", "sessions", "direct.json")), true);
  assert.equal(ignored(path.join(wolfDir, "hooks", "sessions", "one", "two.json")), true);
  assert.equal(ignored(path.join(wolfDir, "hooks", "_session.json")), true);
  assert.equal(ignored(path.join(wolfDir, "hooks", "nested.tmp")), true);
  assert.equal(ignored(path.join(wolfDir, "daemon.log")), true);
  assert.equal(ignored(path.join(wolfDir, "hooks", "_heartbeat.json")), false);
  assert.equal(ignored(path.join(wolfDir, "STATUS.md")), false);

  statCalls = 0;
  readCalls = 0;

  for (const relativePath of ["hooks/sessions/direct.json", "hooks/sessions/nested/value.json"]) {
    dispatch("add", relativePath);
    dispatch("change", relativePath);
    dispatch("unlink", relativePath);
  }
  dispatch("add", "hooks/_session.json");
  dispatch("change", "hooks/_session.json");
  dispatch("unlink", "hooks/_session.json");
  assert.deepEqual(callbackCalls, { add: 0, change: 0, unlink: 0 });
  assert.equal(debugCalls, 0);
  assert.equal(statCalls, 0);
  assert.equal(readCalls, 0);
  assert.deepEqual(broadcasts, []);

  dispatch("change", "hooks/_heartbeat.json");
  assert.equal(callbackCalls.change, 1);
  assert.equal(debugCalls, 1);
  assert.equal(statCalls, 1);
  assert.equal(readCalls, 1);
  const heartbeatBroadcast = broadcasts[0] as Record<string, unknown>;
  assert.deepEqual({
    type: heartbeatBroadcast.type,
    file: heartbeatBroadcast.file,
    content: heartbeatBroadcast.content,
  }, {
    type: "file_changed",
    file: "hooks/_heartbeat.json",
    content: '{"alive":true}',
  });

  dispatch("change", "STATUS.md");
  assert.equal(callbackCalls.change, 2);
  assert.equal(debugCalls, 2);
  assert.equal(statCalls, 2);
  assert.equal(readCalls, 2);
  const statusBroadcast = broadcasts[1] as Record<string, unknown>;
  assert.deepEqual({
    type: statusBroadcast.type,
    file: statusBroadcast.file,
    content: statusBroadcast.content,
  }, {
    type: "file_changed",
    file: "STATUS.md",
    content: "# status\n",
  });
});
