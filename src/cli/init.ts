import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, execSync } from "node:child_process";
import { findProjectRoot } from "../scanner/project-root.js";
import { scanProject } from "../scanner/anatomy-scanner.js";
import { readJSON, writeJSON, readText, writeText, safeCopyFile } from "../utils/fs-safe.js";
import { ensureDir } from "../utils/paths.js";
import { isWindows } from "../utils/platform.js";
import { registerProject, getRegisteredProjects } from "./registry.js";
import { resolveAgents, detectInstalledAgents } from "../agents/index.js";
import { installSkills } from "../agents/skills.js";
import { newStore, importFromMarkdown, saveStore, loadStore, STORE_FILE, sha256 as storeSha256 } from "../hooks/anatomy-store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read version from package.json
function getVersion(): string {
  try {
    const pkgPath = path.resolve(__dirname, "../../../package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    return pkg.version || "unknown";
  } catch {
    return "unknown";
  }
}

// Files that are safe to overwrite on upgrade (protocol docs only, not user data).
// NOTE: config.json is deliberately NOT here. It holds per-project port
// assignments (openwolf.daemon.port / openwolf.dashboard.port) and other
// user tunables; overwriting it on re-init resets every project to the same
// default ports (18790 / 18791), so only the first daemon to start can bind
// and the rest crash-loop on EADDRINUSE. It is handled by reconcileConfig().
const ALWAYS_OVERWRITE = [
  "OPENWOLF.md",
  "reframe-frameworks.md",
];

// Files that contain user/session data — only create if missing, never overwrite
const CREATE_IF_MISSING = [
  "identity.md",
  "cerebrum.md",
  "memory.md",
  "anatomy.md",
  "STATUS.md",
  "token-ledger.json",
  "buglog.json",
  "cron-manifest.json",
  "cron-state.json",
  "suggestions.json",
];

// Use $CLAUDE_PROJECT_DIR so hooks resolve correctly even if CWD changes during a session
const HOOK_SETTINGS = {
  hooks: {
    SessionStart: [
      {
        matcher: "",
        hooks: [
          {
            type: "command",
            command: 'node "$CLAUDE_PROJECT_DIR/.wolf/hooks/session-start.js"',
            timeout: 5,
          },
        ],
      },
    ],
    PreToolUse: [
      {
        matcher: "Read",
        hooks: [
          {
            type: "command",
            command: 'node "$CLAUDE_PROJECT_DIR/.wolf/hooks/pre-read.js"',
            timeout: 5,
          },
        ],
      },
      {
        matcher: "Write|Edit|MultiEdit",
        hooks: [
          {
            type: "command",
            command: 'node "$CLAUDE_PROJECT_DIR/.wolf/hooks/pre-write.js"',
            timeout: 5,
          },
        ],
      },
    ],
    PostToolUse: [
      {
        matcher: "Read",
        hooks: [
          {
            type: "command",
            command: 'node "$CLAUDE_PROJECT_DIR/.wolf/hooks/post-read.js"',
            timeout: 5,
          },
        ],
      },
      {
        matcher: "Write|Edit|MultiEdit",
        hooks: [
          {
            type: "command",
            command: 'node "$CLAUDE_PROJECT_DIR/.wolf/hooks/post-write.js"',
            timeout: 10,
          },
        ],
      },
    ],
    PreCompact: [
      {
        matcher: "",
        hooks: [
          {
            type: "command",
            command: 'node "$CLAUDE_PROJECT_DIR/.wolf/hooks/precompact.js"',
            timeout: 5,
          },
        ],
      },
    ],
    Stop: [
      {
        matcher: "",
        hooks: [
          {
            type: "command",
            command: 'node "$CLAUDE_PROJECT_DIR/.wolf/hooks/stop.js"',
            timeout: 10,
          },
        ],
      },
    ],
  },
};

export async function initCommand(options?: { agent?: string[] }): Promise<void> {
  // Check Node.js version
  const nodeVersion = parseInt(process.version.slice(1), 10);
  if (nodeVersion < 20) {
    console.error(`Node.js 20+ required. Current: ${process.version}`);
    process.exit(1);
  }

  // Detect project root
  const projectRoot = findProjectRoot();
  console.log(`Project root: ${projectRoot}`);

  const wolfDir = path.join(projectRoot, ".wolf");
  const isUpgrade = fs.existsSync(wolfDir);

  const version = getVersion();

  if (isUpgrade) {
    console.log(`Upgrading OpenWolf to v${version}...`);
  }

  // Create .wolf/ directory
  ensureDir(wolfDir);
  ensureDir(path.join(wolfDir, "hooks"));

  // Find templates directory
  const actualTemplatesDir = findTemplatesDir();

  // --- Template files ---
  let createdCount = 0;
  let skippedCount = 0;

  for (const file of ALWAYS_OVERWRITE) {
    writeTemplateFile(actualTemplatesDir, wolfDir, file);
    createdCount++;
  }

  const newlyCreated = new Set<string>();
  for (const file of CREATE_IF_MISSING) {
    const destPath = path.join(wolfDir, file);
    if (fs.existsSync(destPath)) {
      skippedCount++;
    } else {
      writeTemplateFile(actualTemplatesDir, wolfDir, file);
      createdCount++;
      newlyCreated.add(file);
    }
  }

  // config.json: create-if-missing, and on a fresh create allocate a port
  // pair that no other registered project is using. Existing configs keep
  // their ports untouched so a re-init never resets them.
  if (reconcileConfig(actualTemplatesDir, wolfDir, projectRoot)) {
    createdCount++;
  } else {
    skippedCount++;
  }

  // --- Cerebrum: seed project info only if fresh ---
  if (!isUpgrade) {
    seedCerebrum(wolfDir, projectRoot);
    seedIdentity(wolfDir, projectRoot);
  }

  // --- STATUS.md: substitute {{PROJECT_NAME}} / {{DATE}} when freshly created ---
  if (newlyCreated.has("STATUS.md")) {
    seedStatus(wolfDir, projectRoot);
  }

  // --- Token ledger: set created_at only if empty ---
  const ledgerPath = path.join(wolfDir, "token-ledger.json");
  const ledger = readJSON<Record<string, unknown>>(ledgerPath, {});
  if (!ledger.created_at) {
    ledger.created_at = new Date().toISOString();
    writeJSON(ledgerPath, ledger);
  }

  // --- Hook scripts: always update (bug fixes, new features) ---
  copyHookScripts(wolfDir);

  // --- Claude settings: replace OpenWolf hooks (upgrade old paths) ---
  const claudeDir = path.join(projectRoot, ".claude");
  ensureDir(claudeDir);

  const settingsPath = path.join(claudeDir, "settings.json");
  if (fs.existsSync(settingsPath)) {
    const existing = readJSON<Record<string, unknown>>(settingsPath, {});
    const merged = replaceOpenWolfHooks(existing, HOOK_SETTINGS);
    writeJSON(settingsPath, merged);
  } else {
    writeJSON(settingsPath, HOOK_SETTINGS);
  }

  // --- Claude rules: always update ---
  const rulesDir = path.join(claudeDir, "rules");
  ensureDir(rulesDir);
  const rulesContent = readTemplateContent("claude-rules-openwolf.md", actualTemplatesDir);
  writeText(path.join(rulesDir, "openwolf.md"), rulesContent);

  // --- CLAUDE.md: add snippet if missing ---
  const claudeMdPath = path.join(projectRoot, "CLAUDE.md");
  const snippetContent = readTemplateContent("claude-md-snippet.md", actualTemplatesDir);
  if (fs.existsSync(claudeMdPath)) {
    const existing = readText(claudeMdPath);
    if (!existing.includes("OpenWolf")) {
      writeText(claudeMdPath, snippetContent + "\n\n" + existing);
    }
  } else {
    writeText(claudeMdPath, snippetContent);
  }

  // --- One-time anatomy store migration for upgrades (F2b) ---
  if (isUpgrade) {
    try {
      if (!fs.existsSync(path.join(wolfDir, STORE_FILE))) {
        const md = readText(path.join(wolfDir, "anatomy.md"));
        if (md) {
          const store = newStore();
          importFromMarkdown(store, md, projectRoot);
          store.meta.renderedHash = storeSha256(md);
          saveStore(wolfDir, store);
          console.log(`  ✓ anatomy-index.json created (migrated from anatomy.md)`);
        }
      }
    } catch {}
  }

  // --- Daemon ---
  let daemonStatus = "start manually with: openwolf daemon start";
  try {
    execFileSync(isWindows() ? "where" : "which", ["pm2"], { stdio: "ignore" });
    const name = `openwolf-${path.basename(projectRoot).replace(/[^a-zA-Z0-9._-]/g, "-")}`;
    // Resolve daemon script relative to openwolf's install dir, not the target project
    const daemonScript = path.resolve(__dirname, "..", "daemon", "wolf-daemon.js");
    try {
      execFileSync(isWindows() ? "pm2.cmd" : "pm2", ["start", daemonScript, "--name", name, "--cwd", projectRoot], {
        stdio: "ignore",
        env: { ...process.env, OPENWOLF_PROJECT_ROOT: projectRoot },
      });
      execFileSync(isWindows() ? "pm2.cmd" : "pm2", ["save"], { stdio: "ignore" });
      daemonStatus = "running via pm2";
    } catch {
      daemonStatus = "pm2 found but daemon start failed. Try: openwolf daemon start";
    }
  } catch {
    daemonStatus = "pm2 not found. Install with: pnpm add -g pm2";
  }

  // --- Register in central registry (skip if this IS the openwolf source repo) ---
  try {
    const projectName = detectProjectName(projectRoot);
    if (projectName === "openwolf") {
      // Don't register the openwolf dev repo — it would get updated by `openwolf update`
    } else {
      registerProject(projectRoot, projectName, version);
    }
  } catch {
    // Non-fatal — registry is a convenience feature
  }

  // --- Additional agents (Workstream C): codex / opencode / gemini / cursor ---
  // No --agent flag → auto-detect what's installed on this machine and wire
  // only that. `--agent claude` opts out; explicit names override detection.
  let agentNames = options?.agent ?? [];
  let autoDetected = false;
  if (agentNames.length === 0) {
    agentNames = detectInstalledAgents();
    autoDetected = agentNames.length > 0;
  }
  const installedAgents: string[] = ["claude"];
  if (agentNames.length > 0) {
    if (autoDetected) {
      console.log(`  ✓ Agents detected on this machine: ${agentNames.join(", ")} (auto-wiring; use --agent claude to skip)`);
    }
    const adapters = resolveAgents(agentNames); // throws on unknown names
    const ctx = { projectRoot, wolfDir, templatesDir: actualTemplatesDir };
    for (const adapter of adapters) {
      const result = adapter.install(ctx);
      installedAgents.push(adapter.name);
      for (const line of result.actions) console.log(`  ✓ ${line}`);
      for (const warn of result.warnings) console.log(`  ⚠ ${adapter.displayName}: ${warn}`);
    }
  }
  // Record which agents are wired up so `openwolf update`/dashboard know.
  try {
    const cfgPath = path.join(wolfDir, "config.json");
    const cfg = readJSON<any>(cfgPath, null as any);
    if (cfg && cfg.openwolf) {
      cfg.openwolf.agents = installedAgents;
      writeJSON(cfgPath, cfg);
    }
  } catch {}

  // --- Bundled skills (Workstream H): /security-audit, /reframe ---
  try {
    for (const line of installSkills(projectRoot, actualTemplatesDir, installedAgents)) {
      console.log(`  ✓ ${line}`);
    }
  } catch {}

  // --- Anatomy scan: runs LAST so the index reflects everything init created ---
  let fileCount = 0;
  if (!isUpgrade) {
    try {
      fileCount = scanProject(wolfDir, projectRoot);
    } catch {
      console.log("  Anatomy scan deferred — will run on first session.");
    }
  } else {
    const store = loadStore(wolfDir);
    if (store) {
      fileCount = Object.keys(store.files).length;
    } else {
      const m = readText(path.join(wolfDir, "anatomy.md")).match(/Files:\s*(\d+)/);
      if (m) fileCount = parseInt(m[1], 10);
    }
  }

  // --- Summary ---
  console.log("");
  if (isUpgrade) {
    console.log(`  ✓ OpenWolf upgraded to v${version}`);
    console.log(`  ✓ All .wolf data preserved (${skippedCount} files: cerebrum, memory, anatomy, buglog, ledger)`);
    console.log(`  ✓ Hook scripts updated (7 hooks)`);
    console.log(`  ✓ ${createdCount} config files updated`);
    console.log(`  ✓ Anatomy: ${fileCount} files tracked (unchanged)`);
  } else {
    console.log(`  ✓ OpenWolf v${version} initialized`);
    console.log(`  ✓ .wolf/ created with ${createdCount} files`);
    console.log(`  ✓ Claude Code hooks registered (7 hooks)`);
    console.log(`  ✓ CLAUDE.md updated`);
    console.log(`  ✓ .claude/rules/openwolf.md created`);
    console.log(`  ✓ Anatomy scan: ${fileCount} files indexed`);
  }
  console.log(`  ✓ Daemon: ${daemonStatus}`);
  console.log("");
  console.log("  You're ready. Just use 'claude' as normal — OpenWolf is watching.");
  console.log("");
}

// ─── Helpers ─────────────────────────────────────────────────

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
  return candidates[0]; // fallback — generateTemplate will handle missing files
}

