import * as fs from "node:fs";
import * as path from "node:path";
import { findProjectRoot } from "../scanner/project-root.js";
import { scanProject, buildAnatomy, buildMergedStore } from "../scanner/anatomy-scanner.js";
import { renderStore } from "../hooks/anatomy-store.js";

export async function scanCommand(options: { check?: boolean }): Promise<void> {
  const projectRoot = findProjectRoot();
  const wolfDir = path.join(projectRoot, ".wolf");

  if (!fs.existsSync(wolfDir)) {
    console.log("OpenWolf not initialized. Run: openwolf init");
    return;
  }

  if (options.check) {
    // Compare against what `openwolf scan` would actually write: the fresh
    // walk MERGED with curated descriptions/preamble via the reconciled store.
    // Comparing the raw fresh render made --check a permanent false positive
    // (extractor descriptions and zeroed counters never matched disk).
    const { store: fresh } = await buildAnatomy(wolfDir, projectRoot);
    const newContent = renderStore(buildMergedStore(wolfDir, projectRoot, fresh));

    const anatomyPath = path.join(wolfDir, "anatomy.md");
    let existingContent = "";
    try {
      existingContent = fs.readFileSync(anatomyPath, "utf-8");
    } catch {
      // File doesn't exist — anatomy is out of date
    }

    // Strip the volatile header lines before comparing: the scan timestamp
    // changes every run, and hit/miss counters change on every tracked read.
    const stripVolatile = (s: string): string =>
      s
        .replace(/^> Auto-maintained by OpenWolf\. Last scanned: .+$/m, "")
        .replace(/^> Files:\s*\d+ tracked \| Anatomy hits: \d+ \| Misses: \d+$/m, "");

    if (stripVolatile(existingContent) === stripVolatile(newContent)) {
      console.log("Anatomy is up to date");
      return;
    } else {
      console.log("Anatomy is out of date. Run `openwolf scan` to update.");
      process.exit(1);
    }
  }

  console.log("Scanning project...");
  const startTime = Date.now();
  const fileCount = await scanProject(wolfDir, projectRoot);
  const elapsed = Date.now() - startTime;
  console.log(`  ✓ Anatomy scan complete: ${fileCount} files indexed in ${elapsed}ms`);
}
