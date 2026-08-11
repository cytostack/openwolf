import * as fs from "node:fs";
import * as path from "node:path";
import * as net from "node:net";
import { fileURLToPath } from "node:url";
import { fork } from "node:child_process";
import { findProjectRoot } from "../scanner/project-root.js";
import { readJSON } from "../utils/fs-safe.js";
import { getDashboardToken } from "../utils/dashboard-auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface WolfConfig {
  openwolf: {
    dashboard: { port: number; host?: string };
  };
}

function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, "127.0.0.1");
  });
}

export async function dashboardCommand(): Promise<void> {
  const projectRoot = findProjectRoot();
  const wolfDir = path.join(projectRoot, ".wolf");

  if (!fs.existsSync(wolfDir)) {
    console.log("OpenWolf not initialized. Run: openwolf init");
    return;
  }

  const config = readJSON<WolfConfig>(path.join(wolfDir, "config.json"), {
    openwolf: { dashboard: { port: 18791 } },
  });

  const configuredPort = config.openwolf.dashboard.port;
  const host = config.openwolf.dashboard.host || "127.0.0.1";
  const displayHost = host === "0.0.0.0" ? "localhost" : host;
  const token = getDashboardToken(wolfDir);

  const daemonScript = path.resolve(__dirname, "..", "daemon", "wolf-daemon.js");

  // Does the server on `p` accept THIS project's token? Distinguishes our own
  // daemon from another project's daemon squatting the shared default port.
  async function isOurDaemon(p: number): Promise<boolean> {
    try {
      const res = await fetch(`http://${displayHost}:${p}/api/health`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(1500),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  function spawnDaemon(p: number): void {
    const child = fork(daemonScript, [], {
      cwd: projectRoot,
      env: { ...process.env, OPENWOLF_PROJECT_ROOT: projectRoot, OPENWOLF_DASHBOARD_PORT: String(p) },
      // Do not inherit the launcher's execArgv (e.g. --input-type=module): the
      // daemon is a plain script and inherited flags can abort its startup.
      execArgv: [],
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  }

  async function waitForOurDaemon(p: number): Promise<boolean> {
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 200));
      if (await isOurDaemon(p)) return true;
    }
    return false;
  }

  if (!fs.existsSync(daemonScript)) {
    console.error(`  Daemon script not found at: ${daemonScript}`);
    console.log("  Run 'pnpm build' in the openwolf directory first.");
    return;
  }

  let servePort = configuredPort;

  if (await isPortOpen(configuredPort)) {
    if (await isOurDaemon(configuredPort)) {
      // Our own daemon is already serving this project. Reuse it.
    } else {
      // The port is held by another project's daemon (or an unrelated server).
      // Start this project's dashboard on the next free port instead of
      // opening a URL against a server that will reject our token with 401.
      servePort = configuredPort + 1;
      while (await isPortOpen(servePort) && servePort < configuredPort + 50) servePort++;
      console.log(`  Port ${configuredPort} is in use by another server. Starting this project's dashboard on port ${servePort}...`);
      spawnDaemon(servePort);
      if (!(await waitForOurDaemon(servePort))) {
        console.log(`  Server didn't start in time. Try: OPENWOLF_DASHBOARD_PORT=${servePort} node "${daemonScript}"`);
        return;
      }
      console.log(`  ✓ Dashboard server running on port ${servePort}`);
    }
  } else {
    console.log("  Daemon not running. Starting dashboard server...");
    spawnDaemon(configuredPort);
    if (!(await waitForOurDaemon(configuredPort))) {
      console.log(`  Server didn't start in time. Try manually: node "${daemonScript}"`);
      return;
    }
    console.log(`  ✓ Dashboard server running on port ${configuredPort}`);
  }

  const url = `http://${displayHost}:${servePort}/?token=${encodeURIComponent(token)}`;
  console.log(`  Opening ${url}...`);

  try {
    const { default: open } = await import("open");
    await open(url);
  } catch {
    console.log(`  Could not open browser. Visit: ${url}`);
  }
}
