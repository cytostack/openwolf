/**
 * openwolf update — Update all registered OpenWolf projects.
 *
 * For each project:
 * 1. Creates a timestamped backup in .wolf/backups/
 * 2. Updates hooks, templates, protocol files, and claude rules
 * 3. Preserves all user data (cerebrum, memory, anatomy, buglog, ledger)
 * 4. Reports results per project
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { getRegisteredProjects, registerProject, type RegisteredProject } from "./registry.js";
import { readJSON, writeJSON, readText, writeText, safeCopyFile } from "../utils/fs-safe.js";
import { ensureDir } from "../utils/paths.js";
import { resolveAgents, availableAgents } from "../agents/index.js";
import { newStore, importFromMarkdown, saveStore, STORE_FILE, sha256 as storeSha256 } from "../hooks/anatomy-store.js";
import { installSkills } from "../agents/skills.js";

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

// Files that are safe to overwrite (protocol docs only — never user-edited config)
const ALWAYS_OVERWRITE = ["OPENWOLF.md", "reframe-frameworks.md"];

// Files that contain user data — NEVER overwrite, only create if missing.
//
// `config.json` is user data: it holds per-project port assignments
// (`openwolf.daemon.port`, `openwolf.dashboard.port`), scan intervals,
// exclude patterns, and any other tunables a user has customized.
// Overwriting it on `openwolf update` resets every registered project to
// the same default ports (18790 / 18791), at which point only the first
// daemon to start can bind and the rest crash-loop on EADDRINUSE.
// Keep it in BACKUP_FILES (via the spread below) so `openwolf restore`
// can still recover it.
const USER_DATA_FILES = [
  "config.json",
  "identity.md", "cerebrum.md", "memory.md", "anatomy.md", "anatomy-index.json", "STATUS.md",
  "token-ledger.json", "buglog.json", "cron-manifest.json", "cron-state.json",
  "suggestions.json",
];

// Files to include in backup
const BACKUP_FILES = [
  ...ALWAYS_OVERWRITE,
  ...USER_DATA_FILES,
];

const HOOK_SETTINGS = {
  hooks: {
    SessionStart: [{ matcher: "", hooks: [{ type: "command", command: 'node "$CLAUDE_PROJECT_DIR/.wolf/hooks/session-start.js"', timeout: 5 }] }],
    PreToolUse: [
      { matcher: "Read", hooks: [{ type: "command", command: 'node "$CLAUDE_PROJECT_DIR/.wolf/hooks/pre-read.js"', timeout: 5 }] },
      { matcher: "Write|Edit|MultiEdit", hooks: [{ type: "command", command: 'node "$CLAUDE_PROJECT_DIR/.wolf/hooks/pre-write.js"', timeout: 5 }] },
    ],
    PostToolUse: [
      { matcher: "Read", hooks: [{ type: "command", command: 'node "$CLAUDE_PROJECT_DIR/.wolf/hooks/post-read.js"', timeout: 5 }] },
      { matcher: "Write|Edit|MultiEdit", hooks: [{ type: "command", command: 'node "$CLAUDE_PROJECT_DIR/.wolf/hooks/post-write.js"', timeout: 10 }] },
    ],
    PreCompact: [{ matcher: "", hooks: [{ type: "command", command: 'node "$CLAUDE_PROJECT_DIR/.wolf/hooks/precompact.js"', timeout: 5 }] }],
    Stop: [{ matcher: "", hooks: [{ type: "command", command: 'node "$CLAUDE_PROJECT_DIR/.wolf/hooks/stop.js"', timeout: 10 }] }],
  },
};

interface UpdateResult {
  project: RegisteredProject;
  status: "updated" | "skipped" | "error";
  backupDir?: string;
  message: string;
}

export async function updateCommand(options: { dryRun?: boolean; force?: boolean; project?: string }): Promise<void> {
  const version = getVersion();
  const projects = getRegisteredProjects(true);

  if (projects.length === 0) {
    console.log("No registered OpenWolf projects found.");
    console.log("Run 'openwolf init' in a project directory to register it.");
    return;
  }

  // Filter to specific project if requested
  let targets = projects;
  if (options.project) {
    const search = options.project.toLowerCase();
    targets = projects.filter(p =>
      p.name.toLowerCase().includes(search) ||
      p.root.toLowerCase().includes(search)
    );
    if (targets.length === 0) {
      console.log(`No registered project matching "${options.project}".`);
      console.log("Registered projects:");
      for (const p of projects) {
        console.log(`  - ${p.name} (${p.root})`);
      }
      return;
    }
  }

  console.log(`OpenWolf v${version} — updating ${targets.length} project(s)${options.dryRun ? " (dry run)" : ""}...\n`);

  const results: UpdateResult[] = [];

  for (const project of targets) {
    const result = await updateProject(project, version, options.dryRun ?? false);
    results.push(result);
  }

  // Summary
  console.log("\n─── Update Summary ───");
  const updated = results.filter(r => r.status === "updated");
  const skipped = results.filter(r => r.status === "skipped");
  const errors = results.filter(r => r.status === "error");

  if (updated.length > 0) {
    console.log(`\n  ✓ Updated (${updated.length}):`);
    for (const r of updated) {
      console.log(`    ${r.project.name} — ${r.message}`);
    }
  }
  if (skipped.length > 0) {
    console.log(`\n  ○ Skipped (${skipped.length}):`);
    for (const r of skipped) {
      console.log(`    ${r.project.name} — ${r.message}`);
    }
  }
  if (errors.length > 0) {
    console.log(`\n  ✗ Errors (${errors.length}):`);
    for (const r of errors) {
      console.log(`    ${r.project.name} — ${r.message}`);
    }
  }
  console.log("");
}

async function updateProject(
  project: RegisteredProject,
  version: string,
  dryRun: boolean
): Promise<UpdateResult> {
  const { root, name } = project;
  const wolfDir = path.join(root, ".wolf");

  // Validate project still exists
  if (!fs.existsSync(wolfDir)) {
    return { project, status: "skipped", message: ".wolf/ directory not found" };
  }

  // Never update the openwolf source repo itself
  if (name === "openwolf") {
    return { project, status: "skipped", message: "openwolf source repo — skipped" };
  }

  console.log(`  ${name} (${root})`);

  // Already at this version?
  if (project.version === version) {
    console.log(`    Already at v${version} — updating hooks/templates anyway`);
  }

  if (dryRun) {
    console.log(`    [dry run] Would backup, update hooks, templates, rules`);
    return { project, status: "updated", message: `would update to v${version}` };
  }

  try {
    // 1. Create backup
    const backupDir = createBackup(wolfDir);
    console.log(`    ✓ Backup: ${path.basename(backupDir)}`);

    // 2. Update template files (OPENWOLF.md, config.json)
    const templatesDir = findTemplatesDir();
    for (const file of ALWAYS_OVERWRITE) {
      const srcPath = path.join(templatesDir, file);
      const destPath = path.join(wolfDir, file);
      if (fs.existsSync(srcPath)) {
        safeCopyFile(srcPath, destPath);
      }
    }
    console.log(`    ✓ Templates updated (${ALWAYS_OVERWRITE.join(", ")})`);

    // 3. Update hook scripts
    copyHookScripts(wolfDir);
    console.log(`    ✓ Hook scripts updated`);

    // 4. Update .claude/settings.json hooks
    const claudeDir = path.join(root, ".claude");
    ensureDir(claudeDir);
    const settingsPath = path.join(claudeDir, "settings.json");
    if (fs.existsSync(settingsPath)) {
      const existing = readJSON<Record<string, unknown>>(settingsPath, {});
      const merged = replaceOpenWolfHooks(existing, HOOK_SETTINGS);
      writeJSON(settingsPath, merged);
    } else {
      writeJSON(settingsPath, HOOK_SETTINGS);
    }
    console.log(`    ✓ Claude settings updated`);

    // 5. Update .claude/rules/openwolf.md
    const rulesDir = path.join(claudeDir, "rules");
    ensureDir(rulesDir);
    const rulesContent = readTemplateContent("claude-rules-openwolf.md", templatesDir);
    writeText(path.join(rulesDir, "openwolf.md"), rulesContent);
    console.log(`    ✓ Claude rules updated`);

    // 5a2. One-time anatomy store migration (projects predating the durable
    // store): bootstrap anatomy-index.json from the existing anatomy.md.
    try {
      if (!fs.existsSync(path.join(wolfDir, STORE_FILE))) {
        const md = readText(path.join(wolfDir, "anatomy.md"));
        if (md) {
          const store = newStore();
          importFromMarkdown(store, md, root);
          store.meta.renderedHash = storeSha256(md);
          saveStore(wolfDir, store);
          console.log(`    ✓ anatomy-index.json created (migrated from anatomy.md)`);
        }
      }
    } catch {}

    // 5a3. Resolve port collisions across registered projects. Projects
    // upgraded from 1.x share the old default ports (18790/18791); when more
    // than one is registered their daemons and dashboards collide, which is
    // why the dashboard used to only ever open the first project. Reassign a
    // free pair when this project's ports overlap another registered project.
    try {
      const reassigned = reassignCollidingPorts(root, wolfDir);
      if (reassigned) console.log(`    ✓ Ports reassigned to ${reassigned} (avoids collision with another project)`);
    } catch {}

    // 5b. Create STATUS.md if missing (projects predating the handoff doc)
    const statusPath = path.join(wolfDir, "STATUS.md");
    if (!fs.existsSync(statusPath)) {
      const statusContent = readTemplateContent("STATUS.md", templatesDir);
      if (statusContent) {
        writeText(statusPath, seedStatusPlaceholders(statusContent, root));
        console.log(`    ✓ STATUS.md created`);
      }
    }

    // 5c. Re-run the agent adapters this project was initialized with, so
    // Codex/OpenCode/Gemini/Cursor wiring picks up new hooks and templates.
    const cfg = readJSON<{ openwolf?: { agents?: string[] } }>(path.join(wolfDir, "config.json"), {});
    const agentNames = cfg.openwolf?.agents ?? ["claude"];
    const known = new Set(availableAgents());
    const extras = agentNames.filter((a) => a !== "claude");
    const unknown = extras.filter((a) => !known.has(a));
    for (const u of unknown) {
      console.log(`    ⚠ unknown agent "${u}" in config.openwolf.agents — skipped`);
    }
    const adapters = resolveAgents(extras.filter((a) => known.has(a)));
    const ctx = { projectRoot: root, wolfDir, templatesDir };
    for (const adapter of adapters) {
      const result = adapter.install(ctx);
      for (const line of result.actions) console.log(`    ✓ ${line}`);
      for (const warn of result.warnings) console.log(`    ⚠ ${adapter.displayName}: ${warn}`);
    }

    // 5d. Refresh bundled skills for every configured agent.
    for (const line of installSkills(root, templatesDir, agentNames)) {
      console.log(`    ✓ ${line}`);
    }

    // 6. Update CLAUDE.md snippet if it references OpenWolf
    const claudeMdPath = path.join(root, "CLAUDE.md");
    const snippetContent = readTemplateContent("claude-md-snippet.md", templatesDir);
    if (fs.existsSync(claudeMdPath)) {
      const existing = readText(claudeMdPath);
      if (!existing.includes("OpenWolf")) {
        writeText(claudeMdPath, snippetContent + "\n\n" + existing);
        console.log(`    ✓ CLAUDE.md updated`);
      }
    }

    // 7. Clean up stale .tmp files
    try {
      const files = fs.readdirSync(wolfDir);
      let cleaned = 0;
      for (const f of files) {
        if (f.endsWith(".tmp")) {
          try { fs.unlinkSync(path.join(wolfDir, f)); cleaned++; } catch {}
        }
      }
      if (cleaned > 0) console.log(`    ✓ Cleaned ${cleaned} stale .tmp file(s)`);
    } catch {}

    // 8. Update registry entry
    registerProject(root, name, version);

    return {
      project,
      status: "updated",
      backupDir,
      message: `v${project.version} → v${version}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { project, status: "error", message: msg };
  }
}

/**
 * If this project's dashboard/daemon ports collide with another registered
 * project, allocate a free pair. Returns "daemon/dashboard" if reassigned,
 * else null. Mirrors the free-port logic in cli/init.ts reconcileConfig.
 */
