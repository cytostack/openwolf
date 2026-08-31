import * as fs from "node:fs";
import * as path from "node:path";
import { findProjectRoot } from "../scanner/project-root.js";
import { readJSON } from "../utils/fs-safe.js";
import { loadStore } from "../hippocampus/event-store.js";
import { loadIndex, indexNeedsRebuild } from "../hippocampus/cue-index.js";
import { statusMentionsActiveSpec } from "../specs/status-check.js";
import { HOOK_FILES } from "./copy-hooks.js";

/**
 * Health check for a project's .wolf/ state: cue-index drift, STATUS.md vs
 * specs-state drift, and hook script completeness. Exits 1 on any issue so it
 * can gate scripts.
 */
export function doctorCommand(): void {
  const projectRoot = findProjectRoot();
  const wolfDir = path.join(projectRoot, ".wolf");
  if (!fs.existsSync(wolfDir)) {
    console.log("OpenWolf not initialized. Run: openwolf init");
    return;
  }

  const issues: string[] = [];

  // 1. cue-index vs store drift
  const store = loadStore(path.join(wolfDir, "hippocampus.json"));
  const index = loadIndex(path.join(wolfDir, "cue-index.json"));
  if (store && index && store.buffer.length > 0 && indexNeedsRebuild(index, store.buffer)) {
    issues.push("cue-index is stale vs hippocampus store (run: openwolf scan)");
  }

  // 2. STATUS.md vs specs-state drift
  const specsState = readJSON<{ activeSpec?: string }>(path.join(wolfDir, "specs-state.json"), {});
  const activeSpec = specsState.activeSpec;
  if (activeSpec) {
    const statusMd = fs.existsSync(path.join(wolfDir, "STATUS.md"))
      ? fs.readFileSync(path.join(wolfDir, "STATUS.md"), "utf-8")
      : "";
    if (!statusMentionsActiveSpec(statusMd, activeSpec)) {
      issues.push(`STATUS.md does not mention active spec "${activeSpec}" (resume path may break)`);
    }
  }

  // 3. hook script completeness
  const hooksDir = path.join(wolfDir, "hooks");
  if (fs.existsSync(hooksDir)) {
    const missing = HOOK_FILES.filter((f) => !fs.existsSync(path.join(hooksDir, f)));
    if (missing.length) {
      issues.push(`missing hook scripts: ${missing.join(", ")} (run: openwolf update)`);
    }
  } else {
    issues.push("no .wolf/hooks/ directory (run: openwolf init)");
  }

  if (issues.length === 0) {
    console.log("✓ OpenWolf healthy: no drift, hooks complete.");
  } else {
    for (const issue of issues) {
      console.log(`✗ ${issue}`);
    }
    process.exitCode = 1;
  }
}
