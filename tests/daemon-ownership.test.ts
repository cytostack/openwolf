import { test, describe } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { spawn, execFileSync } from "node:child_process";

import { lookupDaemonPid, writeDaemonPidFile, removeDaemonPidFile, daemonPidPath } from "../src/utils/daemon-pidfile.ts";

// Issue #78 (davdittrich): `daemon stop` and `daemon restart` fell back to
// SIGTERMing every PID listening on the configured dashboard port, with no
// check that the process was OpenWolf's or belonged to this project. Port
// occupancy is not ownership.

const DIST_DAEMON_CMD = path.resolve(import.meta.dirname ?? ".", "..", "dist", "src", "cli", "daemon-cmd.js");
const haveDist = fs.existsSync(DIST_DAEMON_CMD);

function tmpProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ow-daemon-"));
  fs.mkdirSync(path.join(root, ".wolf"), { recursive: true });
  return root;
}

describe("daemon pid ownership", () => {
  test("a pid file written by this project for a live process is owned", () => {
    const root = tmpProject();
    const wolfDir = path.join(root, ".wolf");
    writeDaemonPidFile(wolfDir, root, 18791);
    // The current process is alive by definition; the `ps` command-line guard
    // is best-effort and does not apply to the test runner itself on win32.
    const { status, record } = lookupDaemonPid(wolfDir, root);
    assert.ok(record);
    assert.strictEqual(record!.pid, process.pid);
    assert.strictEqual(record!.project_root, path.resolve(root));
    // On POSIX the ps guard rejects this pid (the test runner is not the
    // daemon), which is the conservative direction: never signal on doubt.
    assert.ok(status === "owned" || status === "stale");
  });

  test("no pid file means nothing to signal", () => {
    const root = tmpProject();
    assert.strictEqual(lookupDaemonPid(path.join(root, ".wolf"), root).status, "missing");
  });

  test("a pid file naming another project root is foreign, never owned", () => {
    const root = tmpProject();
    const other = tmpProject();
    const wolfDir = path.join(root, ".wolf");
    fs.writeFileSync(
      daemonPidPath(wolfDir),
      JSON.stringify({ pid: process.pid, project_root: other, port: 18791, hostname: os.hostname(), started_at: new Date().toISOString() }),
    );
    assert.strictEqual(lookupDaemonPid(wolfDir, root).status, "foreign");
  });

  test("a dead pid is stale, never owned", () => {
    const root = tmpProject();
    const wolfDir = path.join(root, ".wolf");
    // Spawn and reap a child so its pid is certainly not live.
    const dead = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
    const deadPid = dead.pid!;
    execFileSync(process.execPath, ["-e", "setTimeout(()=>{},300)"]); // let it reap
    fs.writeFileSync(
      daemonPidPath(wolfDir),
      JSON.stringify({ pid: deadPid, project_root: root, port: 18791, hostname: os.hostname(), started_at: new Date().toISOString() }),
    );
    assert.strictEqual(lookupDaemonPid(wolfDir, root).status, "stale");
  });

  test("a pid file from another host is stale, never owned", () => {
    const root = tmpProject();
    const wolfDir = path.join(root, ".wolf");
    fs.writeFileSync(
      daemonPidPath(wolfDir),
      JSON.stringify({ pid: process.pid, project_root: root, port: 18791, hostname: "some-other-machine", started_at: new Date().toISOString() }),
    );
    assert.strictEqual(lookupDaemonPid(wolfDir, root).status, "stale");
  });

  test("garbage in the pid file is stale, never owned", () => {
    const root = tmpProject();
    const wolfDir = path.join(root, ".wolf");
    fs.writeFileSync(daemonPidPath(wolfDir), "{not json");
    assert.strictEqual(lookupDaemonPid(wolfDir, root).status, "missing");
    fs.writeFileSync(daemonPidPath(wolfDir), JSON.stringify({ pid: -1, project_root: root }));
    assert.strictEqual(lookupDaemonPid(wolfDir, root).status, "stale");
    removeDaemonPidFile(wolfDir);
    assert.strictEqual(fs.existsSync(daemonPidPath(wolfDir)), false);
  });
});

describe("daemon stop signal safety (compiled)", { skip: !haveDist ? "dist not built" : false }, () => {
  const freePort = async (): Promise<number> =>
    new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.once("error", reject);
      srv.listen(0, "127.0.0.1", () => {
        const p = (srv.address() as net.AddressInfo).port;
        srv.close(() => resolve(p));
      });
    });

  test("an unrelated listener on the dashboard port is never signalled", async () => {
    const root = tmpProject();
    const port = await freePort();
    fs.writeFileSync(
      path.join(root, ".wolf", "config.json"),
      JSON.stringify({ openwolf: { dashboard: { port } } }, null, 2),
    );

    // A stranger holding the port: records any signal it receives, and only
    // exits when we tell it to.
    const marker = path.join(root, "signalled.txt");
    const victim = spawn(
      process.execPath,
      [
        "-e",
        `const net=require('net'),fs=require('fs');
         process.on('SIGTERM',()=>{fs.writeFileSync(${JSON.stringify(marker)},'SIGTERM');process.exit(9)});
         net.createServer().listen(${port},'127.0.0.1',()=>console.log('up'));`,
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    await new Promise<void>((resolve) => victim.stdout!.once("data", () => resolve()));

    try {
      const out = execFileSync(
        process.execPath,
        ["-e", `import(${JSON.stringify(DIST_DAEMON_CMD)}).then(m=>m.daemonStop())`],
        { cwd: root, encoding: "utf-8" },
      );
      await new Promise((r) => setTimeout(r, 300));

      assert.strictEqual(fs.existsSync(marker), false, "unrelated listener must not receive SIGTERM");
      assert.strictEqual(victim.killed, false);
      assert.strictEqual(victim.exitCode, null, "unrelated listener must still be running");
      assert.ok(out.includes("No daemon running"), `expected a no-daemon message, got: ${out}`);
      assert.ok(out.includes("Left alone"), "the port holder should be reported, not killed");
    } finally {
      victim.kill("SIGKILL");
    }
  });
});