function reassignCollidingPorts(root: string, wolfDir: string): string | null {
  const cfgPath = path.join(wolfDir, "config.json");
  const cfg = readJSON<any>(cfgPath, null as any);
  if (!cfg?.openwolf?.dashboard) return null;

  const norm = (p: string) => (process.platform === "win32" ? path.resolve(p).toLowerCase() : path.resolve(p));
  const mine = norm(root);
  const used = new Set<number>();
  for (const proj of getRegisteredProjects(false)) {
    if (norm(proj.root) === mine) continue;
    const oc = readJSON<any>(path.join(proj.root, ".wolf", "config.json"), null as any)?.openwolf;
    if (typeof oc?.daemon?.port === "number") used.add(oc.daemon.port);
    if (typeof oc?.dashboard?.port === "number") used.add(oc.dashboard.port);
  }

  const myDash = cfg.openwolf.dashboard.port;
  const myDaemon = cfg.openwolf.daemon?.port;
  if (!used.has(myDash) && (typeof myDaemon !== "number" || !used.has(myDaemon))) return null;

  const nextFree = (base: number): number => { let p = base; while (used.has(p)) p++; used.add(p); return p; };
  cfg.openwolf.daemon = cfg.openwolf.daemon || {};
  cfg.openwolf.dashboard = cfg.openwolf.dashboard || {};
  cfg.openwolf.daemon.port = nextFree(18790);
  cfg.openwolf.dashboard.port = nextFree(18791);
  writeJSON(cfgPath, cfg);
  return `${cfg.openwolf.daemon.port}/${cfg.openwolf.dashboard.port}`;
}

