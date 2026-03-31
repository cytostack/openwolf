import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { findProjectRoot } from "../scanner/project-root.js";
import { readJSON, writeJSON } from "../utils/fs-safe.js";
import { Logger } from "../utils/logger.js";
import { CronEngine } from "./cron-engine.js";
import { startFileWatcher } from "./file-watcher.js";
import { DesignQCEngine } from "../designqc/designqc-engine.js";
import { DEFAULT_VIEWPORTS } from "../designqc/designqc-types.js";
import { getRegisteredProjects } from "../cli/registry.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Prefer explicit OPENWOLF_PROJECT_ROOT env (set by CLI commands) over cwd detection
let projectRoot = process.env.OPENWOLF_PROJECT_ROOT || findProjectRoot();
let wolfDir = path.join(projectRoot, ".wolf");

interface WolfConfig {
  openwolf: {
    daemon: { port: number; log_level: string };
    dashboard: { enabled: boolean; port: number };
    cron: { enabled: boolean; heartbeat_interval_minutes: number };
  };
}

const config = readJSON<WolfConfig>(path.join(wolfDir, "config.json"), {
  openwolf: {
    daemon: { port: 18790, log_level: "info" },
    dashboard: { enabled: true, port: 18791 },
    cron: { enabled: true, heartbeat_interval_minutes: 30 },
  },
});

const logger = new Logger(
  path.join(wolfDir, "daemon.log"),
  config.openwolf.daemon.log_level as "debug" | "info" | "warn" | "error"
);

const startTime = Date.now();
const wsClients = new Set<WebSocket>();

// Express server
const app = express();
app.use(express.json());

// Serve dashboard static files
// In dist: dist/src/daemon/wolf-daemon.js → ../../../dist/dashboard/
const dashboardDir = path.resolve(__dirname, "..", "..", "..", "dist", "dashboard");
if (fs.existsSync(dashboardDir)) {
  app.use(express.static(dashboardDir));
}

// Detect project metadata
function detectProjectMeta(): { name: string; description: string } {
  let name = path.basename(projectRoot);
  let description = "";

  // Try package.json
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8"));
    if (pkg.name) name = pkg.name;
    if (pkg.description) description = pkg.description;
  } catch {}

  // Try Cargo.toml for name if not found
  if (name === path.basename(projectRoot)) {
    try {
      const cargo = fs.readFileSync(path.join(projectRoot, "Cargo.toml"), "utf-8");
      const nameMatch = cargo.match(/^name\s*=\s*"([^"]+)"/m);
      if (nameMatch) name = nameMatch[1];
    } catch {}
  }

  // If no description, try cerebrum.md project description
  if (!description) {
    try {
      const cerebrum = fs.readFileSync(path.join(wolfDir, "cerebrum.md"), "utf-8");
      const descMatch = cerebrum.match(/\*\*Project:\*\*\s*(.+)/);
      if (descMatch) description = descMatch[1].trim();
    } catch {}
  }

  // If still no description, try README first paragraph
  if (!description) {
    for (const readme of ["README.md", "readme.md", "README.rst"]) {
      try {
        const content = fs.readFileSync(path.join(projectRoot, readme), "utf-8");
        const lines = content.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("!") && !trimmed.startsWith("=") && !trimmed.startsWith("-") && !trimmed.startsWith("<") && !trimmed.startsWith("[") && !trimmed.startsWith("```") && trimmed.length > 10) {
            description = trimmed.length > 200 ? trimmed.slice(0, 200) + "…" : trimmed;
            break;
          }
        }
        if (description) break;
      } catch {}
    }
  }

  return { name, description };
}

let projectMeta = detectProjectMeta();

// API routes
app.get("/api/config", (_req, res) => {
  res.json({ hasApiKey: !!process.env.ANTHROPIC_API_KEY });
});

app.get("/api/projects", (_req, res) => {
  res.json(getRegisteredProjects(true));
});

app.post("/api/switch", (req, res) => {
  const { root } = req.body as { root: string };
  if (!root || !fs.existsSync(path.join(root, ".wolf"))) {
    res.status(400).json({ error: "Invalid project root" });
    return;
  }
  if (root === projectRoot) {
    res.status(400).json({ error: "Already on this project" });
    return;
  }

  res.json({ ok: true });
  // Hot-reload: no restart needed, switch project in-place
  setImmediate(() => switchProject(root));
});

