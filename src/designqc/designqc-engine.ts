import * as path from "node:path";
import * as fs from "node:fs";
import { type ChildProcess } from "node:child_process";
import { appendText, writeJSON } from "../utils/fs-safe.js";
import {
  findChromePath,
  captureRouteSectioned,
  detectRoutes,
  detectDevServer,
  detectDeployedUrl,
  startDevServer,
} from "./designqc-capture.js";
import type { DesignQCOptions, Screenshot, CaptureResult } from "./designqc-types.js";
import { DEFAULT_VIEWPORTS } from "./designqc-types.js";

export class DesignQCEngine {
  private wolfDir: string;
  private projectRoot: string;
  private options: DesignQCOptions;

  constructor(wolfDir: string, projectRoot: string, options: DesignQCOptions) {
    this.wolfDir = wolfDir;
    this.projectRoot = projectRoot;
    this.options = options;
  }

  async capture(): Promise<CaptureResult> {
    let baseUrl = this.options.devServerUrl;
    let serverProc: ChildProcess | null = null;
    let weStartedServer = false;

    try {
      // 1. Find or start server — try deployed URL, then local dev server
      if (!baseUrl) {
        const deployedUrl = detectDeployedUrl(this.projectRoot);
        if (deployedUrl) {
          baseUrl = deployedUrl;
          console.log(`  Detected deployed URL: ${baseUrl}`);
        } else {
          console.log("  Checking for running dev server...");
          const existing = await detectDevServer();
          if (existing) {
            baseUrl = existing.url;
            console.log(`  Found running server at ${baseUrl}`);
          } else {
            console.log("  No running server found. Starting dev server...");
            const started = await startDevServer(this.projectRoot);
            if (!started) {
              console.error("  Could not start dev server. Add a 'homepage' to package.json or use --url to specify the URL.");
              return { screenshots: [], captureDir: "", totalSizeKB: 0, estimatedTokens: 0 };
            }
            baseUrl = started.url;
            serverProc = started.proc;
            weStartedServer = true;
            console.log(`  Dev server ready at ${baseUrl}`);
          }
        }
      }

      // 2. Detect routes
      let routes = this.options.routes || [];
      if (routes.length === 0) {
        routes = detectRoutes(this.projectRoot);
      }
      console.log(`  Routes: ${routes.join(", ")}`);

      // 3. Prepare output directory
      const captureDir = path.join(this.wolfDir, "designqc-captures");
      if (fs.existsSync(captureDir)) {
        for (const f of fs.readdirSync(captureDir)) {
          fs.unlinkSync(path.join(captureDir, f));
        }
      } else {
        fs.mkdirSync(captureDir, { recursive: true });
      }

      // 4. Launch browser
      console.log("  Launching browser...");
      const chromePath = findChromePath(this.options.chromePath);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let puppeteer: any;
      try {
        puppeteer = await import("puppeteer-core");
      } catch {
        console.error("puppeteer-core is required for designqc. Install it with: pnpm add puppeteer-core");
        return { screenshots: [], captureDir: "", totalSizeKB: 0, estimatedTokens: 0 };
      }
      const browser = await puppeteer.default.launch({
        executablePath: chromePath,
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });

      const viewports = this.options.viewports || DEFAULT_VIEWPORTS;
      const allScreenshots: Screenshot[] = [];

      try {
        const page = await browser.newPage();

        for (const route of routes) {
          for (const viewport of viewports) {
            if (allScreenshots.length >= this.options.maxScreenshots) break;
            const url = `${baseUrl}${route}`;
            console.log(`  Capturing ${route} (${viewport.name}) — full page sections...`);
            try {
              const sections = await captureRouteSectioned(
                page, url, viewport, captureDir,
                this.options.quality, this.options.maxWidth,
              );
              // Respect max screenshots limit
              const remaining = this.options.maxScreenshots - allScreenshots.length;
              allScreenshots.push(...sections.slice(0, remaining));
            } catch (err) {
              console.error(`  Failed to capture ${url}: ${(err as Error).message}`);
            }
          }
          if (allScreenshots.length >= this.options.maxScreenshots) break;
        }

        await page.close();
      } finally {
        await browser.close();
      }

      // 5. Calculate sizes and token estimates
      let totalSizeBytes = 0;
      for (const s of allScreenshots) {
        try { totalSizeBytes += fs.statSync(s.path).size; } catch {}
      }
      const totalSizeKB = Math.round(totalSizeBytes / 1024);
      const estimatedTokens = allScreenshots.length * 2500;

      // 6. Print results
      console.log("");
      console.log(`  Captured ${allScreenshots.length} screenshot(s) across ${routes.length} route(s)`);
      console.log(`  Total size: ${totalSizeKB}KB`);
      console.log(`  Estimated token cost: ~${estimatedTokens} tokens`);
      console.log(`  Saved to: ${captureDir}`);
      console.log("");
      console.log("  Screenshots:");
      for (const s of allScreenshots) {
        const sizeKB = Math.round(fs.statSync(s.path).size / 1024);
        console.log(`    ${path.basename(s.path)} (${sizeKB}KB)`);
      }
      console.log("");
      console.log("  Ask Claude: \"Read the screenshots in .wolf/designqc-captures/ and evaluate the design\"");

      // 7. Write report for dashboard
      writeJSON(path.join(this.wolfDir, "designqc-report.json"), {
        captured_at: new Date().toISOString(),
        captures: allScreenshots.map((s) => ({
          file: path.basename(s.path),
          viewport: s.viewport.name,
          route: s.route,
        })),
        total_size_kb: totalSizeKB,
        estimated_tokens: estimatedTokens,
      });

      // 8. Log to memory
      const now = new Date();
      const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      appendText(
        path.join(this.wolfDir, "memory.md"),
        `| ${timeStr} | designqc: captured ${allScreenshots.length} screenshots (${totalSizeKB}KB, ~${estimatedTokens} tok) | ${routes.join(", ")} | ready for eval | ~0 |\n`,
      );

      return { screenshots: allScreenshots, captureDir, totalSizeKB, estimatedTokens };
    } finally {
      // 8. Kill dev server if we started it
      if (weStartedServer && serverProc) {
        console.log("  Stopping dev server...");
        serverProc.kill();
      }
    }
  }
}