/** Fill STATUS.md template placeholders — mirrors seedStatus in init.ts. */
function seedStatusPlaceholders(content: string, projectRoot: string): string {
  let projectName = path.basename(projectRoot);
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8"));
    if (typeof pkg.name === "string" && pkg.name) projectName = pkg.name;
  } catch {}
  return content
    .replace(/\{\{PROJECT_NAME\}\}/g, projectName)
    .replace(/\{\{DATE\}\}/g, new Date().toISOString().slice(0, 10));
}

/**
 * Create a timestamped backup of all .wolf files into .wolf/backups/YYYY-MM-DD_HHMMSS/
 */
function createBackup(wolfDir: string): string {
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "").slice(0, 15); // 20260315T013000
  const backupDir = path.join(wolfDir, "backups", stamp);
  ensureDir(backupDir);

  // Backup all relevant files
  for (const file of BACKUP_FILES) {
    const src = path.join(wolfDir, file);
    if (fs.existsSync(src)) {
      safeCopyFile(src, path.join(backupDir, file));
    }
  }

  // Also backup hooks
  const hooksDir = path.join(wolfDir, "hooks");
  if (fs.existsSync(hooksDir)) {
    const hooksBackup = path.join(backupDir, "hooks");
    ensureDir(hooksBackup);
    try {
      const hookFiles = fs.readdirSync(hooksDir);
      for (const f of hookFiles) {
        const src = path.join(hooksDir, f);
        if (fs.statSync(src).isFile()) {
          safeCopyFile(src, path.join(hooksBackup, f));
        }
      }
    } catch {}
  }

  // Also backup .claude/settings.json and rules
  const projectRoot = path.dirname(wolfDir);
  const claudeSettings = path.join(projectRoot, ".claude", "settings.json");
  if (fs.existsSync(claudeSettings)) {
    const claudeBackup = path.join(backupDir, ".claude");
    ensureDir(claudeBackup);
    safeCopyFile(claudeSettings, path.join(claudeBackup, "settings.json"));
  }
  const claudeRules = path.join(projectRoot, ".claude", "rules", "openwolf.md");
  if (fs.existsSync(claudeRules)) {
    const rulesBackup = path.join(backupDir, ".claude", "rules");
    ensureDir(rulesBackup);
    safeCopyFile(claudeRules, path.join(rulesBackup, "openwolf.md"));
  }

  return backupDir;
}

