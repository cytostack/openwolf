import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Single source of truth for the hook scripts that `openwolf init` and
 * `openwolf update` copy into `.wolf/hooks/`. Kept here so the two copies
 * (init.ts / update.ts) cannot drift again — update.ts once missed
 * user-prompt.js + post-test.js.
 */
export const HOOK_FILES = [
  "session-start.js",
  "user-prompt.js",
  "pre-read.js",
  "pre-write.js",
  "post-read.js",
  "post-write.js",
  "post-test.js",
  "precompact.js",
  "stop.js",
  "shared.js",
  "anatomy-store.js",
  "anatomy-lock.js",
  "symbol-extractor.js",
];

/** Find the compiled hooks dir (dist/src/hooks or dist/hooks). */
export function findHooksSourceDir(__dirname: string): string {
  const candidates = [
    path.join(__dirname, "..", "hooks"),
    path.resolve(__dirname, "..", "..", "hooks"),
    path.resolve(__dirname, "..", "..", "dist", "hooks"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, "shared.js"))) {
      return candidate;
    }
  }
  return "";
}
