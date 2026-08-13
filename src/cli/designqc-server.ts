import * as fs from "node:fs";
import * as path from "node:path";
import * as net from "node:net";
import { spawn, type ChildProcess } from "node:child_process";

const PROBE_PORTS = [3000, 3001, 5173, 5174, 4321, 8080, 8000, 4200];
const STARTUP_TIMEOUT_MS = 60_000;
const PORT_POLL_INTERVAL_MS = 500;

export interface StartedServer {
  url: string;
  child: ChildProcess | null;
}

function isPortOpen(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise(resolve => {
    const sock = net.connect({ port, host });
    sock.setTimeout(1500);
    sock.once("connect", () => {
      sock.destroy();
      resolve(true);
    });
    sock.once("error", () => resolve(false));
    sock.once("timeout", () => {
      sock.destroy();
      resolve(false);
    });
  });
}

async function waitForPort(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortOpen(port)) return true;
    await new Promise(r => setTimeout(r, PORT_POLL_INTERVAL_MS));
  }
  return false;
}

/** Probe known dev ports; return the base URL of the first responder, if any. */
export async function detectRunningServer(): Promise<string | null> {
  for (const port of PROBE_PORTS) {
    if (await isPortOpen(port)) return `http://localhost:${port}`;
  }
  return null;
}

function detectPackageManager(projectRoot: string): string {
  if (fs.existsSync(path.join(projectRoot, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(projectRoot, "bun.lockb")) || fs.existsSync(path.join(projectRoot, "bun.lock"))) return "bun";
  if (fs.existsSync(path.join(projectRoot, "yarn.lock"))) return "yarn";
  return "npm";
}

function findStartScript(projectRoot: string): string | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8"));
    const scripts: Record<string, string> = pkg.scripts ?? {};
    for (const name of ["dev", "start", "serve"]) {
      if (typeof scripts[name] === "string" && scripts[name].trim()) return name;
    }
  } catch {
    // Not a Node project — caller reports the error.
  }
  return null;
}

/** Start the project's dev server and wait for it to accept connections. */
export async function startDevServer(projectRoot: string): Promise<StartedServer> {
  const script = findStartScript(projectRoot);
  if (!script) {
    throw new Error("No running server found and no dev/start/serve script in package.json");
  }

  const pm = detectPackageManager(projectRoot);
  const bin = process.platform === "win32" ? `${pm}.cmd` : pm;
  const port = PROBE_PORTS[0];
  const url = `http://localhost:${port}`;

  console.log(`  ✓ Starting dev server: ${pm} ${script} (on port ${port})`);
  const child = spawn(bin, ["run", script], {
    cwd: projectRoot,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: { ...process.env, PORT: String(port) },
  });

  child.stdout?.on("data", d => process.stdout.write(d));
  child.stderr?.on("data", d => process.stderr.write(d));
  child.on("exit", code => {
    if (code !== 0) process.stderr.write(`\n[designqc] dev server exited with code ${code}\n`);
  });

  const ok = await waitForPort(port, STARTUP_TIMEOUT_MS);
  if (!ok) {
    child.kill();
    throw new Error(`Dev server did not respond on port ${port} within ${STARTUP_TIMEOUT_MS / 1000}s`);
  }

  return { url, child };
}