function writeTemplateFile(templatesDir: string, wolfDir: string, file: string): void {
  const srcPath = path.join(templatesDir, file);
  const destPath = path.join(wolfDir, file);
  if (fs.existsSync(srcPath)) {
    safeCopyFile(srcPath, destPath);
  } else {
    generateTemplate(destPath, file);
  }
}

// Default daemon/dashboard ports. A fresh project is allocated the next free
// pair so multiple projects' daemons never collide on the same port.
const DEFAULT_DAEMON_PORT = 18790;
const DEFAULT_DASHBOARD_PORT = 18791;

function normalizeRoot(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

// Ports already claimed by OTHER registered projects' config.json files.
function collectUsedPorts(excludeRoot: string): Set<number> {
  const used = new Set<number>();
  const exclude = normalizeRoot(excludeRoot);
  for (const proj of getRegisteredProjects(false)) {
    if (normalizeRoot(proj.root) === exclude) continue;
    const cfg = readJSON<any>(path.join(proj.root, ".wolf", "config.json"), null as any);
    const ow = cfg && cfg.openwolf;
    if (ow) {
      if (ow.daemon && typeof ow.daemon.port === "number") used.add(ow.daemon.port);
      if (ow.dashboard && typeof ow.dashboard.port === "number") used.add(ow.dashboard.port);
    }
  }
  return used;
}

// config.json is user data: created from template only when absent, and on
// that fresh create it is stamped with a port pair no other registered
// project uses. An existing config is left completely untouched so a re-init
// never resets its ports. Returns true if a new file was written.
function reconcileConfig(templatesDir: string, wolfDir: string, projectRoot: string): boolean {
  const cfgPath = path.join(wolfDir, "config.json");
  if (fs.existsSync(cfgPath)) {
    return false; // preserve existing ports + user tunables
  }
  writeTemplateFile(templatesDir, wolfDir, "config.json");
  const cfg = readJSON<any>(cfgPath, null as any);
  if (cfg && cfg.openwolf && cfg.openwolf.dashboard) {
    const used = collectUsedPorts(projectRoot);
    const nextFree = (base: number): number => {
      let p = base;
      while (used.has(p)) p++;
      used.add(p);
      return p;
    };
    cfg.openwolf.daemon = cfg.openwolf.daemon || {};
    cfg.openwolf.dashboard = cfg.openwolf.dashboard || {};
    cfg.openwolf.daemon.port = nextFree(DEFAULT_DAEMON_PORT);
    cfg.openwolf.dashboard.port = nextFree(DEFAULT_DASHBOARD_PORT);
    writeJSON(cfgPath, cfg);
  }
  return true;
}

function readTemplateContent(filename: string, templatesDir: string): string {
  const filePath = path.join(templatesDir, filename);
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, "utf-8");
  }
  return getEmbeddedTemplate(filename);
}

