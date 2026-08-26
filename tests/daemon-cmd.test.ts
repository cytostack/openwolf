import { test } from "node:test";
import * as assert from "node:assert";
import childProcess from "node:child_process";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { syncBuiltinESMExports } from "node:module";

test("daemon stop and restart control only the project PM2 registration", async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openwolf-daemon-cmd-"));
  const originalCwd = process.cwd();
  const originalExecFileSync = childProcess.execFileSync;
  const originalPlatform = os.platform;
  const originalKill = process.kill;
  const originalLog = console.log;
  const originalError = console.error;
  const originalExitCode = process.exitCode;
  const hadComSpec = Object.hasOwn(process.env, "ComSpec");
  const originalComSpec = process.env.ComSpec;
  const windowsComSpec = "C:\\Windows\\System32\\cmd.exe";
  const pm2Name = `openwolf-${path.basename(projectRoot).replace(/[^a-zA-Z0-9._-]/g, "-")}`;

  let calls: Array<[string, string[]]> = [];
  let kills: Array<[number, NodeJS.Signals | number | undefined]> = [];
  let logs: string[] = [];
  let errors: string[] = [];

  const run = (
    action: "stop" | "restart",
    outcome: "unavailable" | "failed" | "success",
    platform: NodeJS.Platform
  ) => {
    calls = [];
    kills = [];
    logs = [];
    errors = [];
    process.exitCode = undefined;
    os.platform = (() => platform) as typeof os.platform;

    childProcess.execFileSync = ((command: string, args: readonly string[] = []) => {
      calls.push([command, [...args]]);
      const probeBin = platform === "win32" ? "where" : "which";
      if (command === probeBin) {
        if (outcome === "unavailable") throw new Error("pm2 unavailable");
        return Buffer.alloc(0);
      }
      const actionBin = platform === "win32" ? windowsComSpec : "pm2";
      if (command === actionBin) {
        if (outcome === "failed") throw new Error("child-secret");
        return Buffer.alloc(0);
      }
      if (command === "lsof" || command === "netstat") return "4242\n";
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
  process.env.ComSpec = windowsComSpec;

  const { daemonStop, daemonRestart } = await import("../dist/src/cli/daemon-cmd.js");

  try {
    const unavailableStop = run("stop", "unavailable", "linux");
    assert.equal(unavailableStop.kills.length, 0, "issue #8: stop signaled an unverified port PID");
    assert.deepEqual(unavailableStop.calls, [["which", ["pm2"]]]);
    assert.equal(unavailableStop.exitCode, 1);
    assert.match(unavailableStop.errors.join("\n"), /stop/i);
    assert.match(unavailableStop.errors.join("\n"), /pm2/i);
    assert.match(unavailableStop.errors.join("\n"), /install/i);

    const unavailableRestart = run("restart", "unavailable", "linux");
    assert.deepEqual(unavailableRestart.calls, [["which", ["pm2"]]]);
    assert.equal(unavailableRestart.kills.length, 0);
    assert.equal(unavailableRestart.exitCode, 1);
    assert.match(unavailableRestart.errors.join("\n"), /restart/i);
    assert.match(unavailableRestart.errors.join("\n"), /pm2/i);
    assert.match(unavailableRestart.errors.join("\n"), /install/i);

    for (const platform of ["win32", "linux"] as const) {
      for (const action of ["stop", "restart"] as const) {
        const expectedCalls: Array<[string, string[]]> = platform === "win32"
          ? [
              ["where", ["pm2"]],
              [windowsComSpec, ["/d", "/s", "/c", "pm2.cmd", action, pm2Name]],
            ]
          : [
              ["which", ["pm2"]],
              ["pm2", [action, pm2Name]],
            ];
        const failed = run(action, "failed", platform);
        assert.deepEqual(
          failed.calls,
          expectedCalls,
          platform === "win32" && action === "stop"
            ? "issue #8 Windows: stop invoked pm2.cmd directly"
            : undefined
        );
        assert.equal(failed.kills.length, 0);
        assert.equal(failed.exitCode, 1);
        const error = failed.errors.join("\n");
        assert.match(error, new RegExp(action, "i"));
        assert.match(error, new RegExp(pm2Name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        assert.match(error, /pm2 status/i);
        assert.match(error, /openwolf daemon start/i);
        assert.match(error, /retry/i);
        assert.doesNotMatch(error, /child-secret/);

        const success = run(action, "success", platform);
        assert.deepEqual(success.calls, expectedCalls);
        assert.equal(success.kills.length, 0);
        assert.equal(success.exitCode, undefined);
        assert.deepEqual(success.errors, []);
        assert.ok(success.logs.includes(
          action === "stop"
            ? `  ✓ Daemon stopped (PM2): ${pm2Name}`
            : `  ✓ Daemon restarted (PM2): ${pm2Name}`
        ));
      }
    }
  } finally {
    childProcess.execFileSync = originalExecFileSync;
    os.platform = originalPlatform;
    syncBuiltinESMExports();
    process.kill = originalKill;
    console.log = originalLog;
    console.error = originalError;
    process.exitCode = originalExitCode;
    if (hadComSpec) process.env.ComSpec = originalComSpec;
    else delete process.env.ComSpec;
    process.chdir(originalCwd);
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
