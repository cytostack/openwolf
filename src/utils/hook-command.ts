import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Locate the bundled hook-runner.vbs (shipped under dist/assets/).
 *
 * At runtime, this module lives at dist/src/utils/hook-command.js;
 * the VBS is copied to dist/assets/hook-runner.vbs by the build.
 * In source/dev mode it's at <repo>/assets/hook-runner.vbs.
 *
 * Returns null if no candidate exists — caller falls back to the
 * bare `node "<script>"` form.
 */
export function findHookRunnerVbs(): string | null {
  const candidates = [
    // dist layout: dist/src/utils/hook-command.js → dist/assets/hook-runner.vbs
    path.resolve(__dirname, "..", "..", "assets", "hook-runner.vbs"),
    // dev layout: src/utils/hook-command.ts → assets/hook-runner.vbs
    path.resolve(__dirname, "..", "..", "..", "assets", "hook-runner.vbs"),
    // single-flat layout fallback
    path.resolve(__dirname, "assets", "hook-runner.vbs"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/**
 * Build the Claude Code hook `command` string for a `.wolf/hooks/*.js`
 * entry.
 *
 * On Windows, when the VBS wrapper is available, the command is:
 *   wscript //nologo "<vbs>" node "$CLAUDE_PROJECT_DIR/.wolf/hooks/<x>.js"
 *
 * The `wscript.exe` host is a windows-subsystem binary so Claude Code's
 * spawn never allocates a console — eliminating the brief black flash
 * that appears with the bare `node "..."` form on Windows.
 *
 * On POSIX, or when the VBS asset isn't found, falls back to the
 * historical bare form unchanged.
 *
 * @param scriptName - basename inside .wolf/hooks/ (e.g. "post-write.js")
 * @param platform   - injectable for tests; defaults to process.platform
 * @param vbsPath    - injectable for tests; defaults to findHookRunnerVbs()
 */
export function buildHookCommand(
  scriptName: string,
  platform: NodeJS.Platform = process.platform,
  vbsPath: string | null = findHookRunnerVbs()
): string {
  const scriptRef = `$CLAUDE_PROJECT_DIR/.wolf/hooks/${scriptName}`;
  if (platform !== "win32" || !vbsPath) {
    return `node "${scriptRef}"`;
  }
  // Use forward slashes for the VBS path — cmd / WScript handle them
  // on Windows and forward slashes round-trip cleanly through JSON.
  const fwdVbs = vbsPath.replace(/\\/g, "/");
  return `wscript //nologo "${fwdVbs}" node "${scriptRef}"`;
}
