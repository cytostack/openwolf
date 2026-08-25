import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import type { SessionData } from "./ledger-math.js";

// Prefer the harness-provided project dir so hooks work even if CWD changes
// during a session. Each supported agent exposes its own env var; hooks are
// provider-agnostic (Workstream C) so all are checked.
//
// None of those vars are guaranteed. Codex runs command hooks from the active
// request cwd, so its nearest .wolf ancestor must win over a copied script's
// installation root. Script location and legacy provider vars remain fallbacks.
function projectDirFromCwd(): string | null {
  try {
    let current = fs.realpathSync.native(process.cwd());
    while (true) {
      const wolfDir = path.join(current, ".wolf");
      if (fs.existsSync(wolfDir) && fs.statSync(wolfDir).isDirectory()) return current;
      const parent = path.dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  } catch {
    return null;
  }
}

function projectDirFromScriptLocation(): string | null {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    if (path.basename(here) !== "hooks") return null;
    const root = path.resolve(here, "..", "..");
    if (path.basename(path.dirname(here)) !== ".wolf") return null;
    return fs.existsSync(path.join(root, ".wolf")) ? root : null;
  } catch {
    return null;
  }
}

export function getProjectDir(): string {
  return (
    process.env.CLAUDE_PROJECT_DIR ||
    projectDirFromCwd() ||
    projectDirFromScriptLocation() ||
    process.env.CODEX_PROJECT_ROOT ||
    process.env.OPENWOLF_PROJECT_ROOT ||
    process.cwd()
  );
}

export function getWolfDir(): string {
  return path.join(getProjectDir(), ".wolf");
}

/** Which agent harness invoked this hook — used for per-agent ledger attribution. */
export function detectAgent(): string {
  // CLAUDECODE is set in every Claude Code hook process; CLAUDE_PROJECT_DIR is
  // not set at all, so checking it alone attributed real Claude sessions to
  // "default" and lost their per-agent ledger rows.
  if (process.env.CLAUDECODE || process.env.CLAUDE_CODE_ENTRYPOINT || process.env.CLAUDE_PROJECT_DIR) return "claude";
  if (process.env.CODEX_PROJECT_ROOT || process.env.CODEX_SANDBOX) return "codex";
  if (process.env.OPENCODE || process.env.OPENCODE_PROJECT_ROOT) return "opencode";
  return "default";
}

/**
 * Bail out silently if .wolf/ directory doesn't exist in the current project.
 * Call this at the top of every hook to avoid crashes in non-OpenWolf projects.
 */
export function ensureWolfDir(): void {
  const wolfDir = getWolfDir();
  if (!fs.existsSync(wolfDir)) {
    process.exit(0);
  }
}

// ─── Hook health (2.2): heartbeat + crash recording ──────────────────────────
// The PostToolUse write hook crashed on 100% of 440 invocations for 3 weeks
// with nothing noticing, because every hook swallowed its own errors
// (main().catch(() => exit(0))). Every hook now runs through hookMain(), which
// records a per-hook heartbeat (last success / last error / consecutive
// failures) that session-start, update, and the dashboard can check.

export const HEARTBEAT_FILE = "_heartbeat.json";

interface HeartbeatEntry {
  last_ok?: string;
  last_error?: string;
  last_error_message?: string;
  consecutive_failures: number;
}

export function recordHeartbeat(hookName: string, error?: unknown): void {
  try {
    const file = path.join(getWolfDir(), "hooks", HEARTBEAT_FILE);
    const beats = readJSON<Record<string, HeartbeatEntry>>(file, {});
    const entry = beats[hookName] ?? { consecutive_failures: 0 };
    if (error === undefined) {
      entry.last_ok = new Date().toISOString();
      entry.consecutive_failures = 0;
    } else {
      entry.last_error = new Date().toISOString();
      entry.last_error_message = String(error instanceof Error ? error.stack ?? error.message : error).slice(0, 500);
      entry.consecutive_failures = (entry.consecutive_failures ?? 0) + 1;
    }
    beats[hookName] = entry;
    writeJSON(file, beats);
  } catch {}
}

/**
 * Standard hook entry point: runs the hook, records a heartbeat either way,
 * always exits 0 (hooks must never block the agent). `--selfcheck` exits
 * immediately after module load: reaching this code at all proves every static
 * import resolved, which is exactly the failure class that went undetected.
 */
export function hookMain(hookName: string, fn: () => void | Promise<void>): void {
  if (process.argv.includes("--selfcheck")) {
    process.stdout.write(`ok ${hookName}`);
    process.exit(0);
  }
  Promise.resolve()
    .then(fn)
    .then(() => {
      recordHeartbeat(hookName);
      process.exit(0);
    })
    .catch((err) => {
      recordHeartbeat(hookName, err);
      process.exit(0);
    });
}

// ─── Session-keyed state (2.2) ───────────────────────────────────────────────
// _session.json used to be one per-PROJECT file, so concurrent Claude sessions
// cross-contaminated each other's read tracking (one of the two causes of the
// ledger's ~20x duplicate-warning inflation). State is now keyed by the
// harness-provided session_id when present.

/** Resolve the session state file for this hook invocation. */
export function getSessionFilePath(hookInput: { session_id?: string } | undefined): string {
  const hooksDir = path.join(getWolfDir(), "hooks");
  const id = hookInput?.session_id;
  if (typeof id === "string" && /^[\w.-]{4,128}$/.test(id)) {
    return path.join(hooksDir, "sessions", `${id}.json`);
  }
  // Legacy fallback for agents that pass no session id.
  return path.join(hooksDir, "_session.json");
}