// ─── Shared helpers (extracted from init.ts patterns) ─────────────

function findTemplatesDir(): string {
  const candidates = [
    path.resolve(__dirname, "..", "..", "..", "src", "templates"),
    path.resolve(__dirname, "..", "..", "src", "templates"),
    path.resolve(__dirname, "..", "templates"),
    path.resolve(__dirname, "templates"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return candidates[0];
}

function readTemplateContent(filename: string, templatesDir: string): string {
  const filePath = path.join(templatesDir, filename);
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, "utf-8");
  }
  const templates: Record<string, string> = {
    "claude-md-snippet.md": `# OpenWolf\n\n@.wolf/OPENWOLF.md\n\nThis project uses OpenWolf for context management. Read and follow .wolf/OPENWOLF.md every session. Check .wolf/cerebrum.md before generating code. Check .wolf/anatomy.md before reading files.`,
    "claude-rules-openwolf.md": `---\ndescription: OpenWolf protocol enforcement — active on all files\nglobs: **/*\n---\n\n- Check .wolf/anatomy.md before reading any project file\n- Check .wolf/cerebrum.md Do-Not-Repeat list before generating code\n- After writing or editing files, update .wolf/anatomy.md and append to .wolf/memory.md\n- After receiving a user correction, update .wolf/cerebrum.md immediately (Preferences, Learnings, or Do-Not-Repeat)\n- LEARN from every interaction: if you discover a convention, user preference, or project pattern, add it to .wolf/cerebrum.md. Low threshold — when in doubt, log it.\n- BEFORE fixing any bug or error: read .wolf/buglog.json for known fixes\n- AFTER fixing any bug, error, failed test, failed build, or user-reported problem: ALWAYS log to .wolf/buglog.json with error_message, root_cause, fix, and tags\n- If you edit a file more than twice in a session, that likely indicates a bug — log it to .wolf/buglog.json\n- When the user asks to change/pick/migrate UI framework: read .wolf/reframe-frameworks.md, ask decision questions, recommend a framework, then execute with the framework's prompt`,
  };
  return templates[filename] ?? "";
}

