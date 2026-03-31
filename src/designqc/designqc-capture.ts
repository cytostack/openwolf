import * as fs from "node:fs";
import * as path from "node:path";
import * as http from "node:http";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import type { Viewport, Screenshot } from "./designqc-types.js";

export function findChromePath(configPath?: string | null): string {
  if (configPath && fs.existsSync(configPath)) return configPath;

  if (process.platform === "win32") {
    const candidates = [
      path.join(process.env["PROGRAMFILES"] || "C:\\Program Files", "Google\\Chrome\\Application\\chrome.exe"),
      path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google\\Chrome\\Application\\chrome.exe"),
      path.join(process.env["LOCALAPPDATA"] || "", "Google\\Chrome\\Application\\chrome.exe"),
      path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Microsoft\\Edge\\Application\\msedge.exe"),
      path.join(process.env["PROGRAMFILES"] || "C:\\Program Files", "Microsoft\\Edge\\Application\\msedge.exe"),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    try {
      const r = execSync("where chrome", { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }).trim();
      if (r) return r.split("\n")[0].trim();
    } catch {}
    try {
      const r = execSync("where msedge", { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }).trim();
      if (r) return r.split("\n")[0].trim();
    } catch {}
  } else if (process.platform === "darwin") {
    for (const c of [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ]) {
      if (fs.existsSync(c)) return c;
    }
  } else {
    try {
      return execSync("which google-chrome || which chromium || which chromium-browser", {
        encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"],
      }).trim().split("\n")[0];
    } catch {}
  }

  throw new Error("Chrome/Edge not found. Install Chrome or set designqc.chrome_path in .wolf/config.json");
}

/**
 * Capture a full page as sectioned viewport-height screenshots.
 * Returns multiple screenshots — one per "fold" of the page.
 * This gives Claude focused views of each section without one massive image.
 */
export async function captureRouteSectioned(
  page: import("puppeteer-core").Page,
  url: string,
  viewport: Viewport,
  outputDir: string,
  quality: number,
  maxWidth: number,
): Promise<Screenshot[]> {
  const scale = maxWidth < viewport.width ? maxWidth / viewport.width : 1;
  const captureWidth = Math.round(viewport.width * scale);
  const captureHeight = Math.round(viewport.height * scale);

  await page.setViewport({ width: captureWidth, height: captureHeight });
  await page.goto(url, { waitUntil: "networkidle2", timeout: 30_000 });
  await new Promise((r) => setTimeout(r, 1500));

  // Get full page height
  const fullHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  const route = new URL(url).pathname;
  const safeName = route.replace(/\//g, "_").replace(/^_/, "") || "root";

  const screenshots: Screenshot[] = [];
  const sectionHeight = captureHeight;
  const totalSections = Math.ceil(fullHeight / sectionHeight);
  // Cap at 8 sections (~20K tokens) to avoid runaway costs
  const maxSections = Math.min(totalSections, 8);

  for (let i = 0; i < maxSections; i++) {
    const y = i * sectionHeight;

    // Scroll to position
    await page.evaluate((scrollY: number) => window.scrollTo(0, scrollY), y);
    await new Promise((r) => setTimeout(r, 500));

    const screenshotBuffer = await page.screenshot({
      fullPage: false,
      type: "jpeg",
      quality,
    });

    const sectionLabel = i === 0 ? "top" : i === maxSections - 1 ? "bottom" : `section${i + 1}`;
    const fileName = `${safeName}_${viewport.name}_${sectionLabel}.jpg`;
    const filePath = path.join(outputDir, fileName);

    fs.writeFileSync(filePath, screenshotBuffer);
    screenshots.push({ route, viewport, path: filePath });
  }

  return screenshots;
}

export function detectRoutes(projectRoot: string): string[] {
  const routes: string[] = ["/"];

  const dirs = [
    path.join(projectRoot, "pages"),
    path.join(projectRoot, "app"),
    path.join(projectRoot, "src", "pages"),
    path.join(projectRoot, "src", "app"),
  ].filter((d) => fs.existsSync(d));

  for (const dir of dirs) {
    try {
      const files = fs.readdirSync(dir, { recursive: true }) as string[];
      for (const file of files) {
        const f = String(file).replace(/\\/g, "/");
        if (f.includes("api/") || f.includes("_") || f.includes("layout.")) continue;
        if (f.endsWith(".tsx") || f.endsWith(".jsx") || f.endsWith(".ts") || f.endsWith(".js")) {
          let route = "/" + f
            .replace(/\.(tsx|jsx|ts|js)$/, "")
            .replace(/\/index$/, "")
            .replace(/\/page$/, "");
          if (route === "/") continue;
          routes.push(route);
        }
      }
    } catch {}
  }

  return [...new Set(routes)].slice(0, 10);
}

export async function probePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}`, () => resolve(true));
    req.on("error", () => resolve(false));
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
  });
}

/**
 * Try to find a running dev server on common ports.
 */
/**
 * Try to detect the project's deployed/production URL from common config files.
 * Checks: package.json homepage, .env.production URL vars, vercel.json aliases.
 * Returns null if nothing found — caller should fall back to local dev server.
 */
export function detectDeployedUrl(projectRoot: string): string | null {
  // 1. package.json "homepage" (CRA, Next.js, many others)
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8"));
    if (typeof pkg.homepage === "string" && pkg.homepage.startsWith("http")) {
      return pkg.homepage;
    }
  } catch {}

  // 2. Common env files — look for a production URL variable
  const envFiles = [".env.production", ".env.production.local", ".env.local", ".env"];
  const urlVarNames = [
    "NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_URL", "NEXT_PUBLIC_APP_URL",
    "NUXT_PUBLIC_SITE_URL", "VITE_APP_URL", "VITE_APP_BASE_URL",
    "PUBLIC_URL", "APP_URL", "SITE_URL", "BASE_URL",
  ];
  for (const envFile of envFiles) {
    try {
      const content = fs.readFileSync(path.join(projectRoot, envFile), "utf-8");
      for (const varName of urlVarNames) {
        const match = content.match(new RegExp(`^${varName}=["']?([^"'\\s]+)["']?`, "m"));
        if (match && match[1].startsWith("http")) {
          return match[1].trim();
        }
      }
    } catch {}
  }

  // 3. vercel.json "alias" or "aliases" field
  try {
    const vercelJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "vercel.json"), "utf-8"));
    const aliases: unknown = vercelJson.alias ?? vercelJson.aliases;
    if (Array.isArray(aliases) && aliases.length > 0 && typeof aliases[0] === "string") {
      const alias = aliases[0] as string;
      return alias.startsWith("http") ? alias : `https://${alias}`;
    }
  } catch {}

  return null;
}