/** Restore the complete SessionStart shape when a later hook arrives first. */
export function readSessionState(sessionFile: string, sessionId?: string): SessionData {
  const existing = readJSON<Partial<SessionData>>(sessionFile, {});
  const validSessionId = (value: unknown): value is string =>
    typeof value === "string" && /^[\w.-]{4,128}$/.test(value);
  const fileSessionId = path.basename(path.dirname(sessionFile)) === "sessions"
    ? path.basename(sessionFile, ".json")
    : "";
  const authoritativeSessionId = validSessionId(sessionId)
    ? sessionId
    : validSessionId(fileSessionId) ? fileSessionId : "";
  const session = {
    session_id: authoritativeSessionId,
    started: new Date().toISOString(),
    files_read: {},
    files_written: [],
    edit_counts: {},
    anatomy_hits: 0,
    anatomy_misses: 0,
    repeated_reads_warned: 0,
    stop_count: 0,
    reminders_sent: {},
    ...existing,
  };
  if (authoritativeSessionId) session.session_id = authoritativeSessionId;
  else if (!validSessionId(session.session_id)) session.session_id = "";
  if (typeof session.started !== "string" || !session.started) session.started = new Date().toISOString();
  if (!session.files_read || typeof session.files_read !== "object" || Array.isArray(session.files_read)) session.files_read = {};
  if (!Array.isArray(session.files_written)) session.files_written = [];
  session.files_read = Object.fromEntries(Object.entries(session.files_read).map(([file, value]) => {
    const read = value && typeof value === "object" ? value as unknown as Record<string, unknown> : {};
    return [file, {
      ...read,
      count: typeof read.count === "number" && Number.isFinite(read.count) && read.count >= 1 ? Math.floor(read.count) : 1,
      tokens: typeof read.tokens === "number" && Number.isFinite(read.tokens) && read.tokens >= 0 ? read.tokens : 0,
      first_read: typeof read.first_read === "string" && read.first_read ? read.first_read : session.started,
    }];
  })) as SessionData["files_read"];
  session.files_written = session.files_written.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const write = value as unknown as Record<string, unknown>;
    if (typeof write.file !== "string" || !write.file) return [];
    return [{
      ...write,
      file: write.file,
      action: typeof write.action === "string" && write.action ? write.action : "write",
      tokens: typeof write.tokens === "number" && Number.isFinite(write.tokens) && write.tokens >= 0 ? write.tokens : 0,
      at: typeof write.at === "string" && write.at ? write.at : session.started,
    }];
  }) as SessionData["files_written"];
  if (!session.edit_counts || typeof session.edit_counts !== "object" || Array.isArray(session.edit_counts)) session.edit_counts = {};
  if (typeof session.anatomy_hits !== "number" || !Number.isFinite(session.anatomy_hits)) session.anatomy_hits = 0;
  if (typeof session.anatomy_misses !== "number" || !Number.isFinite(session.anatomy_misses)) session.anatomy_misses = 0;
  if (typeof session.repeated_reads_warned !== "number" || !Number.isFinite(session.repeated_reads_warned)) session.repeated_reads_warned = 0;
  if (typeof session.stop_count !== "number" || !Number.isFinite(session.stop_count)) session.stop_count = 0;
  if (!session.reminders_sent || typeof session.reminders_sent !== "object" || Array.isArray(session.reminders_sent)) session.reminders_sent = {};
  return session;
}

/** Delete session state files older than maxAgeDays (called from session-start). */
export function gcSessionFiles(maxAgeDays = 7): void {
  try {
    const dir = path.join(getWolfDir(), "hooks", "sessions");
    const cutoff = Date.now() - maxAgeDays * 24 * 3600 * 1000;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      try {
        if (fs.statSync(path.join(dir, f)).mtimeMs < cutoff) fs.unlinkSync(path.join(dir, f));
      } catch {}
    }
  } catch {}
}

export function readJSON<T = unknown>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

/**
 * Reads .wolf/buglog.json in any shape a project might have on disk and always
 * returns { version, bugs }. A hand-written log is often a bare array of
 * entries; that shape used to reach `bugLog.bugs.length` and throw, which is
 * how pre-write racked up 465 consecutive failures on one project before
 * anyone noticed (the hook heartbeat was the only witness).
 */
export function readBugLogFile(wolfDir: string): { version: number; bugs: any[] } {
  const raw = readJSON<unknown>(path.join(wolfDir, "buglog.json"), null);
  if (Array.isArray(raw)) return { version: 1, bugs: raw };
  if (raw && typeof raw === "object") {
    const bugs = (raw as { bugs?: unknown }).bugs;
    if (Array.isArray(bugs)) return { ...(raw as object), version: 1, bugs } as { version: number; bugs: any[] };
  }
  return { version: 1, bugs: [] };
}

export function writeJSON(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmp, filePath);
  } catch {
    // On Windows, rename can fail if another process holds a handle.
    // Fall back to direct write and clean up the tmp file.
    try { fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8"); } catch {}
    try { fs.unlinkSync(tmp); } catch {}
  }
}