function copyHookScripts(wolfDir: string): void {
  const hooksDir = path.join(wolfDir, "hooks");
  ensureDir(hooksDir);

  const candidates = [
    path.join(__dirname, "..", "hooks"),
    path.resolve(__dirname, "..", "..", "hooks"),
    path.resolve(__dirname, "..", "..", "dist", "hooks"),
  ];

  let sourceDir = "";
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, "shared.js"))) {
      sourceDir = candidate;
      break;
    }
  }

  const hookFiles = [
    "session-start.js", "pre-read.js", "pre-write.js",
    "post-read.js", "post-write.js", "precompact.js", "stop.js", "shared.js",
    "anatomy-store.js", "anatomy-lock.js",
  ];

  if (sourceDir) {
    for (const file of hookFiles) {
      const src = path.join(sourceDir, file);
      if (fs.existsSync(src)) {
        safeCopyFile(src, path.join(hooksDir, file));
      }
    }
  }

  // Always ensure package.json with type:module
  const hooksPkgPath = path.join(hooksDir, "package.json");
  fs.writeFileSync(hooksPkgPath, JSON.stringify({ type: "module" }, null, 2) + "\n", "utf-8");
}

function replaceOpenWolfHooks(
  existing: Record<string, unknown>,
  hookSettings: typeof HOOK_SETTINGS
): Record<string, unknown> {
  const merged = { ...existing };
  if (!merged.hooks) merged.hooks = {};
  const hooks = merged.hooks as Record<string, Array<{ matcher: string; hooks: Array<{ command?: string; type: string }> }>>;

  for (const [event, newMatchers] of Object.entries(hookSettings.hooks)) {
    if (!hooks[event]) hooks[event] = [];

    // Remove existing OpenWolf hook entries
    hooks[event] = hooks[event].filter((entry) => {
      const isOpenWolfHook = entry.hooks?.some(
        (h) => h.command && h.command.includes(".wolf/hooks/")
      );
      return !isOpenWolfHook;
    });

    // Add new OpenWolf hooks
    for (const matcher of newMatchers) {
      hooks[event].push(matcher);
    }
  }

  return merged;
}

