import * as fs from "node:fs";
import * as path from "node:path";
import { findProjectRoot } from "../scanner/project-root.js";
import { readJSON, readText } from "../utils/fs-safe.js";
import { HOOK_FILES } from "./hook-manifest.js";

export async function statusCommand(): Promise<void> {
  const projectRoot = findProjectRoot();
  const wolfDir = path.join(projectRoot, ".wolf");

  if (!fs.existsSync(wolfDir)) {
    console.log("OpenWolf not initialized. Run: openwolf init");
    return;
  }

  console.log("OpenWolf Status");
  console.log("===============\n");

  // File integrity check
  // identity.md is deliberately absent: `openwolf update` deletes it as dead
  // weight (untouched in 16/16 audited projects), so listing it here made
  // status report a missing file on every project the product itself cleaned.
  const requiredFiles = [
    "OPENWOLF.md", "cerebrum.md", "memory.md",
    "anatomy.md", "config.json", "token-ledger.json", "buglog.json",
    "cron-manifest.json", "cron-state.json",
  ];

  let missingCount = 0;
  for (const file of requiredFiles) {
    const exists = fs.existsSync(path.join(wolfDir, file));
    if (!exists) {
      console.log(`  ✗ Missing: .wolf/${file}`);
      missingCount++;
    }
  }
  if (missingCount === 0) {
    console.log(`  ✓ All ${requiredFiles.length} core files present`);
  }

  // Hook scripts check
  const hookFiles = HOOK_FILES;
  const hooksDir = path.join(wolfDir, "hooks");
  let hooksMissing = 0;
  for (const file of hookFiles) {
    if (!fs.existsSync(path.join(hooksDir, file))) hooksMissing++;
  }
  if (hooksMissing === 0) {
    console.log(`  ✓ All ${hookFiles.length} hook scripts present`);
  } else {
    console.log(`  ✗ Missing ${hooksMissing} hook scripts`);
  }

  const config = readJSON<{ openwolf?: { agents?: string[] } }>(
    path.join(wolfDir, "config.json"),
    {},
  );
  // Projects predating agent selection were Claude projects. Newer projects
  // should only be checked for the integrations they explicitly enabled.
  const configuredAgents = config.openwolf?.agents ?? ["claude"];
  if (configuredAgents.includes("claude")) {
    const settingsPath = path.join(projectRoot, ".claude", "settings.json");
    if (fs.existsSync(settingsPath)) {
      const settings = readJSON<Record<string, unknown>>(settingsPath, {});
      const hooks = settings.hooks as Record<string, unknown[]> | undefined;
      if (hooks) {
        const hookCount = Object.values(hooks).reduce((sum, arr) => sum + arr.length, 0);
        console.log(`  ✓ Claude Code hooks registered (${hookCount} matchers)`);
      }
    } else {
      console.log("  ✗ .claude/settings.json not found");
    }
  }

  // Token ledger stats
  const ledger = readJSON<{
    lifetime: {
      total_sessions: number;
      total_reads: number;
      total_writes: number;
      total_tokens_estimated: number;
      estimated_savings_vs_bare_cli: number;
    };
  }>(path.join(wolfDir, "token-ledger.json"), {
    lifetime: { total_sessions: 0, total_reads: 0, total_writes: 0, total_tokens_estimated: 0, estimated_savings_vs_bare_cli: 0 },
  });

  console.log(`\nToken Stats:`);
  console.log(`  Sessions: ${ledger.lifetime.total_sessions}`);
  console.log(`  Total reads: ${ledger.lifetime.total_reads}`);
  console.log(`  Total writes: ${ledger.lifetime.total_writes}`);
  console.log(`  Tokens tracked (estimate): ~${ledger.lifetime.total_tokens_estimated.toLocaleString()}`);
  console.log(`  Saved by denied reads: ~${ledger.lifetime.estimated_savings_vs_bare_cli.toLocaleString()} tokens (run 'openwolf report' for measured usage)`);

  // Anatomy stats
  const anatomyContent = readText(path.join(wolfDir, "anatomy.md"));
  const entryCount = (anatomyContent.match(/^- `/gm) || []).length;
  console.log(`\nAnatomy: ${entryCount} files tracked`);

  // Cron state
  const cronState = readJSON<{ engine_status: string; last_heartbeat: string | null }>(
    path.join(wolfDir, "cron-state.json"),
    { engine_status: "unknown", last_heartbeat: null }
  );
  const { hasPm2 } = await import("./daemon-cmd.js");
  // A recorded heartbeat is direct evidence the daemon runs (it can be
  // fork-spawned by `openwolf dashboard` without pm2) — report it before
  // complaining about pm2, which is only the persistence mechanism.
  if (cronState.last_heartbeat) {
    console.log(`\nDaemon: ${cronState.engine_status}`);
    const elapsed = Date.now() - new Date(cronState.last_heartbeat).getTime();
    const mins = Math.floor(elapsed / 60000);
    console.log(`  Last heartbeat: ${mins} minutes ago`);
    if (!hasPm2()) {
      console.log(`  Note: pm2 not installed; the daemon will not survive reboots (pnpm add -g pm2)`);
    }
  } else if (!hasPm2()) {
    console.log(`\nDaemon: ⚠ never run; pm2 not installed (pnpm add -g pm2). Cron tasks will not fire.`);
  } else {
    console.log(`\nDaemon: ${cronState.engine_status}`);
    console.log(`  ⚠ No heartbeat recorded — daemon has never run. Start with: openwolf daemon start`);
  }

  console.log("");
}