app.get("/api/health", (_req, res) => {
  const cronState = readJSON<{ engine_status: string; last_heartbeat: string | null; dead_letter_queue: unknown[] }>(
    path.join(wolfDir, "cron-state.json"),
    { engine_status: "unknown", last_heartbeat: null, dead_letter_queue: [] }
  );
  const cronManifest = readJSON<{ tasks?: unknown[] }>(
    path.join(wolfDir, "cron-manifest.json"),
    { tasks: [] }
  );
  const taskCount = Array.isArray(cronManifest.tasks) ? cronManifest.tasks.length : 0;
  res.json({
    status: "healthy",
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    last_heartbeat: cronState.last_heartbeat,
    tasks: taskCount,
    dead_letters: (cronState.dead_letter_queue ?? []).length,
  });
});

app.get("/api/project", (_req, res) => {
  res.json({
    name: projectMeta.name,
    description: projectMeta.description,
    root: projectRoot,
  });
});

app.get("/api/files", (_req, res) => {
  const files: Record<string, string> = {};
  const wolfFiles = [
    "OPENWOLF.md", "identity.md", "cerebrum.md", "memory.md", "anatomy.md",
    "config.json", "token-ledger.json", "buglog.json",
    "cron-manifest.json", "cron-state.json",
    "designqc-report.json",
  ];
  for (const file of wolfFiles) {
    try {
      files[file] = fs.readFileSync(path.join(wolfDir, file), "utf-8");
    } catch {
      files[file] = "";
    }
  }
  // Also try suggestions.json
  try {
    files["suggestions.json"] = fs.readFileSync(path.join(wolfDir, "suggestions.json"), "utf-8");
  } catch {
    files["suggestions.json"] = "";
  }
  res.json(files);
});

app.get("/api/designqc-report", (_req, res) => {
  const report = readJSON(path.join(wolfDir, "designqc-report.json"), null);
  res.json(report);
});

app.post("/api/designqc/run", (req, res) => {
  const config = readJSON<WolfConfig>(path.join(wolfDir, "config.json"), {
    openwolf: {
      daemon: { port: 18790, log_level: "info" },
      dashboard: { enabled: true, port: 18791 },
      cron: { enabled: true, heartbeat_interval_minutes: 30 },
    },
  });
  const dc = (config.openwolf as any)?.designqc ?? {};
  const engine = new DesignQCEngine(wolfDir, projectRoot, {
    devServerUrl: (req.body as any)?.url || undefined,
    viewports: dc.viewports || DEFAULT_VIEWPORTS,
    maxScreenshots: dc.max_screenshots || 16,
    chromePath: dc.chrome_path ?? undefined,
    quality: 70,
    maxWidth: 1200,
  });
  // Set a generous timeout for long captures (Chrome startup + multi-page)
  res.setTimeout(120_000);
  engine.capture()
    .then((result) => {
      res.json({ status: "ok", screenshots: result.screenshots.length, total_size_kb: result.totalSizeKB });
    })
    .catch((err) => {
      logger.error(`DesignQC run failed: ${err}`);
      res.status(500).json({ error: String(err) });
    });
});

// Trigger a cron task by ID
app.post("/api/cron/run/:taskId", (req, res) => {
  const { taskId } = req.params;
  if (!cronEngine) {
    res.status(503).json({ error: "Cron engine not running" });
    return;
  }
  // Return 202 immediately — task runs in background, result arrives via WebSocket/file-watcher
  res.status(202).json({ status: "accepted", task_id: taskId });
  cronEngine.runTask(taskId).catch((err) => {
    logger.error(`Manual task trigger failed for ${taskId}: ${err}`);
    broadcast({ type: "task_error", task_id: taskId, error: String(err) });
  });
});

// SPA fallback
app.get("/{*path}", (_req, res) => {
  const indexPath = path.join(dashboardDir, "index.html");
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ error: "Dashboard not built. Run: pnpm build:dashboard" });
  }
});

// Start HTTP server
const port = config.openwolf.dashboard.port;
const server = app.listen(port, () => {
  logger.info(`Dashboard server listening on port ${port}`);
});

// WebSocket server
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  wsClients.add(ws);
  logger.info("WebSocket client connected");

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString()) as { type: string; task_id?: string };
      handleDashboardCommand(msg);
    } catch {
      logger.warn("Invalid WebSocket message received");
    }
  });

  ws.on("close", () => {
    wsClients.delete(ws);
  });

  // Send initial state
  broadcast({ type: "daemon_started", timestamp: new Date().toISOString() });
});

