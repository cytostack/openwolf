import { execFileSync, execSync } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { findProjectRoot } from "../scanner/project-root.js";
import { readJSON } from "../utils/fs-safe.js";
import { isWindows } from "../utils/platform.js";
import { lookupDaemonPid, removeDaemonPidFile } from "../utils/daemon-pidfile.js";

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

export function hasPm2(): boolean {
  try {
    execFileSync(isWindows() ? "where" : "which", ["pm2"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function findPidsOnPort(port: number): number[] {
  const pids = new Set<number>();
  try {
    if (isWindows()) {
      const output = execFileSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf-8" });
      for (const line of output.split("\n")) {
        // Match the local-address column only; a bare `:port` substring also
        // matched the foreign-address column and killed unrelated processes.
        if (!line.includes("LISTENING")) continue;
        const parts = line.trim().split(/\s+/);
        const local = parts[1] ?? "";
        if (!local.endsWith(`:${port}`)) continue;
        const pid = parseInt(parts[parts.length - 1], 10);
        if (pid > 0) pids.add(pid);
      }
    } else {
      // lsof -ti can return several newline-separated pids; the old parseInt
      // of the whole output killed only the first and left stale listeners.
      const output = execFileSync("lsof", ["-ti", `:${port}`], { encoding: "utf-8" });
      for (const part of output.split("\n")) {
        const pid = parseInt(part.trim(), 10);
        if (pid > 0) pids.add(pid);
      }
    }
  } catch {}
  return [...pids];
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

  if (!hasPm2()) {
    console.log("pm2 not found. Install with: pnpm add -g pm2");
    return;
  }
  const name = getPm2Name();
  // Resolve daemon script relative to openwolf's install dir, not the target project
  const daemonScript = path.resolve(__dirname, "..", "daemon", "wolf-daemon.js");

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

  // Fall back to the daemon this project actually started. Never to "whatever
  // holds the port": port occupancy is not ownership, and the old fallback
  // SIGTERMed unrelated local services that happened to sit on 18791.
  stopOwnDaemon(wolfDir, projectRoot);
}

/**
 * Signals only a daemon whose identity is proven by `.wolf/daemon.pid`
 * (this host, this project root, live pid, still looks like the daemon).
 * Anything else is reported, never signalled.
 */
function stopOwnDaemon(wolfDir: string, projectRoot: string): void {
  const port = getDashboardPort();
  const { status, record } = lookupDaemonPid(wolfDir, projectRoot);

  if (status === "owned" && record) {
    if (killPid(record.pid)) {
      removeDaemonPidFile(wolfDir);
      console.log(`  ✓ Daemon stopped (PID ${record.pid}, port ${record.port})`);
    } else {
      console.error(`  Failed to stop daemon PID ${record.pid}. Stop it manually.`);
    }
    return;
  }

  if (status === "stale") {
    removeDaemonPidFile(wolfDir);
    console.log("  No daemon running (stale .wolf/daemon.pid cleared).");
  } else if (status === "foreign" && record) {
    console.log(`  .wolf/daemon.pid belongs to another project (${record.project_root}). Not touching it.`);
  } else {
    console.log("  No daemon running for this project.");
  }

  // Diagnose without acting. Whatever holds the port is somebody else's.
  const others = findPidsOnPort(port);
  if (others.length > 0) {
    console.log(
      `  Note: port ${port} is held by PID ${others.join(", ")}, which OpenWolf did not start. ` +
        `Left alone. Stop it yourself if it is a leftover daemon.`,
    );
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

  // Fall back: stop our own daemon, then hand off to the dashboard command.
  // Same rule as daemonStop: identity before signal, never kill by port.
  stopOwnDaemon(wolfDir, projectRoot);
  console.log("  Use 'openwolf dashboard' to start a new daemon.");
}

export function daemonStatus(): void {
  const projectRoot = findProjectRoot();
  const wolfDir = path.join(projectRoot, ".wolf");

  if (!fs.existsSync(wolfDir)) {
    console.log("OpenWolf not initialized. Run: openwolf init");
    return;
  }

  if (!hasPm2()) {
    console.log("  ✗ Daemon cannot run: pm2 not installed. Install with: pnpm add -g pm2");
    return;
  }

  const name = getPm2Name();
  try {
    const output = execFileSync(pm2Bin(), ["jlist"], { encoding: "utf-8" });
    const processes = JSON.parse(output) as Array<{ name: string; pm2_env?: { status?: string } }>;
    const proc = processes.find((p) => p.name === name);
    if (proc) {
      const procStatus = proc.pm2_env?.status ?? "unknown";
      const mark = procStatus === "online" ? "✓" : "✗";
      console.log(`  ${mark} Daemon ${name}: ${procStatus}`);
      return;
    }
  } catch {}
  console.log(`  ✗ Daemon not running (${name}). Start with: openwolf daemon start`);
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