/**
 * List all registered projects (for `openwolf update --list`)
 */
export function listProjects(): void {
  const projects = getRegisteredProjects(true);

  if (projects.length === 0) {
    console.log("No registered OpenWolf projects.");
    console.log("Run 'openwolf init' in a project directory to register it.");
    return;
  }

  console.log(`Registered OpenWolf projects (${projects.length}):\n`);
  for (const p of projects) {
    const age = Math.floor((Date.now() - new Date(p.last_updated).getTime()) / (1000 * 60 * 60 * 24));
    console.log(`  ${p.name}`);
    console.log(`    Path: ${p.root}`);
    console.log(`    Version: ${p.version} | Updated: ${age}d ago`);
    console.log("");
  }
}

/**
 * Restore a project's .wolf from a backup
 */
export function restoreCommand(backupName?: string): void {
  const wolfDir = path.join(process.cwd(), ".wolf");
  const backupsDir = path.join(wolfDir, "backups");

  if (!fs.existsSync(backupsDir)) {
    console.log("No backups found for this project.");
    return;
  }

  const backups = fs.readdirSync(backupsDir)
    .filter(d => fs.statSync(path.join(backupsDir, d)).isDirectory())
    .sort()
    .reverse();

  if (backups.length === 0) {
    console.log("No backups found.");
    return;
  }

  if (!backupName) {
    console.log(`Available backups (${backups.length}):\n`);
    for (const b of backups) {
      const files = fs.readdirSync(path.join(backupsDir, b)).filter(f => !fs.statSync(path.join(backupsDir, b, f)).isDirectory());
      console.log(`  ${b} (${files.length} files)`);
    }
    console.log(`\nTo restore: openwolf restore <backup-name>`);
    return;
  }

  const backupDir = path.join(backupsDir, backupName);
  if (!fs.existsSync(backupDir)) {
    console.log(`Backup "${backupName}" not found.`);
    return;
  }

  // Restore files
  const files = fs.readdirSync(backupDir).filter(f => fs.statSync(path.join(backupDir, f)).isFile());
  for (const file of files) {
    safeCopyFile(path.join(backupDir, file), path.join(wolfDir, file));
  }

  // Restore hooks if present
  const hooksBackup = path.join(backupDir, "hooks");
  if (fs.existsSync(hooksBackup)) {
    const hookFiles = fs.readdirSync(hooksBackup);
    const hooksDir = path.join(wolfDir, "hooks");
    ensureDir(hooksDir);
    for (const f of hookFiles) {
      safeCopyFile(path.join(hooksBackup, f), path.join(hooksDir, f));
    }
  }

  // Restore .claude settings if present
  const claudeBackup = path.join(backupDir, ".claude");
  if (fs.existsSync(claudeBackup)) {
    const projectRoot = path.dirname(wolfDir);
    const settingsBackup = path.join(claudeBackup, "settings.json");
    if (fs.existsSync(settingsBackup)) {
      const dest = path.join(projectRoot, ".claude", "settings.json");
      ensureDir(path.dirname(dest));
      safeCopyFile(settingsBackup, dest);
    }
    const rulesBackup = path.join(claudeBackup, "rules", "openwolf.md");
    if (fs.existsSync(rulesBackup)) {
      const dest = path.join(projectRoot, ".claude", "rules", "openwolf.md");
      ensureDir(path.dirname(dest));
      safeCopyFile(rulesBackup, dest);
    }
  }

  console.log(`Restored ${files.length} files from backup "${backupName}".`);
}