function getEmbeddedTemplate(filename: string): string {
  const templates: Record<string, string> = {
    "claude-md-snippet.md": `# OpenWolf\n\n@.wolf/OPENWOLF.md\n\nThis project uses OpenWolf for context management. Read and follow .wolf/OPENWOLF.md every session. Check .wolf/cerebrum.md before generating code. Check .wolf/anatomy.md before reading files.`,
    "claude-rules-openwolf.md": `---\ndescription: OpenWolf protocol enforcement — active on all files\nglobs: **/*\n---\n\n- Read .wolf/STATUS.md FIRST when resuming a session — it contains current quest, next steps, decisions\n- Update .wolf/STATUS.md (✅ done / 🚀 next quest) when a quest finishes or before suggesting /clear\n- Check .wolf/anatomy.md before reading any project file\n- Check .wolf/cerebrum.md Do-Not-Repeat list before generating code\n- After writing or editing files, update .wolf/anatomy.md and append to .wolf/memory.md\n- After receiving a user correction, update .wolf/cerebrum.md immediately (Preferences, Learnings, or Do-Not-Repeat)\n- LEARN from every interaction: if you discover a convention, user preference, or project pattern, add it to .wolf/cerebrum.md. Low threshold — when in doubt, log it.\n- BEFORE fixing any bug or error: read .wolf/buglog.json for known fixes\n- AFTER fixing any bug, error, failed test, failed build, or user-reported problem: ALWAYS log to .wolf/buglog.json with error_message, root_cause, fix, and tags\n- If you edit a file more than twice in a session, that likely indicates a bug — log it to .wolf/buglog.json\n- When the user asks to change/pick/migrate UI framework: read .wolf/reframe-frameworks.md, ask decision questions, recommend a framework, then execute with the framework's prompt`,
  };
  return templates[filename] ?? "";
}

