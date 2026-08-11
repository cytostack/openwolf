import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { findProjectRoot } from "../scanner/project-root.js";
import { readJSON, readText } from "../utils/fs-safe.js";
import { HOOK_ENTRYPOINTS, listHookModules, resolveHookSourceDir } from "../utils/hook-files.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  const requiredFiles = [
    "OPENWOLF.md", "identity.md", "cerebrum.md", "memory.md",
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

  // Hook scripts check — compare against what the installed package ships, not a
  // hardcoded list. The entrypoints import helper modules, and a missing helper
  // kills the hook just as dead as a missing entrypoint.
  const hooksDir = path.join(wolfDir, "hooks");
  const hookSourceDir = resolveHookSourceDir(__dirname);
  const expectedHooks = listHookModules(hookSourceDir);
  const hookFiles = expectedHooks.length ? expectedHooks : [...HOOK_ENTRYPOINTS];
  const missingHooks = hookFiles.filter((file) => !fs.existsSync(path.join(hooksDir, file)));
  if (missingHooks.length === 0) {
    console.log(`  ✓ All ${hookFiles.length} hook scripts present`);
  } else {
    console.log(`  ✗ Missing ${missingHooks.length} hook scripts: ${missingHooks.join(", ")}`);
    console.log(`    Run: openwolf update`);
  }

  // Claude settings check
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
  console.log(`  Tokens tracked: ~${ledger.lifetime.total_tokens_estimated.toLocaleString()}`);
  console.log(`  Estimated savings: ~${ledger.lifetime.estimated_savings_vs_bare_cli.toLocaleString()} tokens`);

  // Anatomy stats
  const anatomyContent = readText(path.join(wolfDir, "anatomy.md"));
  const entryCount = (anatomyContent.match(/^- `/gm) || []).length;
  console.log(`\nAnatomy: ${entryCount} files tracked`);

  // Cron state
  const cronState = readJSON<{ engine_status: string; last_heartbeat: string | null }>(
    path.join(wolfDir, "cron-state.json"),
    { engine_status: "unknown", last_heartbeat: null }
  );
  console.log(`\nDaemon: ${cronState.engine_status}`);
  if (cronState.last_heartbeat) {
    const elapsed = Date.now() - new Date(cronState.last_heartbeat).getTime();
    const mins = Math.floor(elapsed / 60000);
    console.log(`  Last heartbeat: ${mins} minutes ago`);
  }

  console.log("");
}
