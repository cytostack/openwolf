import * as fs from "node:fs";
import * as path from "node:path";

const PAGE_EXTENSIONS = [".tsx", ".jsx", ".ts", ".js", ".vue", ".astro", ".svelte"];
const ROUTE_DIRS = ["src/pages", "pages", "src/app", "app"];
const INDEX_NAMES = new Set(["index", "index.jsx", "index.tsx", "index.js", "index.ts", "index.vue", "index.astro", "index.svelte"]);
const IGNORED_SEGMENTS = new Set(["_app", "_document", "_error", "api", "layout"]);

function segmentIsDynamic(seg: string): boolean {
  return seg.startsWith("[") && seg.endsWith("]");
}

/**
 * File-system route detection for common frameworks.
 * - Next.js: `app/` and `pages/` directories
 * - Vite / React Router: `pages/` directory
 * - Astro: `src/pages/` directory
 * Dynamic segments (`[id]`) and api/layout helpers are skipped.
 */
export function detectRoutes(projectRoot: string): string[] {
  const routes = new Set<string>(["/"]);

  for (const rel of ROUTE_DIRS) {
    const dir = path.join(projectRoot, rel);
    if (!fs.existsSync(dir)) continue;
    walk(projectRoot, dir, rel, routes);
  }

  return [...routes].sort();
}

function walk(projectRoot: string, dir: string, relBase: string, routes: Set<string>): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (IGNORED_SEGMENTS.has(entry.name) || segmentIsDynamic(entry.name)) continue;
      walk(projectRoot, full, relBase, routes);
      continue;
    }

    const ext = path.extname(entry.name);
    if (!PAGE_EXTENSIONS.includes(ext)) continue;
    if (!/^page\.|^index\./.test(entry.name)) continue;

    const rel = path.relative(projectRoot, full);
    const relDir = path.dirname(rel).split(/[\\/]/);
    const baseIndex = relDir.findIndex(seg => seg === relBase.split(/[\\/]/)[0]);
    const fromBase = baseIndex === -1 ? [] : relDir.slice(baseIndex + 1).filter(seg => !IGNORED_SEGMENTS.has(seg) && !segmentIsDynamic(seg));

    const isIndex = /^index\./.test(entry.name);
    const segments = isIndex ? fromBase : [...fromBase, entry.name.replace(ext, "")];
    const route = "/" + segments.filter(Boolean).join("/");
    routes.add(route === "/" ? "/" : route.replace(/\/+$/, ""));
  }
}