function generateTemplate(destPath: string, file: string): void {
  const templates: Record<string, string> = {
    "OPENWOLF.md": `# OpenWolf Operating Protocol\n\nYou are working in an OpenWolf-managed project. These rules apply every turn.\n\n## File Navigation\n\n1. Check \`.wolf/anatomy.md\` BEFORE reading any file.\n2. If the description is sufficient, do NOT read the full file.\n3. If a file is not in anatomy.md, search with Grep/Glob.\n\n## Code Generation\n\n1. Read \`.wolf/cerebrum.md\` and respect every entry.\n2. Check \`## Do-Not-Repeat\` section.\n\n## After Actions\n\n1. Append to \`.wolf/memory.md\`.\n2. After file changes: update \`.wolf/anatomy.md\`.\n\n## Token Discipline\n\n- Never re-read a file already read this session.\n- Prefer anatomy.md descriptions over full reads.\n`,
    "identity.md": `# Identity\n\n- **Name:** Wolf\n- **Role:** AI development assistant for this project\n- **Tone:** Direct, concise, technically precise\n`,
    "cerebrum.md": `# Cerebrum\n\n> OpenWolf's learning memory.\n\n## User Preferences\n\n## Key Learnings\n\n## Do-Not-Repeat\n\n## Decision Log\n`,
    "memory.md": `# Memory\n\n> Chronological action log.\n`,
    "anatomy.md": `# anatomy.md\n\n> Project structure index. Pending initial scan.\n`,
    "STATUS.md": `# STATUS\n\n> Single source of truth for resuming work. Read this FIRST when starting a session.\n> Update at the end of every work phase so the next \`/clear\` resumes in 1 read.\n\n---\n\n## ✅ Done\n\n- (nothing yet — fill in as work completes)\n\n---\n\n## 🚀 Next phase\n\n**Goal:** _<what we're building next>_\n\n### Acceptance criteria\n1. _<concrete user-visible outcome>_\n\n### Files to create / edit\n- _<path + purpose>_\n\n### Open decisions\n- _<question to ask before coding>_\n\n---\n\n## 📁 Active architecture\n\n- **Stack:** _<frameworks>_\n\n---\n\n## 🔧 Useful commands\n\n\`\`\`bash\n# add the most-used commands here\n\`\`\`\n`,
    "config.json": JSON.stringify({
      version: 1,
      openwolf: {
        enabled: true,
        anatomy: { auto_scan_on_init: true, rescan_interval_hours: 6, max_description_length: 100, max_files: 500, exclude_patterns: ["node_modules", ".git", "dist", "build", ".wolf", ".next", ".nuxt", "coverage", "__pycache__", ".cache", "target", ".vscode", ".idea", ".turbo", ".vercel", ".netlify", ".output", "*.min.js", "*.min.css"] },
        token_audit: { enabled: true, report_frequency: "weekly", waste_threshold_percent: 15, chars_per_token_code: 3.5, chars_per_token_prose: 4.0 },
        cron: { enabled: true, max_retry_attempts: 3, dead_letter_enabled: true, heartbeat_interval_minutes: 30, use_claude_p: true, api_key_env: null },
        memory: { consolidation_after_days: 7, max_entries_before_consolidation: 200 },
        cerebrum: { max_tokens: 2000, reflection_frequency: "weekly" },
        context: { session_digest_budget_tokens: 1500, budgets: { claude: 1500, codex: 1200, gemini: 1200, opencode: 1200, cursor: 800 } },
        daemon: { port: 18790, log_level: "info" },
        dashboard: { enabled: true, port: 18791, host: "127.0.0.1" },
        buglog: { auto_detect: true },
      },
    }, null, 2),
    "token-ledger.json": JSON.stringify({ version: 1, created_at: "", lifetime: { total_tokens_estimated: 0, total_reads: 0, total_writes: 0, total_sessions: 0, anatomy_hits: 0, anatomy_misses: 0, repeated_reads_blocked: 0, estimated_savings_vs_bare_cli: 0 }, sessions: [], daemon_usage: [], waste_flags: [], optimization_report: { last_generated: null, patterns: [] } }, null, 2),
    "buglog.json": JSON.stringify({ version: 1, bugs: [] }, null, 2),
    "cron-manifest.json": JSON.stringify({ version: 1, tasks: [] }, null, 2),
    "cron-state.json": JSON.stringify({ last_heartbeat: null, engine_status: "initialized", execution_log: [], dead_letter_queue: [], upcoming: [] }, null, 2),
    "suggestions.json": JSON.stringify({ suggestions: [], generated_at: null }, null, 2),
  };

  const content = templates[file] ?? "";
  fs.writeFileSync(destPath, content, "utf-8");
}

