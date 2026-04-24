import { execSync } from "node:child_process";
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
  return config.openwolf?.dashboard?.port ?? 18791;
}

function getPm2Name(): string {
  const projectRoot = findProjectRoot();
  return `openwolf-${path.basename(projectRoot)}`;
}

function hasPm2(): boolean {
  try {
    const cmd = isWindows() ? "where pm2" : "which pm2";
    execSync(cmd, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function findPidOnPort(port: number): number | null {
  try {
    if (isWindows()) {
      const output = execSync(`netstat -ano -p tcp`, { encoding: "utf-8" });
      for (const line of output.split("\n")) {
        if (line.includes(`:${port}`) && line.includes("LISTENING")) {
          const parts = line.trim().split(/\s+/);
          const pid = parseInt(parts[parts.length - 1], 10);
          if (pid > 0) return pid;
        }
      }
    } else {
      const output = execSync(`lsof -ti :${port}`, { encoding: "utf-8" });
      const pid = parseInt(output.trim(), 10);
      if (pid > 0) return pid;
    }
  } catch {}
  return null;
}

function killPid(pid: number): boolean {
  try {
    if (isWindows()) {
      execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
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
    execSync(`pm2 start "${daemonScript}" --name ${name} --cwd "${projectRoot}" -- --env OPENWOLF_PROJECT_ROOT="${projectRoot}"`, {
      stdio: "inherit",
      env: { ...process.env, OPENWOLF_PROJECT_ROOT: projectRoot },
    });
    execSync("pm2 save", { stdio: "ignore" });
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
      execSync(`pm2 stop ${name}`, { stdio: "ignore" });
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
      execSync(`pm2 restart ${name}`, { stdio: "ignore" });
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
    execSync(`pm2 logs ${name} --lines 50 --nostream`, { stdio: "inherit" });
  } catch {
    console.error("Failed to get daemon logs.");
  }
}
