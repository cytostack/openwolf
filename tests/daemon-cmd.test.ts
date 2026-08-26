import { test } from "node:test";
import * as assert from "node:assert";
import childProcess from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { syncBuiltinESMExports } from "node:module";

test("daemon stop and restart control only the project PM2 registration", async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openwolf-daemon-cmd-"));
  const originalCwd = process.cwd();
  const originalExecFileSync = childProcess.execFileSync;
  const originalKill = process.kill;
  const originalLog = console.log;
  const originalError = console.error;
  const originalExitCode = process.exitCode;
  const probeBin = process.platform === "win32" ? "where" : "which";
  const pm2Bin = process.platform === "win32" ? "pm2.cmd" : "pm2";
  const pm2Name = `openwolf-${path.basename(projectRoot).replace(/[^a-zA-Z0-9._-]/g, "-")}`;

  let calls: Array<[string, string[]]> = [];
  let kills: Array<[number, NodeJS.Signals | number | undefined]> = [];
  let logs: string[] = [];
  let errors: string[] = [];

  const fakeListenerOutput = process.platform === "win32"
    ? "  TCP    127.0.0.1:18791    0.0.0.0:0    LISTENING    4242\n"
    : "4242\n";

  const run = (action: "stop" | "restart", outcome: "unavailable" | "failed" | "success") => {
    calls = [];
    kills = [];
    logs = [];
    errors = [];
    process.exitCode = undefined;

    childProcess.execFileSync = ((command: string, args: readonly string[] = []) => {
      calls.push([command, [...args]]);
      if (command === probeBin) {
        if (outcome === "unavailable") throw new Error("pm2 unavailable");
        return Buffer.alloc(0);
      }
      if (command === pm2Bin && args[0] === action) {
        if (outcome === "failed") throw new Error("child-secret");
        return Buffer.alloc(0);
      }
      if (command === "lsof" || command === "netstat") return fakeListenerOutput;
      if (command === "taskkill") return Buffer.alloc(0);
      throw new Error(`unexpected child process: ${command} ${args.join(" ")}`);
    }) as typeof childProcess.execFileSync;
    syncBuiltinESMExports();

    const handler = action === "stop" ? daemonStop : daemonRestart;
    handler();

    return { calls: [...calls], kills: [...kills], logs: [...logs], errors: [...errors], exitCode: process.exitCode };
  };

  fs.mkdirSync(path.join(projectRoot, ".wolf"));
  process.chdir(projectRoot);
  process.kill = ((pid: number, signal?: NodeJS.Signals | number) => {
    kills.push([pid, signal]);
    return true;
  }) as typeof process.kill;
  console.log = (...args: unknown[]) => logs.push(args.join(" "));
  console.error = (...args: unknown[]) => errors.push(args.join(" "));

  const { daemonStop, daemonRestart } = await import("../dist/src/cli/daemon-cmd.js");

  try {
    const unavailableStop = run("stop", "unavailable");
    assert.equal(unavailableStop.kills.length, 0, "issue #8: stop signaled an unverified port PID");
    assert.deepEqual(unavailableStop.calls, [[probeBin, ["pm2"]]]);
    assert.equal(unavailableStop.exitCode, 1);
    assert.match(unavailableStop.errors.join("\n"), /stop/i);
    assert.match(unavailableStop.errors.join("\n"), /pm2/i);
    assert.match(unavailableStop.errors.join("\n"), /install/i);

    const unavailableRestart = run("restart", "unavailable");
    assert.deepEqual(unavailableRestart.calls, [[probeBin, ["pm2"]]]);
    assert.equal(unavailableRestart.kills.length, 0);
    assert.equal(unavailableRestart.exitCode, 1);
    assert.match(unavailableRestart.errors.join("\n"), /restart/i);
    assert.match(unavailableRestart.errors.join("\n"), /pm2/i);
    assert.match(unavailableRestart.errors.join("\n"), /install/i);

    for (const action of ["stop", "restart"] as const) {
      const failed = run(action, "failed");
      assert.deepEqual(failed.calls, [
        [probeBin, ["pm2"]],
        [pm2Bin, [action, pm2Name]],
      ]);
      assert.equal(failed.kills.length, 0);
      assert.equal(failed.exitCode, 1);
      const error = failed.errors.join("\n");
      assert.match(error, new RegExp(action, "i"));
      assert.match(error, new RegExp(pm2Name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.match(error, /pm2 status/i);
      assert.match(error, /openwolf daemon start/i);
      assert.match(error, /retry/i);
      assert.doesNotMatch(error, /child-secret/);

      const success = run(action, "success");
      assert.deepEqual(success.calls, [
        [probeBin, ["pm2"]],
        [pm2Bin, [action, pm2Name]],
      ]);
      assert.equal(success.kills.length, 0);
      assert.equal(success.exitCode, undefined);
      assert.deepEqual(success.errors, []);
      assert.ok(success.logs.includes(
        action === "stop"
          ? `  ✓ Daemon stopped (PM2): ${pm2Name}`
          : `  ✓ Daemon restarted (PM2): ${pm2Name}`
      ));
    }
  } finally {
    childProcess.execFileSync = originalExecFileSync;
    syncBuiltinESMExports();
    process.kill = originalKill;
    console.log = originalLog;
    console.error = originalError;
    process.exitCode = originalExitCode;
    process.chdir(originalCwd);
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