function seedCerebrum(wolfDir: string, projectRoot: string): void {
  const projectName = detectProjectName(projectRoot);
  const projectDescription = detectProjectDescription(projectRoot);
  if (!projectName && !projectDescription) return;

  const cerebrumPath = path.join(wolfDir, "cerebrum.md");
  let cerebrum = readText(cerebrumPath);
  const projectInfo = [
    `- **Project:** ${projectName || path.basename(projectRoot)}`,
    projectDescription ? `- **Description:** ${projectDescription}` : "",
  ].filter(Boolean).join("\n");

  // Insert after ## Key Learnings section
  cerebrum = cerebrum.replace(
    /## Key Learnings\n\n<!-- Project-specific conventions discovered during development\. -->/,
    `## Key Learnings\n\n${projectInfo}`
  );
  // Fallback: if the comment wasn't found (embedded template), try simpler pattern
  if (!cerebrum.includes("**Project:**")) {
    cerebrum = cerebrum.replace(
      /## Key Learnings\n/,
      `## Key Learnings\n\n${projectInfo}\n`
    );
  }
  cerebrum = cerebrum.replace(/Last updated: —/, `Last updated: ${new Date().toISOString().slice(0, 10)}`);
  writeText(cerebrumPath, cerebrum);
}

function seedStatus(wolfDir: string, projectRoot: string): void {
  const statusPath = path.join(wolfDir, "STATUS.md");
  if (!fs.existsSync(statusPath)) return;

  const projectName = detectProjectName(projectRoot) || path.basename(projectRoot);
  const date = new Date().toISOString().slice(0, 10);

  let content = readText(statusPath);
  content = content.replace(/\{\{PROJECT_NAME\}\}/g, projectName);
  content = content.replace(/\{\{DATE\}\}/g, date);
  writeText(statusPath, content);
}