export async function detectDevServer(): Promise<{ url: string; port: number } | null> {
  const commonPorts = [3000, 3001, 5173, 5174, 4321, 8080, 8000, 4200];
  for (const port of commonPorts) {
    if (await probePort(port)) {
      return { url: `http://localhost:${port}`, port };
    }
  }
  return null;
}

/**
 * Detect the dev command from package.json.
 * Returns { command, port } or null.
 */
export function detectDevCommand(projectRoot: string): { command: string; expectedPort: number } | null {
  const pkgPath = path.join(projectRoot, "package.json");
  if (!fs.existsSync(pkgPath)) return null;

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const scripts = pkg.scripts || {};

    // Priority order: dev, start, serve
    for (const key of ["dev", "start", "serve"]) {
      if (scripts[key]) {
        // Try to detect port from the script
        const portMatch = scripts[key].match(/-p\s+(\d+)|--port\s+(\d+)|PORT=(\d+)/);
        let port = 3000;
        if (portMatch) {
          port = parseInt(portMatch[1] || portMatch[2] || portMatch[3], 10);
        } else if (scripts[key].includes("vite")) {
          port = 5173;
        } else if (scripts[key].includes("next")) {
          port = 3000;
        } else if (scripts[key].includes("astro")) {
          port = 4321;
        } else if (scripts[key].includes("angular") || scripts[key].includes("ng serve")) {
          port = 4200;
        }

        // Determine package manager
        let runner = "npm run";
        if (fs.existsSync(path.join(projectRoot, "pnpm-lock.yaml"))) runner = "pnpm";
        else if (fs.existsSync(path.join(projectRoot, "yarn.lock"))) runner = "yarn";
        else if (fs.existsSync(path.join(projectRoot, "bun.lockb"))) runner = "bun run";

        return { command: `${runner} ${key}`, expectedPort: port };
      }
    }
  } catch {}

  return null;
}

/**
 * Start the dev server, wait for it to be ready, return the process handle.
 * Caller is responsible for killing the process.
 */
export async function startDevServer(
  projectRoot: string,
): Promise<{ proc: ChildProcess; url: string; port: number } | null> {
  const devCmd = detectDevCommand(projectRoot);
  if (!devCmd) {
    console.error("  No dev script found in package.json (looked for: dev, start, serve)");
    return null;
  }

  console.log(`  Starting dev server: ${devCmd.command}`);

  const proc = spawn(devCmd.command, {
    cwd: projectRoot,
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  // Wait for server to be ready (poll port)
  const port = devCmd.expectedPort;
  const maxWait = 30_000;
  const start = Date.now();
  let ready = false;

  while (Date.now() - start < maxWait) {
    // Check if process died
    if (proc.exitCode !== null) {
      console.error(`  Dev server exited with code ${proc.exitCode}`);
      return null;
    }

    if (await probePort(port)) {
      ready = true;
      break;
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  if (!ready) {
    // Try nearby ports in case the detected port was wrong
    for (const p of [3000, 3001, 5173, 5174, 4321, 8080]) {
      if (p !== port && await probePort(p)) {
        console.log(`  Server responded on port ${p} (expected ${port})`);
        return { proc, url: `http://localhost:${p}`, port: p };
      }
    }
    console.error(`  Dev server did not respond on port ${port} within ${maxWait / 1000}s`);
    proc.kill();
    return null;
  }

  return { proc, url: `http://localhost:${port}`, port };
}
