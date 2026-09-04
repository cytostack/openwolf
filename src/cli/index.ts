import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { initCommand } from "./init.js";
import { statusCommand } from "./status.js";
import { scanCommand } from "./scan.js";
import { dashboardCommand } from "./dashboard.js";
import { reportCommand } from "./report.js";
import { findCommand } from "./find.js";
import { mapCommand } from "./map.js";
import { benchCommand } from "./bench.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getVersion(): string {
  try {
    const pkgPath = path.resolve(__dirname, "../../../package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    return pkg.version || "unknown";
  } catch {
    return "unknown";
  }
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name("openwolf")
    .description(
      "One project memory across Claude Code, Codex and OpenCode. Token usage measured, not estimated. Zero API calls."
    )
    .version(getVersion());

  program
    .command("init")
    .description("Initialize .wolf/ in current project")
    .option(
      "--agent <agents...>",
      "agents to wire up: claude, codex, opencode, gemini, cursor, antigravity, all. Explicit names are exact; default: Claude plus auto-detected agents"
    )
    .action((opts: { agent?: string[] }) => initCommand(opts));

  program
    .command("status")
    .description("Show daemon health, last session stats, file integrity")
    .action(statusCommand);

  program
    .command("scan")
    .description("Force full anatomy rescan")
    .option("--check", "Verify anatomy.md matches filesystem (no changes)")
    .action(scanCommand);

  program
    .command("dashboard")
    .description("Open browser to dashboard")
    .action(dashboardCommand);

  program
    .command("report")
    .description("Token report: estimated vs measured (from harness transcripts)")
    .action(reportCommand);

  program
    .command("bench")
    .description("A/B benchmark: same tasks with and without OpenWolf, measured from transcripts")
    .option("--repo <pathOrUrl>", "Fixture repository to clone per run")
    .option("--task <filter>", "Only run tasks whose filename contains this")
    .option("--repeats <n>", "Repeats per task per arm (default 3)")
    .option("--yes", "Confirm spending real API budget")
    .action((opts: { repo?: string; task?: string; repeats?: string; yes?: boolean }) => benchCommand(opts));

  program
    .command("map")
    .description("Token-budgeted overview of the most important files (personalized PageRank)")
    .option("--budget <tokens>", "Output token budget (default 1000; 2000 unseeded)")
    .option("--focus <terms>", "Comma/space separated terms to bias the ranking toward")
    .action((opts: { budget?: string; focus?: string }) => mapCommand(opts));

  program
    .command("find <query>")
    .description("Locate a symbol or file via the anatomy index (ranked, ~1k token cap)")
    .option("--file", "Show full index detail for one path (description, symbols, ranges)")
    .action((query: string, opts: { file?: boolean }) => findCommand(query, opts));

  const daemon = program
    .command("daemon")
    .description("Daemon management");

  daemon
    .command("start")
    .description("Start daemon via pm2")
    .action(async () => {
      const { daemonStart } = await import("./daemon-cmd.js");
      daemonStart();
    });

  daemon
    .command("stop")
    .description("Stop daemon")
    .action(async () => {
      const { daemonStop } = await import("./daemon-cmd.js");
      daemonStop();
    });

  daemon
    .command("restart")
    .description("Restart daemon")
    .action(async () => {
      const { daemonRestart } = await import("./daemon-cmd.js");
      daemonRestart();
    });

  daemon
    .command("status")
    .description("Show whether the daemon is running")
    .action(async () => {
      const { daemonStatus } = await import("./daemon-cmd.js");
      daemonStatus();
    });

  daemon
    .command("logs")
    .description("Show last 50 lines of daemon log")
    .action(async () => {
      const { daemonLogs } = await import("./daemon-cmd.js");
      daemonLogs();
    });

  const cron = program
    .command("cron")
    .description("Cron task management");

  cron
    .command("list")
    .description("Show all cron tasks with next run times")
    .action(async () => {
      const { cronList } = await import("./cron-cmd.js");
      cronList();
    });

  cron
    .command("run <id>")
    .description("Manually trigger a cron task")
    .action(async (id: string) => {
      const { cronRun } = await import("./cron-cmd.js");
      await cronRun(id);
    });

  cron
    .command("enable <id>")
    .description("Enable a cron task")
    .action(async (id: string) => {
      const { cronSetEnabled } = await import("./cron-cmd.js");
      cronSetEnabled(id, true);
    });

  cron
    .command("disable <id>")
    .description("Disable a cron task")
    .action(async (id: string) => {
      const { cronSetEnabled } = await import("./cron-cmd.js");
      cronSetEnabled(id, false);
    });

  cron
    .command("retry <id>")
    .description("Retry a dead-lettered task")
    .action(async (id: string) => {
      const { cronRetry } = await import("./cron-cmd.js");
      cronRetry(id);
    });

  // --- Update command ---
  program
    .command("update")
    .description("Update all registered OpenWolf projects to latest version")
    .option("--dry-run", "Show what would be updated without making changes")
    .option("--project <name>", "Update only a specific project (partial name match)")
    .option("--list", "List all registered projects")
    .action(async (opts: { dryRun?: boolean; project?: string; list?: boolean }) => {
      const { updateCommand, listProjects } = await import("./update.js");
      if (opts.list) {
        listProjects();
      } else {
        await updateCommand(opts);
      }
    });

  // --- Restore command ---
  program
    .command("restore [backup]")
    .description("Restore .wolf from a backup (run in project dir). Without args, lists available backups.")
    .action(async (backup?: string) => {
      const { restoreCommand } = await import("./update.js");
      restoreCommand(backup);
    });

  // --- Bug command ---
  const bug = program
    .command("bug")
    .description("Bug memory management");

  bug
    .command("search <term>")
    .description("Search buglog for matching entries")
    .action(async (term: string) => {
      const { bugSearch } = await import("./bug-cmd.js");
      bugSearch(term);
    });

  return program;
}
