import * as fs from "node:fs";
import * as path from "node:path";

// ─── Known files ─────────────────────────────────────────────
const KNOWN_FILES: Record<string, string> = {
  // JS/TS ecosystem
  "package.json": "Node.js package manifest",
  "package-lock.json": "npm lock file",
  "pnpm-lock.yaml": "pnpm lock file",
  "yarn.lock": "Yarn lock file",
  "bun.lockb": "Bun lock file",
  "tsconfig.json": "TypeScript configuration",
  "tsconfig.build.json": "TypeScript build configuration",
  "tsconfig.hooks.json": "TypeScript hooks build configuration",
  ".eslintrc.json": "ESLint configuration",
  ".eslintrc.js": "ESLint configuration",
  ".eslintrc.cjs": "ESLint configuration",
  "eslint.config.js": "ESLint flat configuration",
  "eslint.config.mjs": "ESLint flat configuration",
  "biome.json": "Biome linter/formatter configuration",
  ".prettierrc": "Prettier configuration",
  ".prettierrc.json": "Prettier configuration",
  "prettier.config.js": "Prettier configuration",
  // Build tools
  "vite.config.ts": "Vite build configuration",
  "vite.config.js": "Vite build configuration",
  "next.config.js": "Next.js configuration",
  "next.config.mjs": "Next.js configuration",
  "next.config.ts": "Next.js configuration",
  "nuxt.config.ts": "Nuxt configuration",
  "nuxt.config.js": "Nuxt configuration",
  "svelte.config.js": "SvelteKit configuration",
  "astro.config.mjs": "Astro configuration",
  "astro.config.ts": "Astro configuration",
  "remix.config.js": "Remix configuration",
  "tailwind.config.js": "Tailwind CSS configuration",
  "tailwind.config.ts": "Tailwind CSS configuration",
  "postcss.config.js": "PostCSS configuration",
  "postcss.config.cjs": "PostCSS configuration",
  ".babelrc": "Babel configuration",
  "babel.config.js": "Babel configuration",
  "webpack.config.js": "Webpack configuration",
  "rollup.config.js": "Rollup configuration",
  "turbo.json": "Turborepo configuration",
  // Test
  "jest.config.js": "Jest test configuration",
  "jest.config.ts": "Jest test configuration",
  "vitest.config.ts": "Vitest test configuration",
  "playwright.config.ts": "Playwright test configuration",
  "cypress.config.ts": "Cypress test configuration",
  // Git
  ".gitignore": "Git ignore rules",
  ".gitattributes": "Git attributes",
  // Docker
  "Dockerfile": "Docker container definition",
  "docker-compose.yml": "Docker Compose services",
  "docker-compose.yaml": "Docker Compose services",
  ".dockerignore": "Docker ignore rules",
  // CI/CD
  ".github/workflows/ci.yml": "GitHub Actions CI pipeline",
  ".gitlab-ci.yml": "GitLab CI pipeline",
  "Jenkinsfile": "Jenkins pipeline",
  // Rust
  "Cargo.toml": "Rust package manifest",
  "Cargo.lock": "Rust dependency lock file",
  // Go
  "go.mod": "Go module definition",
  "go.sum": "Go dependency checksums",
  // Python
  "pyproject.toml": "Python project configuration",
  "setup.py": "Python package setup",
  "setup.cfg": "Python package configuration",
  "requirements.txt": "Python dependencies",
  "Pipfile": "Pipenv dependencies",
  "poetry.lock": "Poetry lock file",
  // Ruby
  "Gemfile": "Ruby dependencies",
  "Gemfile.lock": "Ruby dependency lock",
  "Rakefile": "Ruby make-like build tasks",
  // PHP
  "composer.json": "PHP package manifest",
  "composer.lock": "PHP dependency lock",
  "artisan": "Laravel CLI entry point",
  // Java/Kotlin
  "build.gradle": "Gradle build configuration",
  "build.gradle.kts": "Gradle Kotlin build configuration",
  "pom.xml": "Maven project configuration",
  "settings.gradle": "Gradle settings",
  "settings.gradle.kts": "Gradle Kotlin settings",
  // C#/.NET
  "Program.cs": "Application entry point",
  "Startup.cs": "ASP.NET startup configuration",
  "appsettings.json": ".NET application settings",
  "global.json": ".NET SDK configuration",
  // Swift
  "Package.swift": "Swift package manifest",
  // Dart/Flutter
  "pubspec.yaml": "Dart/Flutter package manifest",
  "pubspec.lock": "Dart dependency lock",
  // DB/Schema
  "schema.sql": "Database schema",
  "schema.prisma": "Prisma database schema",
  "drizzle.config.ts": "Drizzle ORM configuration",
  // Server
  ".htaccess": "Apache configuration",
  "nginx.conf": "Nginx configuration",
  // Misc
  ".editorconfig": "Editor configuration",
  ".env.example": "Environment variable template",
  "LICENSE": "Project license",
  "README.md": "Project documentation",
  "CHANGELOG.md": "Change log",
  "deno.json": "Deno configuration",
  "Makefile": "Make build targets",
  "CMakeLists.txt": "CMake build configuration",
};

const MAX_DESC = 150;
export const READ_BYTES = 12288; // 12KB for better analysis

