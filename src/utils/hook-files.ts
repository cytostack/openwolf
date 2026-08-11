import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Lifecycle hooks wired into the agent's settings. These are the files the
 * harness invokes directly; every one of them must exist in .wolf/hooks/.
 */
export const HOOK_ENTRYPOINTS = [
  "session-start.js",
  "pre-read.js",
  "pre-write.js",
  "post-read.js",
  "post-write.js",
  "precompact.js",
  "stop.js",
] as const;

/**
 * Locate the compiled hooks shipped with the installed package.
 *
 * `fromDir` is the calling module's directory (dist/src/cli at runtime), so the
 * candidates cover both the main tsc build and the tsconfig.hooks.json build.
 */
export function resolveHookSourceDir(fromDir: string): string {
  const candidates = [
    path.join(fromDir, "..", "hooks"),
    path.resolve(fromDir, "..", "..", "hooks"),
    path.resolve(fromDir, "..", "..", "dist", "hooks"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, "shared.js"))) {
      return candidate;
    }
  }
  return "";
}

/**
 * Every compiled hook module that belongs in .wolf/hooks/, read from the source
 * directory rather than a hardcoded list.
 *
 * The entrypoints import helper modules (shared, anatomy-store, anatomy-lock,
 * symbol-extractor, ...). A hardcoded list silently drops any module added after
 * it was written, and the failure is invisible: the harness swallows the hook's
 * stderr, so the only symptom is that anatomy quietly stops updating while
 * `openwolf status` still reports the entrypoints as present.
 */
export function listHookModules(sourceDir: string): string[] {
  if (!sourceDir || !fs.existsSync(sourceDir)) return [];
  return fs
    .readdirSync(sourceDir)
    .filter((file) => file.endsWith(".js"))
    .sort();
}