export function readMarkdown(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

export function appendMarkdown(filePath: string, line: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(filePath, line, "utf-8");
}

// parseAnatomy / serializeAnatomy / AnatomyEntry moved to ./anatomy-store.ts —
// the single canonical home of the anatomy format (OPENWOLF-2.0 §F2b).

// Files whose contents (or content-derived descriptions) must never reach
// anatomy.md / memory.md because they hold secrets (issue #54). Kept in sync
// with the copy in src/scanner/anatomy-scanner.ts — hooks are standalone
// scripts and the scanner cannot be imported from here.
const SENSITIVE_EXTENSIONS = new Set([
  ".pem", ".key", ".p8", ".p12", ".pfx", ".keystore", ".jks", ".ppk", ".kdbx", ".tfstate",
]);
const SENSITIVE_BASENAMES = new Set([".npmrc", ".netrc", ".htpasswd", ".pgpass"]);

export function isSensitiveFile(basename: string): boolean {
  const lower = basename.toLowerCase();
  if (lower === ".env" || lower.startsWith(".env.")) return true;
  if (SENSITIVE_BASENAMES.has(lower)) return true;
  const dot = lower.lastIndexOf(".");
  if (dot >= 0 && SENSITIVE_EXTENSIONS.has(lower.slice(dot))) return true;
  if (/^id_(rsa|dsa|ecdsa|ed25519)/.test(lower)) return true;
  if (lower.includes("credential") || /^secrets\.(json|ya?ml|toml)$/.test(lower)) return true;
  return false;
}

export function extractDescription(filePath: string): string {
  const MAX_DESC = 150;
  const basename = path.basename(filePath);
  const ext = path.extname(basename).toLowerCase();
  const known: Record<string, string> = {
    "package.json": "Node.js package manifest",
    "tsconfig.json": "TypeScript configuration",
    ".gitignore": "Git ignore rules",
    "README.md": "Project documentation",
    "composer.json": "PHP package manifest",
    "requirements.txt": "Python dependencies",
    "schema.sql": "Database schema",
    "Dockerfile": "Docker container definition",
    "docker-compose.yml": "Docker Compose services",
    "Cargo.toml": "Rust package manifest",
    "go.mod": "Go module definition",
    "Gemfile": "Ruby dependencies",
    "pubspec.yaml": "Dart/Flutter package manifest",
  };
  if (known[basename]) return known[basename];

  let content: string;
  try {
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(12288); // 12KB
    const n = fs.readSync(fd, buf, 0, 12288, 0);
    fs.closeSync(fd);
    content = buf.subarray(0, n).toString("utf-8");
  } catch {
    return "";
  }
  if (!content.trim()) return "";

  const cap = (s: string) => s.length <= MAX_DESC ? s : s.slice(0, MAX_DESC - 3) + "...";

  // Markdown heading
  if (ext === ".md" || ext === ".mdx") {
    const m = content.match(/^#{1,2}\s+(.+)$/m);
    if (m) return cap(m[1].trim());
  }

  // HTML title
  if (ext === ".html" || ext === ".htm") {
    const m = content.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (m) return cap(m[1].trim());
  }

  // JSDoc / PHPDoc / Javadoc — first meaningful line
  const jm = content.match(/\/\*\*\s*\n?\s*\*?\s*(.+)/);
  if (jm) {
    const l = jm[1].replace(/\*\/$/, "").trim();
    if (l && !l.startsWith("@") && l.length > 5) return cap(l);
  }

  // Python docstring
  if (ext === ".py") {
    const dm = content.match(/^(?:#[^\n]*\n)*\s*(?:"""(.+?)"""|'''(.+?)''')/s);
    if (dm) {
      const first = (dm[1] || dm[2]).split("\n")[0].trim();
      if (first && first.length > 3) return cap(first);
    }
  }

  // Rust doc comments
  if (ext === ".rs") {
    const lines = content.split("\n");
    for (const line of lines.slice(0, 20)) {
      const m = line.match(/^\s*(?:\/\/\/|\/\/!)\s*(.+)/);
      if (m && m[1].length > 5) return cap(m[1].trim());
    }
  }

  // Go package comment
  if (ext === ".go") {
    const m = content.match(/\/\/\s*Package\s+\w+\s+(.*)/);
    if (m) return cap(m[1].trim());
  }

  // C# XML doc
  if (ext === ".cs") {
    const m = content.match(/<summary>\s*([\s\S]*?)\s*<\/summary>/);
    if (m) {
      const text = m[1].replace(/\/\/\/\s*/g, "").replace(/\s+/g, " ").trim();
      if (text.length > 5) return cap(text);
    }
  }

  // Elixir @moduledoc
  if (ext === ".ex" || ext === ".exs") {
    const m = content.match(/@moduledoc\s+"""\s*\n\s*(.*)/);
    if (m) return cap(m[1].trim());
  }

  // Header comment (skip generic ones)
  const hdrLines = content.split("\n");
  for (const line of hdrLines.slice(0, 15)) {
    const t = line.trim();
    if (!t || t === "<?php" || t.startsWith("#!") || t.startsWith("namespace") || t.startsWith("use ") || t.startsWith("import ") || t.startsWith("from ") || t.startsWith("require") || t.startsWith("module ")) continue;
    const cm = t.match(/^(?:\/\/|#|--)\s*(.+)/);
    if (cm) {
      const text = cm[1].trim();
      const lower = text.toLowerCase();
      if (text.length > 5 && !lower.startsWith("copyright") && !lower.startsWith("license") && !lower.startsWith("@") && !lower.startsWith("strict") && !lower.startsWith("generated") && !lower.startsWith("eslint-") && !lower.startsWith("nolint")) {
        return cap(text);
      }
    }
    if (!t.startsWith("//") && !t.startsWith("#") && !t.startsWith("/*") && !t.startsWith("*") && !t.startsWith("--")) break;
  }

  // ─── PHP / Laravel ───────────────────────────────────────
  if (ext === ".php") {
    if (basename.endsWith(".blade.php")) {
      const ext2 = content.match(/@extends\(\s*['"]([^'"]+)['"]\s*\)/);
      const sections = (content.match(/@section\(\s*['"](\w+)['"]/g) || []).map(s => s.match(/['"](\w+)['"]/)?.[1]).filter(Boolean);
      const parts: string[] = [];
      if (ext2) parts.push(`extends ${ext2[1]}`);
      if (sections.length) parts.push(`sections: ${sections.join(", ")}`);
      return cap(parts.length ? `Blade: ${parts.join(", ")}` : "Blade template");
    }

    const classM = content.match(/class\s+(\w+)(?:\s+extends\s+(\w+))?/);
    const className = classM?.[1] || "";
    const parent = classM?.[2] || "";
    const pubMethods = (content.match(/public\s+function\s+(\w+)/g) || [])
      .map(m => m.match(/public\s+function\s+(\w+)/)?.[1])
      .filter(n => n && n !== "__construct" && n !== "middleware") as string[];

    if (basename.endsWith("Controller.php") || parent === "Controller") {
      if (pubMethods.length > 0) {
        const display = pubMethods.slice(0, 5).join(", ");
        return cap(pubMethods.length > 5 ? `${display} + ${pubMethods.length - 5} more` : display);
      }
    }

    if (parent === "Model" || parent === "Authenticatable") {
      const parts: string[] = [];
      const tbl = content.match(/\$table\s*=\s*['"]([^'"]+)['"]/);
      if (tbl) parts.push(`table: ${tbl[1]}`);
      const fill = content.match(/\$fillable\s*=\s*\[([^\]]*)\]/s);
      if (fill) { const c = (fill[1].match(/['"]/g) || []).length / 2; parts.push(`${Math.floor(c)} fields`); }
      const rels = (content.match(/\$this->(hasMany|hasOne|belongsTo|belongsToMany|morphMany|morphTo)\(/g) || []).length;
      if (rels) parts.push(`${rels} rels`);
      return cap(parts.length ? `Model — ${parts.join(", ")}` : `Model: ${className}`);
    }

    if (basename.match(/^\d{4}_\d{2}_\d{2}/)) {
      const create = content.match(/Schema::create\(\s*['"]([^'"]+)['"]/);
      if (create) return `Migration: create ${create[1]} table`;
      const alter = content.match(/Schema::table\(\s*['"]([^'"]+)['"]/);
      if (alter) return `Migration: alter ${alter[1]} table`;
      return "Database migration";
    }

    if (className && pubMethods.length > 0) {
      const display = pubMethods.slice(0, 4).join(", ");
      return cap(pubMethods.length > 4 ? `${className}: ${display} + ${pubMethods.length - 4} more` : `${className}: ${display}`);
    }
  }

  // ─── TS/JS/React/Next.js ─────────────────────────────────
  if (ext === ".ts" || ext === ".tsx" || ext === ".js" || ext === ".jsx" || ext === ".mjs" || ext === ".cjs") {
    // React component
    if (ext === ".tsx" || ext === ".jsx") {
      const comp = content.match(/(?:export\s+(?:default\s+)?)?(?:function|const)\s+(\w+)/);
      const parts: string[] = [];
      if (comp) parts.push(comp[1]);
      const renders: string[] = [];
      if (/<(?:form|Form)/i.test(content)) renders.push("form");
      if (/<(?:table|Table|DataTable)/i.test(content)) renders.push("table");
      if (/<(?:dialog|Dialog|Modal|Drawer)/i.test(content)) renders.push("modal");
      if (renders.length) parts.push(`renders ${renders.join(", ")}`);
      if (parts.length) return cap(parts.join(" — "));
    }

    // Next.js conventions
    if (basename === "page.tsx" || basename === "page.js") return "Next.js page component";
    if (basename === "layout.tsx" || basename === "layout.js") return "Next.js layout";
    if (basename === "route.ts" || basename === "route.js") {
      const methods = [...new Set((content.match(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)/g) || [])
        .map(m => m.match(/(GET|POST|PUT|PATCH|DELETE)/)?.[1]))].filter(Boolean);
      return methods.length ? `Next.js API route: ${methods.join(", ")}` : "Next.js API route";
    }

    // Express/Fastify routes
    const routeHits = content.match(/\.(get|post|put|patch|delete)\s*\(\s*['"`]/g);
    if (routeHits && routeHits.length > 0) {
      const methods = [...new Set(routeHits.map(r => r.match(/\.(get|post|put|patch|delete)/)?.[1]?.toUpperCase()))];
      return cap(`API routes: ${methods.join(", ")} (${routeHits.length} endpoints)`);
    }

    // tRPC router
    if (content.includes("createTRPCRouter") || content.includes("publicProcedure")) {
      const procs = (content.match(/\.(query|mutation|subscription)\s*\(/g) || []).length;
      return procs ? `tRPC router: ${procs} procedures` : "tRPC router";
    }

    // Zod schemas
    if (content.includes("z.object") || content.includes("z.string")) {
      const schemas = (content.match(/(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*z\./g) || [])
        .map(s => s.match(/(?:const|let)\s+(\w+)/)?.[1]).filter(Boolean);
      if (schemas.length) return cap(`Zod schemas: ${schemas.slice(0, 4).join(", ")}${schemas.length > 4 ? ` + ${schemas.length - 4} more` : ""}`);
    }

    // Exports summary
    const exports = (content.match(/export\s+(?:async\s+)?(?:function|class|const|interface|type|enum)\s+(\w+)/g) || [])
      .map(e => e.match(/(\w+)$/)?.[1]).filter(Boolean) as string[];
    if (exports.length > 0 && exports.length <= 5) return `Exports ${exports.join(", ")}`;
    if (exports.length > 5) return cap(`Exports ${exports.slice(0, 4).join(", ")} + ${exports.length - 4} more`);
  }

  // ─── Python / Django / FastAPI / Flask ────────────────────
  if (ext === ".py") {
    // Django model
    if (content.includes("models.Model")) {
      const cls = content.match(/class\s+(\w+)\(.*models\.Model\)/);
      const fields = (content.match(/^\s+\w+\s*=\s*models\.\w+/gm) || []).length;
      return cap(`Model: ${cls?.[1] || "unknown"}, ${fields} fields`);
    }
    // FastAPI/Flask routes
    if (content.includes("@router.") || content.includes("@app.")) {
      const routes = (content.match(/@(?:router|app)\.(get|post|put|patch|delete)\s*\(/g) || []);
      return cap(routes.length ? `API: ${routes.length} endpoints` : "API router");
    }
    // Pydantic
    if (content.includes("BaseModel") && content.includes("Field(")) {
      const cls = content.match(/class\s+(\w+)\(.*BaseModel\)/);
      return cls ? `Pydantic: ${cls[1]}` : "Pydantic model";
    }
    // Celery
    if (content.includes("@shared_task") || content.includes("@app.task")) {
      const tasks = (content.match(/def\s+(\w+)/g) || []).map(m => m.match(/def\s+(\w+)/)?.[1]).filter(n => n && !n.startsWith("_")) as string[];
      return cap(tasks.length ? `Celery tasks: ${tasks.join(", ")}` : "Celery task");
    }
    // Generic
    const pyClass = content.match(/class\s+(\w+)/);
    const funcs = (content.match(/def\s+(\w+)/g) || []).map(f => f.match(/def\s+(\w+)/)?.[1]).filter(n => n && !n.startsWith("_")) as string[];
    if (pyClass && funcs.length > 0) return cap(funcs.length > 4 ? `${pyClass[1]}: ${funcs.slice(0, 4).join(", ")} + ${funcs.length - 4} more` : `${pyClass[1]}: ${funcs.join(", ")}`);
    if (funcs.length > 0) return cap(funcs.slice(0, 4).join(", "));
  }

  // ─── Go ──────────────────────────────────────────────────
  if (ext === ".go") {
    const handlers = (content.match(/func\s+(\w+)\s*\(\s*\w+\s+http\.ResponseWriter/g) || [])
      .map(m => m.match(/func\s+(\w+)/)?.[1]).filter(Boolean);
    if (handlers.length) return cap(`HTTP handlers: ${handlers.slice(0, 5).join(", ")}`);
    const iface = content.match(/type\s+(\w+)\s+interface\s*\{/);
    if (iface) return `Interface: ${iface[1]}`;
    const structM = content.match(/type\s+(\w+)\s+struct\s*\{/);
    if (structM) return `Struct: ${structM[1]}`;
    const funcs = (content.match(/^func\s+(\w+)/gm) || []).map(m => m.match(/func\s+(\w+)/)?.[1]).filter(n => n && n[0] === n[0].toUpperCase()) as string[];
    if (funcs.length) return cap(funcs.slice(0, 5).join(", "));
  }

  // ─── Rust ────────────────────────────────────────────────
  if (ext === ".rs") {
    const structM = content.match(/pub\s+struct\s+(\w+)/);
    if (structM) {
      const methods = (content.match(/pub\s+(?:async\s+)?fn\s+(\w+)/g) || []).map(m => m.match(/fn\s+(\w+)/)?.[1]).filter(Boolean);
      return cap(methods.length ? `${structM[1]}: ${methods.slice(0, 4).join(", ")}` : `Struct: ${structM[1]}`);
    }
    const traitM = content.match(/pub\s+trait\s+(\w+)/);
    if (traitM) return `Trait: ${traitM[1]}`;
    const enumM = content.match(/pub\s+enum\s+(\w+)/);
    if (enumM) return `Enum: ${enumM[1]}`;
    const fns = (content.match(/pub\s+(?:async\s+)?fn\s+(\w+)/g) || []).map(m => m.match(/fn\s+(\w+)/)?.[1]).filter(Boolean);
    if (fns.length) return cap(fns.slice(0, 5).join(", "));
  }

  // ─── Java / Spring ───────────────────────────────────────
  if (ext === ".java") {
    const cls = content.match(/(?:public\s+)?class\s+(\w+)/);
    const className = cls?.[1] || basename.replace(".java", "");
    const annotations = (content.match(/@(RestController|Controller|Service|Repository|Component|Entity|Configuration)/g) || []).map(a => a.slice(1));
    const mappings = (content.match(/@(?:Get|Post|Put|Patch|Delete|Request)Mapping/g) || []).length;
    if (mappings) return cap(`${annotations[0] || "Spring"}: ${className} (${mappings} endpoints)`);
    if (annotations.length) return `${annotations[0]}: ${className}`;
    if (content.includes("@Entity")) return `Entity: ${className}`;
    const methods = (content.match(/public\s+(?:static\s+)?(?:\w+(?:<[\w,\s]+>)?)\s+(\w+)\s*\(/g) || [])
      .map(m => m.match(/(\w+)\s*\(/)?.[1]).filter(n => n && n !== className) as string[];
    if (methods.length) return cap(`${className}: ${methods.slice(0, 4).join(", ")}`);
    return className ? `Class: ${className}` : "";
  }

  // ─── Kotlin ──────────────────────────────────────────────
  if (ext === ".kt" || ext === ".kts") {
    const cls = content.match(/(?:data\s+)?class\s+(\w+)/);
    if (content.match(/data\s+class/)) return `Data class: ${cls?.[1] || basename.replace(/\.kts?$/, "")}`;
    if (content.includes("routing {")) return "Ktor routing";
    const fns = (content.match(/fun\s+(\w+)/g) || []).map(m => m.match(/fun\s+(\w+)/)?.[1]).filter(Boolean);
    if (cls && fns.length) return cap(`${cls[1]}: ${fns.slice(0, 4).join(", ")}`);
    if (fns.length) return cap(fns.slice(0, 5).join(", "));
  }

  // ─── C# / .NET ───────────────────────────────────────────
  if (ext === ".cs") {
    const cls = content.match(/(?:public\s+)?(?:partial\s+)?class\s+(\w+)(?:\s*:\s*(\w+))?/);
    const className = cls?.[1] || basename.replace(".cs", "");
    const parent = cls?.[2] || "";
    if (parent === "Controller" || parent === "ControllerBase" || content.includes("[ApiController]")) {
      const actions = (content.match(/\[Http(Get|Post|Put|Patch|Delete)\]/g) || []).map(a => a.match(/Http(\w+)/)?.[1]).filter(Boolean);
      return cap(actions.length ? `API Controller: ${className} (${[...new Set(actions)].join(", ")})` : `Controller: ${className}`);
    }
    if (parent === "DbContext" || content.includes("DbSet<")) {
      const sets = (content.match(/DbSet<(\w+)>/g) || []).map(s => s.match(/<(\w+)>/)?.[1]).filter(Boolean);
      return cap(sets.length ? `DbContext: ${sets.join(", ")}` : `DbContext: ${className}`);
    }
    return className ? `Class: ${className}` : "";
  }

  // ─── Ruby / Rails ────────────────────────────────────────
  if (ext === ".rb") {
    const cls = content.match(/class\s+(\w+)(?:\s*<\s*(\w+(?:::\w+)?))?/);
    const className = cls?.[1] || "";
    const parent = cls?.[2] || "";
    if (parent?.includes("Controller")) {
      const actions = (content.match(/def\s+(index|show|new|create|edit|update|destroy|\w+)/g) || [])
        .map(m => m.match(/def\s+(\w+)/)?.[1]).filter(n => n && !n.startsWith("_")) as string[];
      return cap(actions.length ? `Controller: ${actions.join(", ")}` : `Controller: ${className}`);
    }
    if (parent === "ApplicationRecord" || parent === "ActiveRecord::Base") return `Model: ${className}`;
    if (basename.match(/^\d{14}_/)) {
      const create = content.match(/create_table\s+:(\w+)/);
      return create ? `Migration: create ${create[1]}` : "Database migration";
    }
    const methods = (content.match(/def\s+(\w+)/g) || []).map(m => m.match(/def\s+(\w+)/)?.[1]).filter(n => n && !n.startsWith("_")) as string[];
    if (cls && methods.length) return cap(`${className}: ${methods.slice(0, 4).join(", ")}`);
  }

  // ─── Swift ───────────────────────────────────────────────
  if (ext === ".swift") {
    if (content.includes(": View") || content.includes("some View")) {
      const name = content.match(/struct\s+(\w+)\s*:\s*View/);
      return name ? `SwiftUI view: ${name[1]}` : "SwiftUI view";
    }
    const proto = content.match(/protocol\s+(\w+)/);
    if (proto) return `Protocol: ${proto[1]}`;
    const struct = content.match(/(?:public\s+)?struct\s+(\w+)/);
    const cls = content.match(/(?:public\s+)?class\s+(\w+)/);
    const name = struct?.[1] || cls?.[1] || "";
    if (name) return `${struct ? "Struct" : "Class"}: ${name}`;
  }

  // ─── Dart / Flutter ──────────────────────────────────────
  if (ext === ".dart") {
    if (content.includes("StatefulWidget") || content.includes("StatelessWidget")) {
      const name = content.match(/class\s+(\w+)\s+extends\s+(?:Stateful|Stateless)Widget/);
      return name ? `${content.includes("StatefulWidget") ? "Stateful" : "Stateless"} widget: ${name[1]}` : "Flutter widget";
    }
    const cls = content.match(/class\s+(\w+)/);
    if (cls) return `Class: ${cls[1]}`;
  }

  // ─── Vue / Svelte / Astro ────────────────────────────────
  if (ext === ".vue") {
    const name = content.match(/name:\s*['"]([^'"]+)['"]/);
    const setup = content.includes("<script setup");
    const parts: string[] = [];
    if (name) parts.push(name[1]);
    if (setup) parts.push("setup");
    return cap(parts.length ? `Vue: ${parts.join(", ")}` : "Vue component");
  }
  if (ext === ".svelte") return `Svelte: ${basename.replace(".svelte", "")}`;
  if (ext === ".astro") return `Astro: ${basename.replace(".astro", "")}`;

  // ─── CSS / SCSS / Less ───────────────────────────────────
  if (ext === ".css" || ext === ".scss" || ext === ".less") {
    const rules = (content.match(/^[.#@][^\n{]+/gm) || []).length;
    const vars = (content.match(/--[\w-]+\s*:/g) || []).length;
    const parts: string[] = [];
    if (rules) parts.push(`${rules} rules`);
    if (vars) parts.push(`${vars} vars`);
    return cap(parts.length ? `Styles: ${parts.join(", ")}` : "Stylesheet");
  }

  // ─── SQL ─────────────────────────────────────────────────
  if (ext === ".sql") {
    const creates = (content.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?(\w+)/gi) || [])
      .map(m => m.match(/(?:TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?)([`"']?\w+)/i)?.[1]?.replace(/[`"']/g, "")).filter(Boolean);
    if (creates.length) return cap(`SQL: tables: ${creates.slice(0, 4).join(", ")}`);
  }

  // ─── Proto / GraphQL ─────────────────────────────────────
  if (ext === ".proto") {
    const msgs = (content.match(/message\s+(\w+)/g) || []).map(m => m.match(/message\s+(\w+)/)?.[1]).filter(Boolean);
    const services = (content.match(/service\s+(\w+)/g) || []).map(m => m.match(/service\s+(\w+)/)?.[1]).filter(Boolean);
    const parts: string[] = [];
    if (msgs.length) parts.push(`messages: ${msgs.slice(0, 3).join(", ")}`);
    if (services.length) parts.push(`services: ${services.join(", ")}`);
    return cap(parts.length ? `Proto: ${parts.join(", ")}` : "");
  }
  if (ext === ".graphql" || ext === ".gql") {
    const types = (content.match(/type\s+(\w+)/g) || []).map(m => m.match(/type\s+(\w+)/)?.[1]).filter(Boolean);
    return cap(types.length ? `GraphQL: types: ${types.slice(0, 4).join(", ")}` : "GraphQL schema");
  }

  // ─── YAML ────────────────────────────────────────────────
  if (ext === ".yaml" || ext === ".yml") {
    if (content.includes("runs-on:")) {
      const name = content.match(/^name:\s*(.+)$/m);
      return cap(name ? `CI: ${name[1].trim()}` : "GitHub Actions workflow");
    }
    if (content.includes("apiVersion:") && content.includes("kind:")) {
      const kind = content.match(/kind:\s*(\w+)/);
      return cap(kind ? `K8s ${kind[1]}` : "Kubernetes manifest");
    }
    if (content.includes("services:") && (basename.includes("docker") || basename.includes("compose"))) {
      const services = (content.match(/^\s{2}\w+:/gm) || []).length;
      return `Docker Compose: ${services} services`;
    }
  }

  // ─── TOML ────────────────────────────────────────────────
  if (ext === ".toml") {
    const desc = content.match(/^description\s*=\s*"([^"]+)"/m);
    if (desc) return cap(desc[1]);
  }

  // ─── Elixir ──────────────────────────────────────────────
  if (ext === ".ex" || ext === ".exs") {
    const mod = content.match(/defmodule\s+([\w.]+)/);
    if (content.includes("Phoenix.LiveView")) return cap(mod ? `LiveView: ${mod[1]}` : "Phoenix LiveView");
    if (content.includes("Controller")) return cap(mod ? `Phoenix controller: ${mod[1]}` : "Phoenix controller");
    const fns = (content.match(/def\s+(\w+)/g) || []).map(m => m.match(/def\s+(\w+)/)?.[1]).filter(Boolean);
    if (mod && fns.length) return cap(`${mod[1]}: ${fns.slice(0, 4).join(", ")}`);
    if (mod) return mod[1];
  }

  // ─── Lua ─────────────────────────────────────────────────
  if (ext === ".lua") {
    const fns = (content.match(/function\s+(?:\w+[.:])?(\w+)/g) || []).map(m => m.match(/(\w+)\s*$/)?.[1]).filter(Boolean);
    if (fns.length) return cap(fns.slice(0, 5).join(", "));
  }

  // ─── Zig ─────────────────────────────────────────────────
  if (ext === ".zig") {
    const fns = (content.match(/pub\s+fn\s+(\w+)/g) || []).map(m => m.match(/fn\s+(\w+)/)?.[1]).filter(Boolean);
    if (fns.length) return cap(fns.slice(0, 5).join(", "));
  }

  // Last resort
  const declM = content.match(/(?:function|class|const|interface|type|enum)\s+(\w+)/);
  if (declM) {
    const name = declM[1];
    const methods = (content.match(/(?:public\s+)?(?:async\s+)?(?:function\s+|(?:get|set)\s+)(\w+)\s*\(/g) || [])
      .map(m => m.match(/(\w+)\s*\(/)?.[1]).filter(n => n && n !== name && n !== "__construct" && n !== "constructor") as string[];
    if (methods.length > 0 && methods.length <= 5) return cap(`${name}: ${methods.join(", ")}`);
    if (methods.length > 5) return cap(`${name}: ${methods.slice(0, 3).join(", ")} + ${methods.length - 3} more`);
    return `Declares ${name}`;
  }
  return "";
}

export function estimateTokens(text: string, type: "code" | "prose" | "mixed" = "mixed"): number {
  const ratio = type === "code" ? 3.5 : type === "prose" ? 4.0 : 3.75;
  return Math.ceil(text.length / ratio);
}

export function timestamp(): string {
  return new Date().toISOString();
}

export function timeShort(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk as Buffer));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    // If no stdin data after 4s, resolve with whatever we have so far.
    // On Windows, stdin delivery from Claude Code hooks can be slow.
    setTimeout(() => resolve(chunks.length ? Buffer.concat(chunks).toString("utf-8") : "{}"), 4000);
  });
}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

// ─── Hook JSON output (the only channel the model sees) ─────────────────────
// Claude Code treats hook stdout as ONE JSON object; two concatenated objects
// are invalid JSON and the whole output is silently dropped. stderr from a
// hook that exits 0 goes to the debug log only — the model NEVER sees it, so
// every nudge meant for the model must go through hookSpecificOutput.
// Callers must accumulate all messages for a run and call this exactly once.
//
// permissionDecision "allow" is deliberately not accepted: it bypasses the
// user's permission system (auto-approves gated tool calls). To pass through
// with context attached, omit the decision entirely.

export interface HookJSONFields {
  additionalContext?: string;
  permissionDecision?: "deny" | "ask";
  permissionDecisionReason?: string;
  /** PostToolUse only: replaces the tool's result before Claude sees it.
   * For built-in tools the value must match the tool's output schema exactly
   * or the harness silently ignores it — mirror the received tool_response
   * object and modify only the fields you mean to change. */
  updatedToolOutput?: unknown;
}

export function emitHookJSON(hookEventName: string, fields: HookJSONFields): void {
  const out: Record<string, unknown> = { hookEventName };
  if (fields.additionalContext) out.additionalContext = fields.additionalContext;
  if (fields.updatedToolOutput !== undefined) out.updatedToolOutput = fields.updatedToolOutput;
  if (fields.permissionDecision) {
    out.permissionDecision = fields.permissionDecision;
    out.permissionDecisionReason = fields.permissionDecisionReason ?? "";
  }
  if (Object.keys(out).length === 1) return;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: out }));
}

// ─── Injection accounting (J1: cost-of-injection) ───────────────────────────
// Every token OpenWolf injects into the model's context (digests, hints,
// warnings, reminders) is a cost the savings claim must be weighed against.
// Hooks record what they emit; the ledger folds it into the session totals.

export interface InjectionTracking {
  injected_tokens_estimated?: number;
  injected_by_source?: Record<string, number>;
  [key: string]: unknown;
}

/** Record an injected text against the in-memory session (caller persists). */
export function recordInjection(session: InjectionTracking, source: string, text: string): void {
  if (!text) return;
  const tokens = estimateTokens(text, "prose");
  session.injected_tokens_estimated = (session.injected_tokens_estimated ?? 0) + tokens;
  const bySource = session.injected_by_source ?? {};
  bySource[source] = (bySource[source] ?? 0) + tokens;
  session.injected_by_source = bySource;
}

/** Same, for hooks that do not otherwise hold the session file open. */
export function recordInjectionToSessionFile(sessionFile: string, source: string, text: string): void {
  if (!text) return;
  try {
    const session = readSessionState(sessionFile) as InjectionTracking;
    recordInjection(session, source, text);
    writeJSON(sessionFile, session);
  } catch {}
}

/**
 * Count non-mechanical semantic entries written to memory.md this session.
 * Mechanical entries (auto-generated file ops, session-end lines) don't count.
 * Used by the stop hook to detect whether Claude wrote a meaningful summary.
 */
export function countSemanticEntries(wolfDir: string): number {
  const memoryPath = path.join(wolfDir, "memory.md");
  try {
    const content = fs.readFileSync(memoryPath, "utf-8");
    const mechanical = /^\|\s*[\d\-: ]+\|\s*(Created|Edited|Multi-edited|Session end:|designqc:)/;
    const tableHeader = /^\|\s*Time\s*\|/i;
    const tableSeparator = /^\|[\s\-|]+\|?\s*$/;
    const lines = content.split("\n");
    let start = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].startsWith("## Session: ")) { start = i; break; }
    }
    let count = 0;
    for (let i = start + 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.startsWith("|")) continue;
      if (tableHeader.test(line) || tableSeparator.test(line) || mechanical.test(line)) continue;
      count++;
    }
    return count;
  } catch {
    return 0;
  }
}

// ─── Real token usage (Workstream F1) ────────────────────────────────────────
// The Stop payload carries transcript_path; the transcript JSONL records the
// harness's actual per-message API usage. Summing it gives *measured* session
// tokens — the verifiable numbers the estimated ledger can be checked against.

export interface ModelUsageTotals {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  api_calls: number;
}

export interface RealUsage extends ModelUsageTotals {
  per_model?: Record<string, ModelUsageTotals>;
}

export function readTranscriptUsage(transcriptPath: string): RealUsage | null {
  let raw: string;
  try {
    raw = fs.readFileSync(transcriptPath, "utf-8");
  } catch {
    return null;
  }
  // One usage block per API call; streaming can emit several transcript lines
  // for one message id, and a resumed session can replay a message under a new
  // request — dedupe on message id + request id, keeping the last usage seen.
  const byId = new Map<string, { model?: string; input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }>();
  let anon = 0;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      const usage = entry?.message?.usage;
      if (usage && typeof usage === "object" && typeof usage.output_tokens === "number") {
        const key = `${entry.message.id ?? `anon-${anon++}`}:${entry.requestId ?? ""}`;
        byId.set(key, { ...usage, model: entry.message.model });
      }
    } catch {}
  }
  if (byId.size === 0) return null;
  const total: RealUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, api_calls: byId.size };
  const perModel: Record<string, ModelUsageTotals> = {};
  for (const u of byId.values()) {
    total.input_tokens += u.input_tokens ?? 0;
    total.output_tokens += u.output_tokens ?? 0;
    total.cache_read_input_tokens += u.cache_read_input_tokens ?? 0;
    total.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0;
    const model = u.model ?? "unknown";
    const m = perModel[model] ?? (perModel[model] = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, api_calls: 0 });
    m.input_tokens += u.input_tokens ?? 0;
    m.output_tokens += u.output_tokens ?? 0;
    m.cache_read_input_tokens += u.cache_read_input_tokens ?? 0;
    m.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0;
    m.api_calls++;
  }
  if (Object.keys(perModel).length > 0) total.per_model = perModel;
  return total;
}