function seedIdentity(wolfDir: string, projectRoot: string): void {
  const projectName = detectProjectName(projectRoot);
  if (!projectName) return;

  const identityPath = path.join(wolfDir, "identity.md");
  let content = readText(identityPath);
  content = content.replace(/\*\*Name:\*\* Wolf/, `**Name:** ${projectName}`);
  content = content.replace(
    /\*\*Role:\*\* AI development assistant for this project/,
    `**Role:** AI development assistant for ${projectName}`
  );
  writeText(identityPath, content);
}

function copyHookScripts(wolfDir: string): void {
  const hooksDir = path.join(wolfDir, "hooks");
  ensureDir(hooksDir);

  // Look for compiled hooks in multiple possible locations relative to __dirname
  // __dirname at runtime is dist/src/cli/ so ../hooks = dist/src/hooks/
  const candidates = [
    path.join(__dirname, "..", "hooks"),           // dist/src/hooks (from tsc main build)
    path.resolve(__dirname, "..", "..", "hooks"),   // dist/hooks (from tsconfig.hooks.json)
    path.resolve(__dirname, "..", "..", "dist", "hooks"), // fallback
  ];
  const srcHooksDir = path.resolve(__dirname, "..", "..", "src", "hooks");

  let sourceDir = "";
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, "shared.js"))) {
      sourceDir = candidate;
      break;
    }
  }

  const hookFiles = [
    "session-start.js",
    "pre-read.js",
    "pre-write.js",
    "post-read.js",
    "post-write.js",
    "precompact.js",
    "stop.js",
    "shared.js",
    "anatomy-store.js",
    "anatomy-lock.js",
  ];

  let copiedAny = false;
  if (sourceDir) {
    for (const file of hookFiles) {
      const src = path.join(sourceDir, file);
      if (fs.existsSync(src)) {
        safeCopyFile(src, path.join(hooksDir, file));
        copiedAny = true;
      }
    }
  } else if (fs.existsSync(srcHooksDir)) {
    // Dev mode: compile TS hooks inline using a simple copy with note
    // In practice, user should run `pnpm build:hooks` first
    for (const file of hookFiles) {
      const tsFile = file.replace(".js", ".ts");
      const src = path.join(srcHooksDir, tsFile);
      if (fs.existsSync(src)) {
        const loaderContent = `#!/usr/bin/env node\n// Auto-generated by openwolf init — run 'pnpm build:hooks' for compiled version\nimport("${src.replace(/\\/g, "/")}");\n`;
        fs.writeFileSync(path.join(hooksDir, file), loaderContent, "utf-8");
        copiedAny = true;
      }
    }
  }

  if (!copiedAny) {
    console.warn("  ⚠ Could not find compiled hook scripts. Run 'pnpm build:hooks' and re-run init.");
  }

  // Always write a package.json with type:module so ESM hooks work in any project
  const hooksPkgPath = path.join(hooksDir, "package.json");
  fs.writeFileSync(hooksPkgPath, JSON.stringify({ type: "module" }, null, 2) + "\n", "utf-8");
}

