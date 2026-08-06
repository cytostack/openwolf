import { test, describe } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/**
 * Imported from `dist/`, not from `src/`, and built on demand if it is not there.
 *
 * `npm test` runs the suite straight off the TypeScript with type-stripping, which does not
 * rewrite relative import specifiers — and `anatomy-scanner.ts` imports
 * `./description-extractor.js`, a path that only exists after a build. Every existing test
 * happens to target a module with no relative imports, so this constraint has not come up
 * before. Building here costs ~7s once and keeps `npm test` working on a clean checkout.
 *
 * Happy to restructure if you would rather the suite built first, or the scanner were
 * split so the decision is unit-testable off the source.
 */
const repoRoot = path.resolve(import.meta.dirname, "..");
const distScanner = path.join(repoRoot, "dist", "src", "scanner", "anatomy-scanner.js");
if (!fs.existsSync(distScanner)) {
  // tsc exits non-zero on the pre-existing src/daemon/cron-engine.ts TS2503, but still
  // emits, so the emitted file — not the exit code — is what decides success.
  try {
    execFileSync("npx", ["tsc", "-p", "tsconfig.json"], { cwd: repoRoot, stdio: "ignore", shell: true });
  } catch {}
  if (!fs.existsSync(distScanner)) throw new Error(`build produced no ${distScanner}`);
}
const { scanProject, buildAnatomy } = await import(pathToFileURL(distScanner).href);

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "wolf-shrink-"));

/**
 * A project whose index already knows about every file, laid out so a capped walk stops
 * inside the alphabetically-early directory and never reaches the late one.
 *
 * This is the real-world shape: a bulk evidence folder sorts before the curated content and
 * consumes the whole budget.
 */
function makeProject(opts: { cap: number; early: number; late: number }) {
  const root = tmpDir();
  const wolfDir = path.join(root, ".wolf");
  fs.mkdirSync(wolfDir, { recursive: true });
  fs.mkdirSync(path.join(root, "01-bulk"), { recursive: true });
  fs.mkdirSync(path.join(root, "zz-curated"), { recursive: true });

  const files: Record<string, unknown> = {};
  const add = (rel: string) => {
    fs.writeFileSync(path.join(root, rel), `# ${rel}\n\nbody\n`, "utf-8");
    files[rel] = {
      description: `curated ${rel}`,
      tokens: 5,
      hash: "stale-on-purpose",
      size: 10,
      mtimeMs: 1,
      updatedAt: "2026-01-01T00:00:00.000Z",
      source: "md-import",
    };
  };
  for (let i = 0; i < opts.early; i++) add(`01-bulk/a${String(i).padStart(4, "0")}.md`);
  for (let i = 0; i < opts.late; i++) add(`zz-curated/c${String(i).padStart(4, "0")}.md`);

  fs.writeFileSync(
    path.join(wolfDir, "config.json"),
    JSON.stringify({
      version: 1,
      openwolf: {
        anatomy: {
          max_description_length: 100,
          max_files: opts.cap,
          exclude_patterns: [".git", ".wolf"],
        },
        token_audit: { chars_per_token_code: 3.5, chars_per_token_prose: 4.0 },
      },
    }),
    "utf-8"
  );
  fs.writeFileSync(
    path.join(wolfDir, "anatomy-index.json"),
    JSON.stringify({
      version: 1,
      meta: { lastScanned: "2026-01-01T00:00:00.000Z", fileCount: Object.keys(files).length },
      files,
    }),
    "utf-8"
  );
  fs.writeFileSync(path.join(wolfDir, "anatomy.md"), "# anatomy\n", "utf-8");
  return { root, wolfDir, indexed: Object.keys(files).length };
}

const readIndex = (wolfDir: string) =>
  JSON.parse(fs.readFileSync(path.join(wolfDir, "anatomy-index.json"), "utf-8")) as {
    files: Record<string, unknown>;
  };
const keysUnder = (wolfDir: string, prefix: string) =>
  Object.keys(readIndex(wolfDir).files).filter((k) => k.startsWith(prefix));

describe("scanProject: a capped walk must not delete", () => {
  test("entries the walk never reached are kept, not pruned", () => {
    // 60 early + 40 late = 100 indexed; a cap of 50 dies inside 01-bulk.
    const p = makeProject({ cap: 50, early: 60, late: 40 });
    scanProject(p.wolfDir, p.root);

    const after = readIndex(p.wolfDir).files;
    assert.equal(
      Object.keys(after).length,
      p.indexed,
      "a truncated scan deleted entries it never looked at"
    );
    assert.equal(keysUnder(p.wolfDir, "zz-curated/").length, 40);
    fs.rmSync(p.root, { recursive: true, force: true });
  });

  test("buildAnatomy reports the truncation", () => {
    const p = makeProject({ cap: 50, early: 60, late: 40 });
    assert.equal(buildAnatomy(p.wolfDir, p.root).truncated, true);
    fs.rmSync(p.root, { recursive: true, force: true });
  });

  test("a walk that ends exactly at the cap counts as truncated", () => {
    // Indistinguishable from one that would have continued, so it must be read as unsafe.
    const p = makeProject({ cap: 10, early: 5, late: 5 });
    assert.equal(buildAnatomy(p.wolfDir, p.root).truncated, true);
    fs.rmSync(p.root, { recursive: true, force: true });
  });

  test("a complete walk still prunes a file that is genuinely gone", () => {
    // The guard must not cost the feature: pruning is why the full-replace exists.
    const p = makeProject({ cap: 5000, early: 3, late: 3 });
    fs.rmSync(path.join(p.root, "zz-curated", "c0000.md"));
    scanProject(p.wolfDir, p.root);

    assert.equal(buildAnatomy(p.wolfDir, p.root).truncated, false);
    assert.equal(keysUnder(p.wolfDir, "zz-curated/").length, 2, "deleted file was not pruned");
    assert.equal(Object.keys(readIndex(p.wolfDir).files).length, p.indexed - 1);
    fs.rmSync(p.root, { recursive: true, force: true });
  });

  test("a complete walk under the cap keeps everything", () => {
    const p = makeProject({ cap: 5000, early: 3, late: 3 });
    scanProject(p.wolfDir, p.root);
    assert.equal(Object.keys(readIndex(p.wolfDir).files).length, p.indexed);
    fs.rmSync(p.root, { recursive: true, force: true });
  });

  test("curated descriptions survive a truncated scan", () => {
    // The entries the walk DID reach are refreshed; md-import descriptions are preserved,
    // which is the behaviour the full-replace path already had and must not regress.
    const p = makeProject({ cap: 50, early: 60, late: 40 });
    scanProject(p.wolfDir, p.root);
    const files = readIndex(p.wolfDir).files as Record<string, { description?: string }>;
    assert.equal(files["01-bulk/a0000.md"]?.description, "curated 01-bulk/a0000.md");
    assert.equal(files["zz-curated/c0000.md"]?.description, "curated zz-curated/c0000.md");
    fs.rmSync(p.root, { recursive: true, force: true });
  });
});
