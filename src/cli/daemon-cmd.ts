import { execFileSync, execSync, fork } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { findProjectRoot } from "../scanner/project-root.js";
import { readJSON } from "../utils/fs-safe.js";
import { isWindows } from "../utils/platform.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getDashboardPort(): number {
  const projectRoot = findProjectRoot();
  const wolfDir = path.join(projectRoot, ".wolf");
  const config = readJSON<{ openwolf: { dashboard: { port: number } } }>(
    path.join(wolfDir, "config.json"),
    { openwolf: { dashboard: { port: 18791 } } }
  );
  const port = Number(config.openwolf.dashboard.port);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : 18791;
}

function getPm2Name(): string {
  const projectRoot = findProjectRoot();
  return `openwolf-${path.basename(projectRoot).replace(/[^a-zA-Z0-9._-]/g, "-")}`;
}

function pm2Bin(): string {
  return isWindows() ? "pm2.cmd" : "pm2";
}

function hasPm2(): boolean {
  try {
    execFileSync(isWindows() ? "where" : "which", ["pm2"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function findPidOnPort(port: number): number | null {
  try {
    if (isWindows()) {
      const output = execFileSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf-8" });
      for (const line of output.split("\n")) {
        if (line.includes(`:${port}`) && line.includes("LISTENING")) {
          const parts = line.trim().split(/\s+/);
          const pid = parseInt(parts[parts.length - 1], 10);
          if (pid > 0) return pid;
        }
      }
    } else {
      const output = execFileSync("lsof", ["-ti", `:${port}`], { encoding: "utf-8" });
      const pid = parseInt(output.trim(), 10);
      if (pid > 0) return pid;
    }
  } catch {}
  return null;
}

function killPid(pid: number): boolean {
  try {
    if (isWindows()) {
      execFileSync("taskkill", ["/PID", String(pid), "/F"], { stdio: "ignore" });
    } else {
      process.kill(pid, "SIGTERM");
    }
    return true;
  } catch {
    return false;
  }
}

export function daemonStart(): void {
  const projectRoot = findProjectRoot();
  const wolfDir = path.join(projectRoot, ".wolf");

  if (!fs.existsSync(wolfDir)) {
    console.log("OpenWolf not initialized. Run: openwolf init");
    return;
  }

  const name = getPm2Name();
  // Resolve daemon script relative to openwolf's install dir, not the target project
  const daemonScript = path.resolve(__dirname, "..", "daemon", "wolf-daemon.js");

  // If the daemon is already running (port in use), say so instead of forking
  // a second instance that dies with EADDRINUSE behind an opaque catch.
  const existingPid = findPidOnPort(getDashboardPort());
  if (existingPid !== null) {
    console.log(`\n  Daemon already running (pid ${existingPid}) on port ${getDashboardPort()}.`);
    console.log("  Use: openwolf daemon restart   If you need to reload it.");
    return;
  }

  if (!hasPm2()) {
    // No pm2: fork a detached daemon so cron/consolidation/heartbeat still run.
    const child = fork(daemonScript, [], {
      cwd: projectRoot,
      env: { ...process.env, OPENWOLF_PROJECT_ROOT: projectRoot },
      execArgv: [],
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    console.log(`\n  ✓ Daemon started (detached, no pm2): ${name}`);
    console.log("  Tip: Install pm2 (pnpm add -g pm2) for boot persistence and auto-restart.");
    return;
  }

  try {
    execFileSync(pm2Bin(), ["start", daemonScript, "--name", name, "--cwd", projectRoot], {
      stdio: "inherit",
      env: { ...process.env, OPENWOLF_PROJECT_ROOT: projectRoot },
    });
    execFileSync(pm2Bin(), ["save"], { stdio: "ignore" });
    console.log(`\n  ✓ Daemon started: ${name}`);
    if (isWindows()) {
      console.log("  Tip: Run 'pm2-windows-startup' for boot persistence.");
    }
  } catch {
    console.error("Failed to start daemon.");
  }
}

export function daemonStop(): void {
  const projectRoot = findProjectRoot();
  const wolfDir = path.join(projectRoot, ".wolf");

  if (!fs.existsSync(wolfDir)) {
    console.log("OpenWolf not initialized. Run: openwolf init");
    return;
  }

  // First try PM2
  if (hasPm2()) {
    const name = getPm2Name();
    try {
      execFileSync(pm2Bin(), ["stop", name], { stdio: "ignore" });
      console.log(`  ✓ Daemon stopped (PM2): ${name}`);
      return;
    } catch {
      // PM2 process not found — fall through to port-based stop
    }
  }

  // Fall back to killing whatever is listening on the dashboard port
  const port = getDashboardPort();
  const pid = findPidOnPort(port);
  if (pid) {
    if (killPid(pid)) {
      console.log(`  ✓ Daemon stopped (PID ${pid} on port ${port})`);
    } else {
      console.error(`  Failed to kill process ${pid} on port ${port}.`);
    }
  } else {
    console.log(`  No daemon running on port ${port}.`);
  }
}

export function daemonRestart(): void {
  const projectRoot = findProjectRoot();
  const wolfDir = path.join(projectRoot, ".wolf");

  if (!fs.existsSync(wolfDir)) {
    console.log("OpenWolf not initialized. Run: openwolf init");
    return;
  }

  // First try PM2
  if (hasPm2()) {
    const name = getPm2Name();
    try {
      execFileSync(pm2Bin(), ["restart", name], { stdio: "ignore" });
      console.log(`  ✓ Daemon restarted (PM2): ${name}`);
      return;
    } catch {
      // PM2 process not found — fall through
    }
  }

  // Fall back: stop then start via dashboard command flow
  const port = getDashboardPort();
  const pid = findPidOnPort(port);
  if (pid) {
    killPid(pid);
    console.log(`  Stopped old daemon (PID ${pid}).`);
  }
  console.log("  Use 'openwolf dashboard' to start a new daemon.");
}

export function daemonLogs(): void {
  const projectRoot = findProjectRoot();
  const wolfDir = path.join(projectRoot, ".wolf");

  if (!fs.existsSync(wolfDir)) {
    console.log("OpenWolf not initialized. Run: openwolf init");
    return;
  }

  if (!hasPm2()) {
    console.log("pm2 not found.");
    return;
  }

  const name = getPm2Name();
  try {
    execFileSync(pm2Bin(), ["logs", name, "--lines", "50", "--nostream"], { stdio: "inherit" });
  } catch {
    console.error("Failed to get daemon logs.");
  }
}