/**
 * Replace all OpenWolf hook entries in settings.json with the current version.
 * Removes old-style relative-path hooks and inserts the new $CLAUDE_PROJECT_DIR hooks.
 * Preserves any non-OpenWolf hooks the user may have added.
 */
function replaceOpenWolfHooks(
  existing: Record<string, unknown>,
  hookSettings: typeof HOOK_SETTINGS
): Record<string, unknown> {
  const merged = { ...existing };
  if (!merged.hooks) {
    merged.hooks = {};
  }
  const hooks = merged.hooks as Record<string, Array<{ matcher: string; hooks: Array<{ command?: string; type: string }> }>>;

  for (const [event, newMatchers] of Object.entries(hookSettings.hooks)) {
    if (!hooks[event]) {
      hooks[event] = [];
    }

    // Remove any existing OpenWolf hook entries (match by .wolf/hooks/ in command)
    hooks[event] = hooks[event].filter((entry) => {
      const isOpenWolfHook = entry.hooks?.some(
        (h) => h.command && h.command.includes(".wolf/hooks/")
      );
      return !isOpenWolfHook;
    });

    // Add the new OpenWolf hooks
    for (const matcher of newMatchers) {
      hooks[event].push(matcher);
    }
  }

  return merged;
}

function detectProjectName(projectRoot: string): string {
  // Try package.json
  const pkgPath = path.join(projectRoot, "package.json");
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    if (pkg.name) return pkg.name;
  } catch {}
  // Try Cargo.toml
  try {
    const cargo = fs.readFileSync(path.join(projectRoot, "Cargo.toml"), "utf-8");
    const m = cargo.match(/^name\s*=\s*"([^"]+)"/m);
    if (m) return m[1];
  } catch {}
  // Try pyproject.toml
  try {
    const py = fs.readFileSync(path.join(projectRoot, "pyproject.toml"), "utf-8");
    const m = py.match(/^name\s*=\s*"([^"]+)"/m);
    if (m) return m[1];
  } catch {}
  return path.basename(projectRoot);
}

function detectProjectDescription(projectRoot: string): string {
  // Try package.json
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8"));
    if (pkg.description) return pkg.description;
  } catch {}
  // Try README first line/paragraph
  for (const readme of ["README.md", "readme.md", "README.rst", "README.txt"]) {
    try {
      const content = fs.readFileSync(path.join(projectRoot, readme), "utf-8");
      const lines = content.split("\n").filter(l => l.trim() && !l.startsWith("#") && !l.startsWith("=") && !l.startsWith("-") && !l.startsWith("!["));
      if (lines.length > 0) return lines[0].trim().slice(0, 200);
    } catch {}
  }
  return "";
}
