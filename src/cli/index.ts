import {addHandoffCommands} from "./handoff.js";
import {addFinalizeCommand} from "./finalize.js";
import { logSessionMemory } from "../hooks/session-memory.js";
import { reviewMemory, approveMemory, revokeMemory } from "./memory-review.js";
import { usageReport, reconcileUsage } from "../tracker/usage-report.js";
import { findProjectRoot } from "../scanner/project-root.js";
import { archiveMemory, restoreMemory } from "../hooks/memory-archive.js";
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
  addHandoffCommands(program);
  addFinalizeCommand(program);

  program
    .name("openwolf")
    .description("Token-conscious AI brain for Claude Code projects")
    .version(getVersion());

  program
    .command("init")
    .description("Initialize .wolf/ in current project")
    .option(
      "--agent <agents...>",
      "agents to wire up alongside Claude Code: codex, opencode, grok, gemini, cursor, antigravity, all. Default: auto-detect what's installed; pass 'claude' to wire Claude Code only"
    )
    .action((opts: { agent?: string[] }) => initCommand(opts));

  program
    .command("status")
    .description("Show daemon health, last session stats, file integrity")
    .option("--all", "show all registered projects")
    .option("--json", "machine-readable status")
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
      await daemonStart();
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
      await daemonRestart();
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
    .description("Refresh registered projects from this installed OpenWolf package")
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

  program.command("self-update")
    .description("Check npm and prepare a session-pinned runtime for this project")
    .option("--status", "Show cached update status without network access")
    .action(async (opts: {status?:boolean}) => {
      const {findProjectRoot} = await import("../scanner/project-root.js");
      const root = findProjectRoot(process.cwd());
      const {updateState,installedVersion,updatePolicy} = await import("../hooks/runtime-updates.js");
      const {checkForUpdate} = await import("../hooks/update-worker.js");
      const state = opts.status ? updateState(root) : await checkForUpdate(root,true);
      console.log(JSON.stringify({installed:installedVersion(root),policy:updatePolicy(root),...state},null,2));
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

  const usage = program.command("usage").description("Recorded project usage across Claude, Codex and OpenCode");
  usage.command("report").option("--json").option("--agent <agent>").action((opts) => {
    if (opts.agent && !["claude", "codex", "opencode"].includes(opts.agent)) throw new Error("Unknown usage agent");
    console.log(JSON.stringify(usageReport(findProjectRoot(), opts.agent), null, 2));
  });
  usage.command("reconcile").option("--json").action(() => console.log(JSON.stringify(reconcileUsage(findProjectRoot()), null, 2)));
  const memory = program.command("memory").description("Archive and restore session memory without deleting history");
  memory.command("log").requiredOption("--session <id>").requiredOption("--summary <text>").option("--files <paths>", "files involved", "").option("--outcome <text>", "validation or unresolved outcome", "").action(opts => logSessionMemory(path.join(findProjectRoot(),".wolf"),opts.session,opts.summary,opts.files,opts.outcome));
  memory.command("review").option("--json").action(() => console.log(JSON.stringify(reviewMemory(findProjectRoot()),null,2)));
  memory.command("approve <candidate>").requiredOption("--reviewer <name>").requiredOption("--store <directory>").description("Administrator-only: approve the exact reviewed snapshot for a managed harness").action((candidate,opts) => approveMemory(candidate,opts.reviewer,opts.store));
  memory.command("revoke").requiredOption("--reviewer <name>").requiredOption("--store <directory>").description("Administrator-only: revoke durable instruction approval").action(opts => console.log(JSON.stringify(revokeMemory(findProjectRoot(),opts.reviewer,opts.store),null,2)));
  memory.command("archive").option("--days <days>", "retention days", "7").option("--dry-run").action(opts => console.log(JSON.stringify(archiveMemory(path.join(findProjectRoot(), ".wolf"), Number(opts.days), opts.dryRun === true), null, 2)));
  memory.command("restore <id>").action(id => restoreMemory(path.join(findProjectRoot(), ".wolf"), id));
  program.command("maintenance").option("--dry-run").action(opts => {
    const root = findProjectRoot();
    console.log(JSON.stringify({memory: archiveMemory(path.join(root, ".wolf"), 7, opts.dryRun === true), usage: opts.dryRun ? usageReport(root) : reconcileUsage(root)}, null, 2));
  });
  return program;
}