// ─── Main entry ──────────────────────────────────────────────
export function extractDescription(filePath: string, content?: string): string {
  const basename = path.basename(filePath);

  if (KNOWN_FILES[basename]) return KNOWN_FILES[basename];

  if (content === undefined) {
    try {
      const fd = fs.openSync(filePath, "r");
      try {
        const buf = Buffer.alloc(READ_BYTES);
        const bytesRead = fs.readSync(fd, buf, 0, READ_BYTES, 0);
        content = buf.subarray(0, bytesRead).toString("utf-8");
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return "";
    }
  }
  if (!content.trim()) return "";

  const ext = path.extname(basename).toLowerCase();

  // package.json with description
  if (basename === "package.json") {
    try {
      const pkg = JSON.parse(content);
      return (pkg.description as string) || (pkg.name as string) || "Node.js package";
    } catch { return "Node.js package manifest"; }
  }

  // Markdown heading
  if (ext === ".md" || ext === ".mdx") {
    const m = content.match(/^#{1,2}\s+(.+)$/m);
    if (m) return m[1].trim();
  }

  // HTML title
  if (ext === ".html" || ext === ".htm") {
    const m = content.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (m) return m[1].trim();
  }

  // Docblock (JSDoc, PHPDoc, Rustdoc, Javadoc, C# XML doc)
  const doc = extractDocblock(content, ext);
  if (doc) return doc;

  // Header comment
  const hdr = extractHeaderComment(content, ext);
  if (hdr) return hdr;

  // Language-specific smart extraction
  const smart = extractSmart(content, ext, basename, filePath);
  if (smart) return smart;

  // Generic fallback
  return extractGenericFallback(content);
}

// ─── Docblock extraction ─────────────────────────────────────
function extractDocblock(content: string, ext: string): string {
  // JSDoc / PHPDoc / Javadoc / Kotlin KDoc: /** ... */
  const jsdoc = content.match(/\/\*\*\s*\n?\s*\*?\s*(.+)/);
  if (jsdoc) {
    const line = jsdoc[1].replace(/\*\/$/, "").trim();
    if (line && !line.startsWith("@") && line.length > 5) return line;
  }

  // Python docstring
  if (ext === ".py") {
    const dm = content.match(/^(?:#[^\n]*\n)*\s*(?:"""(.+?)"""|'''(.+?)''')/s);
    if (dm) {
      const first = (dm[1] || dm[2]).split("\n")[0].trim();
      if (first && first.length > 3) return first;
    }
  }

  // Rust doc comments: /// or //!
  if (ext === ".rs") {
    const lines = content.split("\n");
    for (const line of lines.slice(0, 20)) {
      const m = line.match(/^\s*(?:\/\/\/|\/\/!)\s*(.+)/);
      if (m && m[1].length > 5) return m[1].trim();
    }
  }

  // Go package comment
  if (ext === ".go") {
    const m = content.match(/\/\/\s*Package\s+\w+\s+(.*)/);
    if (m) return m[1].trim();
  }

  // C# XML doc: /// <summary>...</summary>
  if (ext === ".cs") {
    const m = content.match(/<summary>\s*([\s\S]*?)\s*<\/summary>/);
    if (m) {
      const text = m[1].replace(/\/\/\/\s*/g, "").replace(/\s+/g, " ").trim();
      if (text.length > 5) return text;
    }
  }

  // Elixir @moduledoc
  if (ext === ".ex" || ext === ".exs") {
    const m = content.match(/@moduledoc\s+"""\s*\n\s*(.*)/);
    if (m) return m[1].trim();
  }

  return "";
}

// ─── Header comment ──────────────────────────────────────────
function extractHeaderComment(content: string, ext: string): string {
  const lines = content.split("\n");
  for (const line of lines.slice(0, 15)) {
    const t = line.trim();
    if (!t || t === "<?php" || t.startsWith("#!") || t.startsWith("package ") ||
        t.startsWith("namespace") || t.startsWith("use ") || t.startsWith("import ") ||
        t.startsWith("from ") || t.startsWith("require") || t.startsWith("module ")) continue;

    const cm = t.match(/^(?:\/\/|#|--)\s*(.+)/);
    if (cm) {
      const text = cm[1].trim();
      if (text.length > 5 && !isGenericComment(text)) return text;
    }

    if (!t.startsWith("//") && !t.startsWith("#") && !t.startsWith("/*") &&
        !t.startsWith("*") && !t.startsWith("--")) break;
  }
  return "";
}

function isGenericComment(text: string): boolean {
  const l = text.toLowerCase();
  return l.startsWith("strict") || l.startsWith("copyright") || l.startsWith("license") ||
    l.startsWith("@author") || l.startsWith("@package") || l.startsWith("@license") ||
    l.startsWith("generated") || l.startsWith("auto-generated") || l === "use strict" ||
    l.startsWith("eslint-") || l.startsWith("prettier-") || l.startsWith("nolint") ||
    /^[-=]{3,}$/.test(text);
}

// ─── Smart extraction router ────────────────────────────────
function extractSmart(content: string, ext: string, basename: string, filePath: string): string {
  switch (ext) {
    case ".php": return extractPhp(content, basename, filePath);
    case ".ts": case ".tsx": case ".js": case ".jsx": case ".mjs": case ".cjs":
      return extractTsJs(content, basename, ext);
    case ".py": return extractPython(content, basename);
    case ".go": return extractGo(content);
    case ".rs": return extractRust(content);
    case ".java": return extractJava(content, basename);
    case ".kt": case ".kts": return extractKotlin(content, basename);
    case ".cs": return extractCSharp(content, basename);
    case ".rb": return extractRuby(content, basename);
    case ".swift": return extractSwift(content);
    case ".dart": return extractDart(content, basename);
    case ".vue": return extractVue(content);
    case ".svelte": return extractSvelte(content, basename);
    case ".astro": return extractAstro(content, basename);
    case ".css": case ".scss": case ".less": return extractCss(content);
    case ".sql": return extractSql(content);
    case ".proto": return extractProto(content);
    case ".graphql": case ".gql": return extractGraphQL(content);
    case ".yaml": case ".yml": return extractYaml(content, basename);
    case ".toml": return extractToml(content, basename);
    case ".ex": case ".exs": return extractElixir(content);
    case ".lua": return extractLua(content);
    case ".zig": return extractZig(content);
    default: return "";
  }
}

// ─── PHP / Laravel ───────────────────────────────────────────
function extractPhp(content: string, basename: string, filePath: string): string {
  if (basename.endsWith(".blade.php")) {
    const ext = content.match(/@extends\(\s*['"]([^'"]+)['"]\s*\)/);
    const sections = (content.match(/@section\(\s*['"](\w+)['"]/g) || []).map(s => s.match(/['"](\w+)['"]/)?.[1]).filter(Boolean);
    const forms = (content.match(/<form/gi) || []).length;
    const tables = (content.match(/<table/gi) || []).length;
    const comps = (content.match(/<x-/gi) || []).length;
    const parts: string[] = [];
    if (ext) parts.push(`extends ${ext[1]}`);
    if (sections.length) parts.push(`sections: ${sections.join(", ")}`);
    if (forms) parts.push(`${forms} form(s)`);
    if (tables) parts.push(`${tables} table(s)`);
    if (comps) parts.push(`${comps} component(s)`);
    return parts.length ? `Blade: ${parts.join(", ")}` : `Blade: ${basename.replace(".blade.php", "")}`;
  }

  const dirName = path.basename(path.dirname(filePath));
  const classM = content.match(/class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?/);
  const className = classM?.[1] || "";
  const parent = classM?.[2] || "";

  // Public methods with docblock summaries
  const methods: Array<{ name: string; summary: string }> = [];
  const mRegex = /(?:\/\*\*\s*([\s\S]*?)\*\/\s*)?public\s+(?:static\s+)?function\s+(\w+)/g;
  let mm;
  while ((mm = mRegex.exec(content)) !== null) {
    const doc = mm[1] || "";
    const name = mm[2];
    if (name === "__construct" || name === "middleware") continue;
    const docLines = doc.split("\n").map(l => l.replace(/^\s*\*\s?/, "").trim()).filter(Boolean);
    const summary = docLines.find(l => !l.startsWith("@") && l.length > 3)?.slice(0, 50) || "";
    methods.push({ name, summary });
  }

  const methodList = (items: typeof methods, max = 5) => {
    const display = items.slice(0, max).map(m => m.summary || m.name).join(", ");
    return items.length > max ? `${display} + ${items.length - max} more` : display;
  };

  // Controller
  if (basename.endsWith("Controller.php") || parent === "Controller") {
    return methods.length ? methodList(methods) : `Controller: ${className}`;
  }

  // Model
  if (parent === "Model" || parent === "Authenticatable" || dirName === "Models") {
    const parts: string[] = [];
    const tbl = content.match(/\$table\s*=\s*['"]([^'"]+)['"]/);
    if (tbl) parts.push(`table: ${tbl[1]}`);
    const fill = content.match(/\$fillable\s*=\s*\[([^\]]*)\]/s);
    if (fill) { const c = (fill[1].match(/['"]/g) || []).length / 2; parts.push(`${Math.floor(c)} fields`); }
    const casts = content.match(/\$casts\s*=\s*\[([^\]]*)\]/s);
    if (casts) { const c = (casts[1].match(/['"]/g) || []).length / 2; parts.push(`${Math.floor(c)} casts`); }
    const rels = (content.match(/\$this->(hasMany|hasOne|belongsTo|belongsToMany|morphMany|morphTo|morphOne|hasManyThrough)\(/g) || []).length;
    if (rels) parts.push(`${rels} rels`);
    const scopes = (content.match(/public\s+function\s+scope(\w+)/g) || []).length;
    if (scopes) parts.push(`${scopes} scopes`);
    return parts.length ? `Model — ${parts.join(", ")}` : `Model: ${className}`;
  }

  // Migration
  if (basename.match(/^\d{4}_\d{2}_\d{2}/)) {
    const create = content.match(/Schema::create\(\s*['"]([^'"]+)['"]/);
    if (create) return `Migration: create ${create[1]} table`;
    const alter = content.match(/Schema::table\(\s*['"]([^'"]+)['"]/);
    if (alter) return `Migration: alter ${alter[1]} table`;
    return "Database migration";
  }

  // Laravel types
  const types: Record<string, string> = {
    ServiceProvider: "Service provider", FormRequest: "Form validation",
    ShouldQueue: "Queued job", Notification: "Notification", Mailable: "Mail",
    Event: "Event", Listener: "Event listener", Command: "Artisan command",
    Seeder: "Database seeder", Factory: "Model factory", Resource: "API resource",
    Policy: "Authorization policy", Observer: "Model observer", Rule: "Validation rule",
    Cast: "Attribute cast", Scope: "Query scope",
  };
  for (const [p, label] of Object.entries(types)) {
    if (parent === p || basename.endsWith(`${p}.php`)) return `${label}: ${className}`;
  }

  // Interface / Trait
  const iface = content.match(/interface\s+(\w+)/);
  if (iface) { const mc = (content.match(/public\s+function\s+\w+/g) || []).length; return `Interface: ${iface[1]} (${mc} methods)`; }
  const trait = content.match(/trait\s+(\w+)/);
  if (trait) return `Trait: ${trait[1]}`;

  // Generic class
  if (className && methods.length) return `${className}: ${methodList(methods, 4)}`;
  return "";
}

// ─── TypeScript / JavaScript ─────────────────────────────────
function extractTsJs(content: string, basename: string, ext: string): string {
  // React/Preact component
  if (ext === ".tsx" || ext === ".jsx") {
    const comp = content.match(/(?:export\s+(?:default\s+)?)?(?:function|const)\s+(\w+)/);
    const parts: string[] = [];
    if (comp) parts.push(comp[1]);

    // What it renders
    const renders: string[] = [];
    if (/<(?:form|Form)/i.test(content)) renders.push("form");
    if (/<(?:table|Table|DataTable)/i.test(content)) renders.push("table");
    if (/(?:Chart|Recharts|Victory|<canvas)/i.test(content)) renders.push("chart");
    if (/<(?:dialog|Dialog|Modal|Drawer)/i.test(content)) renders.push("modal");
    if (/<(?:map|Map|MapContainer)/i.test(content)) renders.push("map");
    if (renders.length) parts.push(`renders ${renders.join(", ")}`);

    // Key hooks
    const hooks = new Set<string>();
    const hr = /use(\w+)\(/g;
    let hm;
    while ((hm = hr.exec(content)) !== null) {
      const name = hm[1];
      if (["State", "Effect", "Ref", "Memo", "Callback", "Context", "Reducer", "Query", "Mutation",
           "Router", "Params", "Navigate", "SearchParams", "Form", "Fetcher"].includes(name)) {
        hooks.add(`use${name}`);
      }
    }
    if (hooks.size > 0 && hooks.size <= 4) parts.push(`uses ${[...hooks].join(", ")}`);

    // Data fetching
    if (content.includes("getServerSideProps") || content.includes("getStaticProps")) parts.push("SSR");
    if (content.includes("loader") && content.includes("useLoaderData")) parts.push("Remix loader");

    if (parts.length) return parts.join(" — ");
  }

  // Next.js app router conventions
  if (basename === "page.tsx" || basename === "page.js") return "Next.js page component";
  if (basename === "layout.tsx" || basename === "layout.js") return "Next.js layout";
  if (basename === "loading.tsx") return "Next.js loading UI";
  if (basename === "error.tsx") return "Next.js error boundary";
  if (basename === "not-found.tsx") return "Next.js 404 page";
  if (basename === "route.ts" || basename === "route.js") {
    const methods = [...new Set((content.match(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)/g) || [])
      .map(m => m.match(/(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)/)?.[1]))].filter(Boolean);
    return methods.length ? `Next.js API route: ${methods.join(", ")}` : "Next.js API route";
  }

  // Express/Fastify/Hono routes
  const routeHits = content.match(/\.(get|post|put|patch|delete)\s*\(\s*['"`]/g);
  if (routeHits && routeHits.length > 0) {
    const methods = [...new Set(routeHits.map(r => r.match(/\.(get|post|put|patch|delete)/)?.[1]?.toUpperCase()))];
    return `API routes: ${methods.join(", ")} (${routeHits.length} endpoints)`;
  }

  // tRPC router
  if (content.includes("createTRPCRouter") || content.includes("publicProcedure") || content.includes("protectedProcedure")) {
    const procs = (content.match(/\.(query|mutation|subscription)\s*\(/g) || []).length;
    return procs ? `tRPC router: ${procs} procedures` : "tRPC router";
  }

  // Zustand / Redux store
  if (content.includes("create(") && content.includes("set(")) return "Zustand store";
  if (content.includes("createSlice")) {
    const name = content.match(/name:\s*['"](\w+)['"]/);
    return name ? `Redux slice: ${name[1]}` : "Redux slice";
  }

  // Zod schemas
  if (content.includes("z.object") || content.includes("z.string") || content.includes("z.number")) {
    const schemas = (content.match(/(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*z\./g) || [])
      .map(s => s.match(/(?:const|let)\s+(\w+)/)?.[1]).filter(Boolean);
    if (schemas.length) return `Zod schemas: ${schemas.slice(0, 4).join(", ")}${schemas.length > 4 ? ` + ${schemas.length - 4} more` : ""}`;
  }

  // Prisma client usage
  if (content.includes("prisma.") && content.includes("findMany")) {
    return "Prisma data access layer";
  }

  // Exports summary
  const exports = (content.match(/export\s+(?:async\s+)?(?:function|class|const|interface|type|enum)\s+(\w+)/g) || [])
    .map(e => e.match(/(\w+)$/)?.[1]).filter(Boolean) as string[];
  if (exports.length > 0 && exports.length <= 5) return `Exports ${exports.join(", ")}`;
  if (exports.length > 5) return `Exports ${exports.slice(0, 4).join(", ")} + ${exports.length - 4} more`;

  return "";
}

// ─── Python ──────────────────────────────────────────────────
function extractPython(content: string, basename: string): string {
  // Django view
  if (content.includes("def get(self") || content.includes("def post(self") || content.includes("@api_view") || content.includes("APIView")) {
    const viewFuncs = (content.match(/def\s+(get|post|put|patch|delete|list|retrieve|create|update|destroy|perform_create)\s*\(/g) || [])
      .map(m => m.match(/def\s+(\w+)/)?.[1]).filter(Boolean);
    if (viewFuncs.length) return `View: ${viewFuncs.join(", ")}`;
  }

  // Django model
  if (content.includes("models.Model")) {
    const cls = content.match(/class\s+(\w+)\(.*models\.Model\)/);
    const fields = (content.match(/^\s+\w+\s*=\s*models\.\w+/gm) || []).length;
    const meta = content.match(/class\s+Meta:[\s\S]*?db_table\s*=\s*['"](\w+)['"]/);
    const parts: string[] = [];
    if (cls) parts.push(cls[1]);
    if (meta) parts.push(`table: ${meta[1]}`);
    parts.push(`${fields} fields`);
    return `Model: ${parts.join(", ")}`;
  }

  // Django serializer
  if (content.includes("serializers.") || content.includes("Serializer)")) {
    const cls = content.match(/class\s+(\w+).*Serializer/);
    return cls ? `Serializer: ${cls[1]}` : "DRF serializer";
  }

  // Django URL patterns
  if (content.includes("urlpatterns") || content.includes("path(")) {
    const paths = (content.match(/path\s*\(\s*['"]([^'"]*)['"]/g) || []).length;
    return paths ? `URL patterns: ${paths} routes` : "URL configuration";
  }

  // FastAPI / Starlette router
  if (content.includes("@router.") || content.includes("@app.")) {
    const routes = (content.match(/@(?:router|app)\.(get|post|put|patch|delete)\s*\(/g) || []);
    const paths = routes.map(r => r.match(/\.(get|post|put|patch|delete)/)?.[1]?.toUpperCase()).filter(Boolean);
    return routes.length ? `API: ${[...new Set(paths)].join(", ")} (${routes.length} endpoints)` : "API router";
  }

  // Flask
  if (content.includes("@app.route") || content.includes("@blueprint.route") || content.includes("Blueprint(")) {
    const routes = (content.match(/@(?:app|blueprint|\w+)\.route\s*\(/g) || []).length;
    return routes ? `Flask routes: ${routes} endpoints` : "Flask blueprint";
  }

  // Pydantic model
  if (content.includes("BaseModel") && content.includes("Field(")) {
    const cls = content.match(/class\s+(\w+)\(.*BaseModel\)/);
    const fields = (content.match(/^\s+\w+\s*:\s*\w+/gm) || []).length;
    return cls ? `Pydantic: ${cls[1]} (${fields} fields)` : `Pydantic model (${fields} fields)`;
  }

  // SQLAlchemy model
  if (content.includes("declarative_base") || content.includes("mapped_column") || content.includes("Column(")) {
    const cls = content.match(/class\s+(\w+)/);
    const table = content.match(/__tablename__\s*=\s*['"](\w+)['"]/);
    return cls ? `SQLAlchemy: ${cls[1]}${table ? ` (${table[1]})` : ""}` : "SQLAlchemy model";
  }

  // Celery task
  if (content.includes("@shared_task") || content.includes("@app.task") || content.includes("@celery.task")) {
    const tasks = (content.match(/def\s+(\w+)/g) || []).map(m => m.match(/def\s+(\w+)/)?.[1]).filter(n => n && !n.startsWith("_")) as string[];
    return tasks.length ? `Celery tasks: ${tasks.join(", ")}` : "Celery task";
  }

  // Pytest
  if (basename.startsWith("test_") || basename.endsWith("_test.py")) {
    const tests = (content.match(/def\s+test_(\w+)/g) || []).map(m => m.match(/test_(\w+)/)?.[1]).filter(Boolean);
    return tests.length ? `Tests: ${tests.slice(0, 4).join(", ")}${tests.length > 4 ? ` + ${tests.length - 4} more` : ""}` : "Test file";
  }

  // Generic class + functions
  const cls = content.match(/class\s+(\w+)/);
  const funcs = (content.match(/def\s+(\w+)/g) || [])
    .map(f => f.match(/def\s+(\w+)/)?.[1]).filter(n => n && !n.startsWith("_")) as string[];

  if (cls && funcs.length) {
    const display = funcs.slice(0, 4).join(", ");
    return funcs.length > 4 ? `${cls[1]}: ${display} + ${funcs.length - 4} more` : `${cls[1]}: ${display}`;
  }
  if (funcs.length) {
    return funcs.length > 4 ? `${funcs.slice(0, 4).join(", ")} + ${funcs.length - 4} more` : funcs.join(", ");
  }
  return "";
}

// ─── Go ──────────────────────────────────────────────────────
function extractGo(content: string): string {
  // HTTP handlers
  const handlers = (content.match(/func\s+(\w+)\s*\(\s*\w+\s+http\.ResponseWriter/g) || [])
    .map(m => m.match(/func\s+(\w+)/)?.[1]).filter(Boolean);
  if (handlers.length) return `HTTP handlers: ${handlers.slice(0, 5).join(", ")}${handlers.length > 5 ? ` + ${handlers.length - 5} more` : ""}`;

  // Interface
  const iface = content.match(/type\s+(\w+)\s+interface\s*\{/);
  if (iface) {
    const methods = (content.match(/^\s+(\w+)\s*\(/gm) || []).length;
    return `Interface: ${iface[1]} (${methods} methods)`;
  }

  // Struct
  const structMatch = content.match(/type\s+(\w+)\s+struct\s*\{/);
  if (structMatch) {
    const fields = (content.match(/^\s+\w+\s+\w+/gm) || []).length;
    const methods = (content.match(/func\s+\(\w+\s+\*?\w+\)\s+(\w+)/g) || [])
      .map(m => m.match(/\)\s+(\w+)/)?.[1]).filter(n => n && n[0] === n[0].toUpperCase()) as string[];
    const parts: string[] = [`${structMatch[1]} (${fields} fields)`];
    if (methods.length) parts.push(`methods: ${methods.slice(0, 4).join(", ")}`);
    return parts.join("; ");
  }

  // Package functions
  const funcs = (content.match(/^func\s+(\w+)/gm) || [])
    .map(m => m.match(/func\s+(\w+)/)?.[1]).filter(n => n && n[0] === n[0].toUpperCase()) as string[];
  if (funcs.length) return funcs.length > 5 ? `${funcs.slice(0, 4).join(", ")} + ${funcs.length - 4} more` : funcs.join(", ");
  return "";
}

// ─── Rust ────────────────────────────────────────────────────
function extractRust(content: string): string {
  // Struct + impl
  const structM = content.match(/pub\s+struct\s+(\w+)/);
  if (structM) {
    const methods = (content.match(/pub\s+(?:async\s+)?fn\s+(\w+)/g) || [])
      .map(m => m.match(/fn\s+(\w+)/)?.[1]).filter(Boolean);
    if (methods.length) return `${structM[1]}: ${methods.slice(0, 4).join(", ")}${methods.length > 4 ? ` + ${methods.length - 4} more` : ""}`;
    return `Struct: ${structM[1]}`;
  }

  // Trait
  const traitM = content.match(/pub\s+trait\s+(\w+)/);
  if (traitM) {
    const fns = (content.match(/fn\s+(\w+)/g) || []).length;
    return `Trait: ${traitM[1]} (${fns} methods)`;
  }

  // Enum
  const enumM = content.match(/pub\s+enum\s+(\w+)/);
  if (enumM) {
    const variants = (content.match(/^\s+(\w+)[\s({,]/gm) || []).length;
    return `Enum: ${enumM[1]} (${variants} variants)`;
  }

  // Actix/Axum handlers
  const handlers = (content.match(/#\[(?:get|post|put|patch|delete)\s*\("/g) || []).length;
  if (handlers) return `Web handlers: ${handlers} endpoints`;

  // Public functions
  const fns = (content.match(/pub\s+(?:async\s+)?fn\s+(\w+)/g) || [])
    .map(m => m.match(/fn\s+(\w+)/)?.[1]).filter(Boolean);
  if (fns.length) return fns.length > 5 ? `${fns.slice(0, 4).join(", ")} + ${fns.length - 4} more` : fns.join(", ");
  return "";
}

// ─── Java ────────────────────────────────────────────────────
function extractJava(content: string, basename: string): string {
  const cls = content.match(/(?:public\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/);
  const className = cls?.[1] || basename.replace(".java", "");
  const parent = cls?.[2] || "";

  // Spring annotations
  const annotations = (content.match(/@(RestController|Controller|Service|Repository|Component|Entity|Configuration)/g) || [])
    .map(a => a.slice(1));

  // Spring endpoints
  const mappings = (content.match(/@(?:Get|Post|Put|Patch|Delete|Request)Mapping/g) || []).length;
  if (mappings) return `${annotations[0] || "Spring"}: ${className} (${mappings} endpoints)`;
  if (annotations.length) return `${annotations[0]}: ${className}`;

  // JPA Entity
  if (content.includes("@Entity") || content.includes("@Table")) {
    const table = content.match(/@Table\s*\(\s*name\s*=\s*"(\w+)"/);
    return table ? `Entity: ${className} (table: ${table[1]})` : `Entity: ${className}`;
  }

  // Public methods
  const methods = (content.match(/public\s+(?:static\s+)?(?:\w+(?:<[\w,\s]+>)?)\s+(\w+)\s*\(/g) || [])
    .map(m => m.match(/(\w+)\s*\(/)?.[1]).filter(n => n && n !== className) as string[];
  if (methods.length) return `${className}: ${methods.slice(0, 4).join(", ")}${methods.length > 4 ? ` + ${methods.length - 4} more` : ""}`;
  return className ? `Class: ${className}` : "";
}

// ─── Kotlin ──────────────────────────────────────────────────
function extractKotlin(content: string, basename: string): string {
  const cls = content.match(/(?:data\s+)?class\s+(\w+)/);
  const className = cls?.[1] || basename.replace(/\.kts?$/, "");

  // Data class (brief)
  if (content.match(/data\s+class/)) {
    const props = (content.match(/val\s+\w+:/g) || []).length + (content.match(/var\s+\w+:/g) || []).length;
    return `Data class: ${className} (${props} properties)`;
  }

  // Ktor / Spring
  if (content.includes("routing {") || content.includes("route(")) {
    const routes = (content.match(/(?:get|post|put|patch|delete)\s*\(\s*"/g) || []).length;
    return routes ? `Ktor routes: ${routes} endpoints` : "Ktor routing";
  }

  // Functions
  const fns = (content.match(/fun\s+(\w+)/g) || [])
    .map(m => m.match(/fun\s+(\w+)/)?.[1]).filter(Boolean);
  if (cls && fns.length) return `${className}: ${fns.slice(0, 4).join(", ")}${fns.length > 4 ? ` + ${fns.length - 4} more` : ""}`;
  if (fns.length) return fns.slice(0, 5).join(", ");
  return "";
}

// ─── C# / .NET ───────────────────────────────────────────────
function extractCSharp(content: string, basename: string): string {
  const cls = content.match(/(?:public\s+)?(?:partial\s+)?class\s+(\w+)(?:\s*:\s*(\w+))?/);
  const className = cls?.[1] || basename.replace(".cs", "");
  const parent = cls?.[2] || "";

  // ASP.NET Controller
  if (parent === "Controller" || parent === "ControllerBase" || content.includes("[ApiController]")) {
    const actions = (content.match(/\[Http(Get|Post|Put|Patch|Delete)\]/g) || [])
      .map(a => a.match(/Http(\w+)/)?.[1]).filter(Boolean);
    return actions.length ? `API Controller: ${className} (${[...new Set(actions)].join(", ")})` : `Controller: ${className}`;
  }

  // EF DbContext
  if (parent === "DbContext" || content.includes("DbSet<")) {
    const sets = (content.match(/DbSet<(\w+)>/g) || []).map(s => s.match(/<(\w+)>/)?.[1]).filter(Boolean);
    return sets.length ? `DbContext: ${sets.join(", ")}` : `DbContext: ${className}`;
  }

  // EF Entity
  if (content.includes("[Table(") || content.includes("[Key]")) {
    return `Entity: ${className}`;
  }

  // Interface
  if (content.match(/interface\s+I\w+/)) {
    const methods = (content.match(/\w+\s+\w+\s*\(/g) || []).length;
    return `Interface: ${className} (${methods} members)`;
  }

  // Public methods
  const methods = (content.match(/public\s+(?:async\s+)?(?:static\s+)?(?:virtual\s+)?(?:override\s+)?(?:\w+(?:<[\w,\s]+>)?)\s+(\w+)\s*\(/g) || [])
    .map(m => m.match(/(\w+)\s*\(/)?.[1]).filter(n => n && n !== className) as string[];
  if (methods.length) return `${className}: ${methods.slice(0, 4).join(", ")}${methods.length > 4 ? ` + ${methods.length - 4} more` : ""}`;
  return className ? `Class: ${className}` : "";
}

// ─── Ruby / Rails ────────────────────────────────────────────
function extractRuby(content: string, basename: string): string {
  const cls = content.match(/class\s+(\w+)(?:\s*<\s*(\w+(?:::\w+)?))?/);
  const className = cls?.[1] || "";
  const parent = cls?.[2] || "";

  // Rails controller
  if (parent?.includes("Controller") || basename.endsWith("_controller.rb")) {
    const actions = (content.match(/def\s+(index|show|new|create|edit|update|destroy|search|\w+)/g) || [])
      .map(m => m.match(/def\s+(\w+)/)?.[1]).filter(n => n && !n.startsWith("_")) as string[];
    return actions.length ? `Controller: ${actions.join(", ")}` : `Controller: ${className}`;
  }

  // Rails model
  if (parent === "ApplicationRecord" || parent === "ActiveRecord::Base") {
    const assocs = (content.match(/(?:has_many|has_one|belongs_to|has_and_belongs_to_many)\s+:(\w+)/g) || [])
      .map(m => m.match(/:(\w+)/)?.[1]).filter(Boolean);
    const validations = (content.match(/validates\s/g) || []).length;
    const scopes = (content.match(/scope\s+:(\w+)/g) || []).length;
    const parts: string[] = [];
    if (assocs.length) parts.push(`assocs: ${assocs.join(", ")}`);
    if (validations) parts.push(`${validations} validations`);
    if (scopes) parts.push(`${scopes} scopes`);
    return parts.length ? `Model: ${className} — ${parts.join(", ")}` : `Model: ${className}`;
  }

  // Rails migration
  if (basename.match(/^\d{14}_/)) {
    const create = content.match(/create_table\s+:(\w+)/);
    if (create) return `Migration: create ${create[1]}`;
    const change = content.match(/(?:add|remove|rename)_column\s+:(\w+)/);
    if (change) return `Migration: alter ${change[1]}`;
    return "Database migration";
  }

  // Methods
  const methods = (content.match(/def\s+(\w+)/g) || [])
    .map(m => m.match(/def\s+(\w+)/)?.[1]).filter(n => n && !n.startsWith("_")) as string[];
  if (cls && methods.length) return `${className}: ${methods.slice(0, 4).join(", ")}${methods.length > 4 ? ` + ${methods.length - 4} more` : ""}`;
  if (methods.length) return methods.slice(0, 5).join(", ");
  return "";
}

// ─── Swift ───────────────────────────────────────────────────
function extractSwift(content: string): string {
  // SwiftUI View
  if (content.includes(": View") || content.includes("some View")) {
    const name = content.match(/struct\s+(\w+)\s*:\s*View/);
    return name ? `SwiftUI view: ${name[1]}` : "SwiftUI view";
  }

  const struct = content.match(/(?:public\s+)?struct\s+(\w+)/);
  const cls = content.match(/(?:public\s+)?class\s+(\w+)/);
  const proto = content.match(/protocol\s+(\w+)/);

  if (proto) {
    const reqs = (content.match(/func\s+(\w+)/g) || []).length;
    return `Protocol: ${proto[1]} (${reqs} requirements)`;
  }

  const name = struct?.[1] || cls?.[1] || "";
  const funcs = (content.match(/func\s+(\w+)/g) || [])
    .map(m => m.match(/func\s+(\w+)/)?.[1]).filter(Boolean);

  if (name && funcs.length) return `${name}: ${funcs.slice(0, 4).join(", ")}${funcs.length > 4 ? ` + ${funcs.length - 4} more` : ""}`;
  return "";
}

// ─── Dart / Flutter ──────────────────────────────────────────
function extractDart(content: string, basename: string): string {
  // Flutter widget
  if (content.includes("StatefulWidget") || content.includes("StatelessWidget")) {
    const name = content.match(/class\s+(\w+)\s+extends\s+(?:Stateful|Stateless)Widget/);
    const type = content.includes("StatefulWidget") ? "Stateful" : "Stateless";
    return name ? `${type} widget: ${name[1]}` : `${type} widget`;
  }

  // Riverpod/Provider
  if (content.includes("@riverpod") || content.includes("Provider(")) {
    return "Riverpod provider";
  }

  const cls = content.match(/class\s+(\w+)/);
  const methods = (content.match(/(?:void|Future|String|int|bool|dynamic|Widget)\s+(\w+)\s*\(/g) || [])
    .map(m => m.match(/(\w+)\s*\(/)?.[1]).filter(Boolean);

  if (cls && methods.length) return `${cls[1]}: ${methods.slice(0, 4).join(", ")}`;
  return "";
}

// ─── Vue ─────────────────────────────────────────────────────
function extractVue(content: string): string {
  const name = content.match(/name:\s*['"]([^'"]+)['"]/);
  const setup = content.includes("<script setup");
  const ts = content.includes('lang="ts"');

  // Props
  const propsMatch = content.match(/defineProps<\{([^}]+)\}>/s) || content.match(/props:\s*\{([^}]+)\}/s);
  const propCount = propsMatch ? (propsMatch[1].match(/\w+\s*[:\?]/g) || []).length : 0;

  // Emits
  const emits = (content.match(/defineEmits|emit\s*\(/g) || []).length;

  const parts: string[] = [];
  if (name) parts.push(name[1]);
  if (setup) parts.push("setup");
  if (ts) parts.push("TS");
  if (propCount) parts.push(`${propCount} props`);
  if (emits) parts.push(`emits`);

  return parts.length ? `Vue: ${parts.join(", ")}` : "Vue component";
}

// ─── Svelte ──────────────────────────────────────────────────
function extractSvelte(content: string, basename: string): string {
  const ts = content.includes('lang="ts"');
  const props = (content.match(/export\s+let\s+(\w+)/g) || []).length;
  const stores = (content.match(/\$\w+/g) || []).length;
  const parts: string[] = [basename.replace(".svelte", "")];
  if (ts) parts.push("TS");
  if (props) parts.push(`${props} props`);
  if (stores) parts.push(`${stores} stores`);
  return `Svelte: ${parts.join(", ")}`;
}

// ─── Astro ───────────────────────────────────────────────────
function extractAstro(content: string, basename: string): string {
  const imports = (content.match(/import\s+\w+\s+from/g) || []).length;
  const slots = (content.match(/<slot/g) || []).length;
  const parts: string[] = [basename.replace(".astro", "")];
  if (slots) parts.push(`${slots} slot(s)`);
  if (imports > 3) parts.push(`${imports} imports`);
  return `Astro: ${parts.join(", ")}`;
}

// ─── CSS / SCSS / Less ───────────────────────────────────────
function extractCss(content: string): string {
  const rules = (content.match(/^[.#@][^\n{]+/gm) || []).length;
  const media = (content.match(/@media/g) || []).length;
  const animations = (content.match(/@keyframes\s+(\w+)/g) || []).length;
  const vars = (content.match(/--[\w-]+\s*:/g) || []).length;
  const layers = (content.match(/@layer/g) || []).length;

  const parts: string[] = [];
  if (rules) parts.push(`${rules} rules`);
  if (vars) parts.push(`${vars} vars`);
  if (media) parts.push(`${media} media queries`);
  if (animations) parts.push(`${animations} animations`);
  if (layers) parts.push(`${layers} layers`);
  return parts.length ? `Styles: ${parts.join(", ")}` : "";
}

// ─── SQL ─────────────────────────────────────────────────────
function extractSql(content: string): string {
  const creates = (content.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?(\w+)/gi) || [])
    .map(m => m.match(/(?:TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?)([`"']?\w+)/i)?.[1]?.replace(/[`"']/g, "")).filter(Boolean);
  const alters = (content.match(/ALTER\s+TABLE\s+[`"']?(\w+)/gi) || []).length;
  const views = (content.match(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW/gi) || []).length;
  const functions = (content.match(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION/gi) || []).length;

  const parts: string[] = [];
  if (creates.length) parts.push(`tables: ${creates.slice(0, 4).join(", ")}`);
  if (alters) parts.push(`${alters} alter(s)`);
  if (views) parts.push(`${views} view(s)`);
  if (functions) parts.push(`${functions} function(s)`);
  return parts.length ? `SQL: ${parts.join(", ")}` : "";
}

// ─── Protocol Buffers ────────────────────────────────────────
function extractProto(content: string): string {
  const msgs = (content.match(/message\s+(\w+)/g) || []).map(m => m.match(/message\s+(\w+)/)?.[1]).filter(Boolean);
  const services = (content.match(/service\s+(\w+)/g) || []).map(m => m.match(/service\s+(\w+)/)?.[1]).filter(Boolean);
  const parts: string[] = [];
  if (msgs.length) parts.push(`messages: ${msgs.slice(0, 3).join(", ")}`);
  if (services.length) parts.push(`services: ${services.join(", ")}`);
  return parts.length ? `Proto: ${parts.join(", ")}` : "";
}

// ─── GraphQL ─────────────────────────────────────────────────
function extractGraphQL(content: string): string {
  const types = (content.match(/type\s+(\w+)/g) || []).map(m => m.match(/type\s+(\w+)/)?.[1]).filter(Boolean);
  const queries = (content.match(/(?:query|mutation|subscription)\s+(\w+)/g) || []).length;
  const parts: string[] = [];
  if (types.length) parts.push(`types: ${types.slice(0, 4).join(", ")}`);
  if (queries) parts.push(`${queries} operations`);
  return parts.length ? `GraphQL: ${parts.join(", ")}` : "";
}

// ─── YAML ────────────────────────────────────────────────────
function extractYaml(content: string, basename: string): string {
  // GitHub Actions
  if (content.includes("runs-on:") || content.includes("uses:")) {
    const name = content.match(/^name:\s*(.+)$/m);
    return name ? `CI: ${name[1].trim()}` : "GitHub Actions workflow";
  }
  // Kubernetes
  if (content.includes("apiVersion:") && content.includes("kind:")) {
    const kind = content.match(/kind:\s*(\w+)/);
    const name = content.match(/name:\s*(\S+)/);
    return kind ? `K8s ${kind[1]}${name ? `: ${name[1]}` : ""}` : "Kubernetes manifest";
  }
  // Docker Compose
  if (content.includes("services:") && (basename.includes("docker") || basename.includes("compose"))) {
    const services = (content.match(/^\s{2}\w+:/gm) || []).length;
    return `Docker Compose: ${services} services`;
  }
  return "";
}

// ─── TOML ────────────────────────────────────────────────────
function extractToml(content: string, basename: string): string {
  if (basename === "Cargo.toml") {
    const name = content.match(/^name\s*=\s*"([^"]+)"/m);
    const desc = content.match(/^description\s*=\s*"([^"]+)"/m);
    return desc ? desc[1] : name ? `Rust crate: ${name[1]}` : "Rust package manifest";
  }
  if (basename === "pyproject.toml") {
    const name = content.match(/^name\s*=\s*"([^"]+)"/m);
    const desc = content.match(/^description\s*=\s*"([^"]+)"/m);
    return desc ? desc[1] : name ? `Python project: ${name[1]}` : "Python project configuration";
  }
  return "";
}

// ─── Elixir ──────────────────────────────────────────────────
function extractElixir(content: string): string {
  const mod = content.match(/defmodule\s+([\w.]+)/);
  const fns = (content.match(/def\s+(\w+)/g) || []).map(m => m.match(/def\s+(\w+)/)?.[1]).filter(Boolean);

  // Phoenix controller/live view
  if (content.includes("use") && content.includes("Controller")) {
    return mod ? `Phoenix controller: ${mod[1]}` : "Phoenix controller";
  }
  if (content.includes("Phoenix.LiveView")) {
    return mod ? `LiveView: ${mod[1]}` : "Phoenix LiveView";
  }

  if (mod && fns.length) return `${mod[1]}: ${fns.slice(0, 4).join(", ")}`;
  return mod ? mod[1] : "";
}

// ─── Lua ─────────────────────────────────────────────────────
function extractLua(content: string): string {
  const fns = (content.match(/function\s+(?:\w+[.:])?(\w+)/g) || [])
    .map(m => m.match(/(\w+)\s*$/)?.[1]).filter(Boolean);
  if (fns.length) return fns.length > 5 ? `${fns.slice(0, 4).join(", ")} + ${fns.length - 4} more` : fns.join(", ");
  return "";
}

// ─── Zig ─────────────────────────────────────────────────────
function extractZig(content: string): string {
  const fns = (content.match(/pub\s+fn\s+(\w+)/g) || [])
    .map(m => m.match(/fn\s+(\w+)/)?.[1]).filter(Boolean);
  if (fns.length) return fns.length > 5 ? `${fns.slice(0, 4).join(", ")} + ${fns.length - 4} more` : fns.join(", ");
  return "";
}

// ─── Generic fallback ────────────────────────────────────────
function extractGenericFallback(content: string): string {
  // Try exports
  const exp = content.match(/export\s+(?:default\s+)?(?:function|class|const|interface|type|enum)\s+(\w+)/);
  if (exp) return `Exports ${exp[1]}`;

  // Try class with methods
  const cls = content.match(/(?:function|class|const|interface|type|enum)\s+(\w+)/);
  if (cls) {
    const name = cls[1];
    const methods = (content.match(/(?:public\s+)?(?:async\s+)?(?:function\s+|(?:get|set)\s+)(\w+)\s*\(/g) || [])
      .map(m => m.match(/(\w+)\s*\(/)?.[1])
      .filter(n => n && n !== name && n !== "__construct" && n !== "constructor") as string[];

    if (methods.length > 0 && methods.length <= 5) return `${name}: ${methods.join(", ")}`;
    if (methods.length > 5) return `${name}: ${methods.slice(0, 3).join(", ")} + ${methods.length - 3} more`;
    return `Declares ${name}`;
  }

  return "";
}

// ─── Utility ─────────────────────────────────────────────────
export function capDescription(desc: string, max: number = MAX_DESC): string {
  if (desc.length <= max) return desc;
  return desc.slice(0, max - 3) + "...";
}
