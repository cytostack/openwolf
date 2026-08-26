import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { findProjectRoot } from "../scanner/project-root.js";
import { isWindows } from "../utils/platform.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

  if (!hasPm2()) {
    console.error("Failed to stop daemon: pm2 not found. Install with: pnpm add -g pm2");
    process.exitCode = 1;
    return;
  }

  const name = getPm2Name();
  try {
    if (isWindows()) {
      execFileSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "pm2.cmd", "stop", name], { stdio: "ignore" });
    } else {
      execFileSync("pm2", ["stop", name], { stdio: "ignore" });
    }
    console.log(`  ✓ Daemon stopped (PM2): ${name}`);
  } catch {
    console.error(`Failed to stop daemon (${name}). Run 'pm2 status'; if it is not registered, run 'openwolf daemon start', then retry.`);
    process.exitCode = 1;
  }
}

export function daemonRestart(): void {
  const projectRoot = findProjectRoot();
  const wolfDir = path.join(projectRoot, ".wolf");

  if (!fs.existsSync(wolfDir)) {
    console.log("OpenWolf not initialized. Run: openwolf init");
    return;
  }

  if (!hasPm2()) {
    console.error("Failed to restart daemon: pm2 not found. Install with: pnpm add -g pm2");
    process.exitCode = 1;
    return;
  }

  const name = getPm2Name();
  try {
    if (isWindows()) {
      execFileSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "pm2.cmd", "restart", name], { stdio: "ignore" });
    } else {
      execFileSync("pm2", ["restart", name], { stdio: "ignore" });
    }
    console.log(`  ✓ Daemon restarted (PM2): ${name}`);
  } catch {
    console.error(`Failed to restart daemon (${name}). Run 'pm2 status'; if it is not registered, run 'openwolf daemon start', then retry.`);
    process.exitCode = 1;
  }
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
