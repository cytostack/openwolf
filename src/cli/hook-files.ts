import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Which hook files an install consists of.
 *
 * This used to be a literal list, written out three times — in `init`, in `update`, and in
 * `status` — and the three had drifted apart. `dist/hooks/` ships eleven files; `init` and
 * `update` each copied ten, and `status` checked seven. The missing one was
 * `symbol-extractor.js`, which `post-write.js` imports.
 *
 * The consequence was total and silent: ESM resolves imports at load time, so `post-write.js`
 * threw `ERR_MODULE_NOT_FOUND` on *every* invocation from the moment of the upgrade. Nothing
 * was recorded in `anatomy.md`, `memory.md` or `_session.json` for the entire window, in every
 * upgraded project, and it fails to stderr so there is no visible symptom. `openwolf status`
 * reported "✓ All 7 hook scripts present" throughout, because its list was the shortest of
 * the three.
 *
 * Reading the shipped directory removes the possibility of drift rather than correcting one
 * instance of it: whatever the build emits is what gets installed and what gets checked. The
 * literal below is only a fallback for when the shipped directory cannot be read.
 */
export const HOOK_FILES = [
  "anatomy-lock.js",
  "anatomy-store.js",
  "post-read.js",
  "post-write.js",
  "pre-read.js",
  "pre-write.js",
  "precompact.js",
  "session-start.js",
  "shared.js",
  "stop.js",
  "symbol-extractor.js",
] as const;

/** The hook files actually shipped in `sourceDir`, or the fallback list if it cannot be read. */
export function shippedHookFiles(sourceDir?: string): string[] {
  if (sourceDir) {
    try {
      const found = fs
        .readdirSync(sourceDir)
        .filter((f) => f.endsWith(".js") && !f.endsWith(".map"))
        .sort();
      if (found.length > 0) return found;
    } catch {
      // fall through to the literal
    }
  }
  return [...HOOK_FILES];
}

/**
 * Every relative import in `hooksDir`'s hooks resolves to a file that is present.
 *
 * Returns a list of human-readable problems; empty means healthy.
 *
 * Deliberately a STATIC check rather than importing each hook. Importing them would be the
 * obvious way to prove they load, but every hook calls `main()` at module scope — so an
 * import would execute it, read stdin, and write to the project. `node --check` is no help
 * either: it parses without resolving imports, which is precisely why a missing dependency
 * passed a syntax check cleanly and stayed invisible.
 */
export function verifyHookImports(hooksDir: string): string[] {
  const problems: string[] = [];
  let files: string[];
  try {
    files = fs.readdirSync(hooksDir).filter((f) => f.endsWith(".js"));
  } catch {
    return [`hooks directory is unreadable: ${hooksDir}`];
  }
  for (const file of files) {
    let src: string;
    try {
      src = fs.readFileSync(path.join(hooksDir, file), "utf-8");
    } catch {
      problems.push(`${file}: unreadable`);
      continue;
    }
    // `import ... from "./x.js"` and `export ... from "./x.js"`, single or double quoted.
    for (const m of src.matchAll(/(?:import|export)[^;]*?from\s*["'](\.[^"']+)["']/g)) {
      const target = path.resolve(hooksDir, m[1]);
      if (!fs.existsSync(target)) {
        problems.push(`${file} imports ${m[1]}, which is not installed`);
      }
    }
  }
  return problems;
}