function broadcast(msg: unknown): void {
  const data = JSON.stringify(msg);
  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

function handleDashboardCommand(msg: { type: string; task_id?: string }): void {
  switch (msg.type) {
    case "trigger_task":
      if (msg.task_id && cronEngine) {
        cronEngine.runTask(msg.task_id).catch((err) => {
          logger.error(`Manual task trigger failed: ${err}`);
        });
      }
      break;
    case "retry_dead_letter":
      if (msg.task_id) {
        const statePath = path.join(wolfDir, "cron-state.json");
        const state = readJSON<{ dead_letter_queue: Array<{ task_id: string }> }>(statePath, {
          dead_letter_queue: [],
        });
        state.dead_letter_queue = state.dead_letter_queue.filter(
          (d) => d.task_id !== msg.task_id
        );
        writeJSON(statePath, state);
      }
      break;
    case "force_scan":
      if (cronEngine) {
        cronEngine.runTask("anatomy-rescan").catch((err) => {
          logger.error(`Force scan failed: ${err}`);
        });
      }
      break;
    case "request_full_state":
      // Send all files
      try {
        const files: Record<string, string> = {};
        const wolfFiles = [
          "OPENWOLF.md", "identity.md", "cerebrum.md", "memory.md", "anatomy.md",
          "config.json", "token-ledger.json", "buglog.json",
          "cron-manifest.json", "cron-state.json",
          "designqc-report.json",
        ];
        for (const file of wolfFiles) {
          try {
            files[file] = fs.readFileSync(path.join(wolfDir, file), "utf-8");
          } catch {
            files[file] = "";
          }
        }
        broadcast({ type: "full_state", files, timestamp: new Date().toISOString() });
      } catch (err) {
        logger.error(`Full state request failed: ${err}`);
      }
      break;
  }
}

// Cron engine
let cronEngine: CronEngine | null = null;
if (config.openwolf.cron.enabled) {
  cronEngine = new CronEngine(wolfDir, projectRoot, logger, broadcast);
  cronEngine.start();
}

// File watcher
let fileWatcher = startFileWatcher(wolfDir, logger, broadcast);

// Hot-switch project without restarting the process
function switchProject(newRoot: string): void {
  const newWolfDir = path.join(newRoot, ".wolf");
  logger.info(`Switching project to: ${newRoot}`);

  // Stop existing subsystems
  if (cronEngine) { cronEngine.stop(); cronEngine = null; }
  fileWatcher.close();

  // Update mutable state
  projectRoot = newRoot;
  wolfDir = newWolfDir;
  projectMeta = detectProjectMeta();

  // Restart subsystems for new project
  if (config.openwolf.cron.enabled) {
    cronEngine = new CronEngine(wolfDir, projectRoot, logger, broadcast);
    cronEngine.start();
  }
  fileWatcher = startFileWatcher(wolfDir, logger, broadcast);

  // Mark new project as running
  const statePath = path.join(wolfDir, "cron-state.json");
  const state = readJSON<Record<string, unknown>>(statePath, {});
  state.engine_status = "running";
  state.last_heartbeat = new Date().toISOString();
  writeJSON(statePath, state);

  // Send full state to all connected dashboard clients
  const wolfFiles = [
    "OPENWOLF.md", "identity.md", "cerebrum.md", "memory.md", "anatomy.md",
    "config.json", "token-ledger.json", "buglog.json",
    "cron-manifest.json", "cron-state.json", "designqc-report.json", "suggestions.json",
  ];
  const files: Record<string, string> = {};
  for (const file of wolfFiles) {
    try { files[file] = fs.readFileSync(path.join(wolfDir, file), "utf-8"); } catch { files[file] = ""; }
  }
  broadcast({ type: "project_switched", project: { name: projectMeta.name, root: projectRoot }, files });
}

// Health heartbeat
const heartbeatInterval = config.openwolf.cron.heartbeat_interval_minutes * 60 * 1000;
const heartbeatTimer = setInterval(() => {
  const statePath = path.join(wolfDir, "cron-state.json");
  const state = readJSON<Record<string, unknown>>(statePath, {});
  state.last_heartbeat = new Date().toISOString();
  writeJSON(statePath, state);
  broadcast({ type: "health", status: "healthy", uptime: Math.floor((Date.now() - startTime) / 1000) });
}, heartbeatInterval);

// Update cron-state to running
const cronStatePath = path.join(wolfDir, "cron-state.json");
const cronState = readJSON<Record<string, unknown>>(cronStatePath, {});
cronState.engine_status = "running";
cronState.last_heartbeat = new Date().toISOString();
writeJSON(cronStatePath, cronState);

logger.info("OpenWolf daemon started");

// Graceful shutdown
function shutdown(): void {
  logger.info("Daemon shutting down...");
  broadcast({ type: "daemon_stopping", timestamp: new Date().toISOString() });

  clearInterval(heartbeatTimer);
  if (cronEngine) cronEngine.stop();

  const state = readJSON<Record<string, unknown>>(cronStatePath, {});
  state.engine_status = "stopped";
  writeJSON(cronStatePath, state);

  for (const client of wsClients) {
    client.close();
  }
  wsClients.clear();

  server.close(() => {
    logger.info("Daemon stopped");
    process.exit(0);
  });

  // Force exit after 5s
  setTimeout(() => process.exit(0), 5000);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
