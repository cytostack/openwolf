import * as fs from "node:fs";
import * as path from "node:path";
import { findProjectRoot } from "../scanner/project-root.js";
import { readJSON, writeJSON } from "../utils/fs-safe.js";
import { detectBrowser } from "./designqc-browser.js";
import { detectRunningServer, startDevServer, type StartedServer } from "./designqc-server.js";
import { detectRoutes } from "./designqc-routes.js";

interface DesignQcConfig {
  enabled: boolean;
  viewports: { name: string; width: number; height: number }[];
  max_screenshots: number;
  chrome_path: string | null;
}

const DEFAULT_CONFIG: DesignQcConfig = {
  enabled: true,
  viewports: [
    { name: "desktop", width: 1440, height: 900 },
    { name: "mobile", width: 375, height: 812 },
  ],
  max_screenshots: 6,
  chrome_path: null,
};

export interface DesignQcOptions {
  url?: string;
  routes?: string[];
  desktopOnly?: boolean;
  quality?: string;
  maxWidth?: string;
}

interface Capture {
  file: string;
  route: string;
  viewport: string;
  fold: number;
  bytes: number;
}

function slugify(p: string): string {
  const s = p
    .replace(/[/\\:*?"<>|]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "index";
}

function wait(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function captureRoute(
  browser: import("puppeteer-core").Browser,
  baseUrl: string,
  viewports: DesignQcConfig["viewports"],
  maxScreenshots: number,
  quality: number,
  dir: string
): Promise<Capture[]> {
  const route = slugify(new URL(baseUrl).pathname);
  const captures: Capture[] = [];

  for (const vp of viewports) {
    const page = await browser.newPage();
    await page.setViewport({ width: vp.width, height: vp.height });
    await page
      .goto(baseUrl, { waitUntil: "networkidle2", timeout: 30000 })
      .catch(() => page.goto(baseUrl, { waitUntil: "load", timeout: 30000 }));
    await page.evaluate(() => (document as Document).fonts?.ready).catch(() => {});

    const fullHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    let y = 0;
    let fold = 0;
    while (y < fullHeight && fold < maxScreenshots) {
      await page.evaluate((yy: number) => window.scrollTo(0, yy), y);
      await wait(200);
      const file = `${route}__${vp.name}__${String(fold + 1).padStart(2, "0")}.jpg`;
      const filePath = path.join(dir, file);
      await page.screenshot({ path: filePath, type: "jpeg", quality });
      captures.push({ file, route, viewport: vp.name, fold: fold + 1, bytes: fs.statSync(filePath).size });
      y += vp.height;
      fold++;
    }
    await page.close();
  }

  return captures;
}

export async function designqcCommand(options: DesignQcOptions): Promise<void> {
  const projectRoot = findProjectRoot();
  const wolfDir = path.join(projectRoot, ".wolf");
  if (!fs.existsSync(wolfDir)) {
    console.error("OpenWolf not initialized. Run: openwolf init");
    process.exit(1);
  }

  const loaded = readJSON<{ designqc?: Partial<DesignQcConfig> }>(path.join(wolfDir, "config.json"), { designqc: {} });
  const cfg: DesignQcConfig = { ...DEFAULT_CONFIG, ...(loaded.designqc ?? {}) };
  if (!cfg.viewports?.length) cfg.viewports = DEFAULT_CONFIG.viewports;
  if (!cfg.enabled) {
    console.log("designqc is disabled in .wolf/config.json");
    return;
  }

  let puppeteer: typeof import("puppeteer-core");
  try {
    puppeteer = (await import("puppeteer-core")).default;
  } catch {
    console.error("puppeteer-core is required for designqc. Install it with: npm install puppeteer-core");
    process.exit(1);
  }

  const browserInfo = detectBrowser(cfg.chrome_path);
  if (!browserInfo) {
    console.error(
      "No Chromium-based browser found (Chrome/Edge). Set designqc.chrome_path in .wolf/config.json"
    );
    process.exit(1);
  }

  let server: StartedServer = { url: options.url ?? "", child: null };
  if (!options.url) {
    const running = await detectRunningServer();
    if (running) {
      console.log(`  ✓ Found running dev server: ${running}`);
      server = { url: running, child: null };
    } else {
      try {
        server = await startDevServer(projectRoot);
      } catch (err) {
        console.error(`  ✗ ${(err as Error).message}`);
        console.error("  Pass --url <url> to capture an already-running server.");
        process.exit(1);
      }
    }
  }

  const routes = options.routes?.length ? options.routes : detectRoutes(projectRoot);
  console.log(`  ✓ Browser: ${browserInfo.name} (${browserInfo.source})`);
  console.log(`  ✓ Routes (${routes.length}): ${routes.join(" ")}`);

  const quality = Math.min(100, Math.max(1, parseInt(options.quality ?? "70", 10) || 70));
  let viewports = options.desktopOnly ? [cfg.viewports[0]] : cfg.viewports;
  const maxWidth = parseInt(options.maxWidth ?? "", 10);
  if (maxWidth > 0) {
    viewports = viewports.map(v => ({ ...v, width: Math.min(v.width, maxWidth) }));
  }

  const capturesDir = path.join(wolfDir, "designqc-captures");
  fs.mkdirSync(capturesDir, { recursive: true });

  let browser: import("puppeteer-core").Browser | undefined;
  let allCaptures: Capture[] = [];
  try {
    browser = await puppeteer.launch({
      executablePath: browserInfo.path,
      headless: true,
      args: ["--no-sandbox", "--disable-gpu"],
    });

    for (const route of routes) {
      const url = new URL(route, server.url).toString();
      allCaptures = allCaptures.concat(
        await captureRoute(browser, url, viewports, cfg.max_screenshots, quality, capturesDir)
      );
    }

    const report = {
      generated_at: new Date().toISOString(),
      server: server.url,
      browser: browserInfo.name,
      routes,
      viewports: viewports.map(v => `${v.name} ${v.width}x${v.height}`),
      captures: allCaptures,
      tokens_estimated: allCaptures.length * 2500,
    };
    writeJSON(path.join(wolfDir, "designqc-report.json"), report);

    console.log(`  ✓ Captured ${allCaptures.length} screenshots`);
    for (const c of allCaptures) {
      console.log(`    - ${c.file} (${(c.bytes / 1024).toFixed(1)} KB)`);
    }
    console.log(`  ✓ Saved to .wolf/designqc-captures/ (~${report.tokens_estimated.toLocaleString()} tokens estimated)`);
  } finally {
    if (browser) await browser.close();
    if (server.child) {
      server.child.kill();
      console.log("  ✓ Stopped auto-started dev server");
    }
  }
}
