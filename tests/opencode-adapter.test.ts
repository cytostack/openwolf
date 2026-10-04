import { test, describe, before } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname ?? ".", "..");
const DIST_INDEX = path.join(ROOT, "dist", "src", "agents", "index.js");
const DIST_OPENCODE = path.join(ROOT, "dist", "src", "agents", "opencode.js");
const haveDist = fs.existsSync(DIST_INDEX) && fs.existsSync(DIST_OPENCODE);

let parseOpenCodeVersion: (output: string) => string | undefined;
let detectOpenCodePluginApi: (version?: string) => "v1" | "v2" | "unknown";
let installOpenCodePlugin: (
  ctx: { projectRoot: string; wolfDir: string; templatesDir: string },
  api?: "v1" | "v2" | "unknown",
) => { actions: string[]; warnings: string[] };

before(async () => {
  if (!haveDist) return;
  // Enter through agents/index.js: opencode.ts imports readSnippet from that
  // registry, so importing the adapter module as the graph entry creates a
  // circular initialization error.
  await import(pathToFileURL(DIST_INDEX).href);
  ({ parseOpenCodeVersion, detectOpenCodePluginApi, installOpenCodePlugin } =
    await import(pathToFileURL(DIST_OPENCODE).href));
});

function project(): { projectRoot: string; wolfDir: string; templatesDir: string } {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ow-opencode-"));
  const wolfDir = path.join(projectRoot, ".wolf");
  fs.mkdirSync(wolfDir, { recursive: true });
  return { projectRoot, wolfDir, templatesDir: path.join(ROOT, "src", "templates") };
}

describe("OpenCode version detection", { skip: !haveDist ? "dist not built" : false }, () => {
  test("parses V1 and V2 CLI output", () => {
    assert.strictEqual(parseOpenCodeVersion("opencode v1.18.30\n"), "1.18.30");
    assert.strictEqual(parseOpenCodeVersion("2.0.22"), "2.0.22");
    assert.strictEqual(parseOpenCodeVersion("not a version"), undefined);
  });

  test("selects the matching plugin contract", () => {
    assert.strictEqual(detectOpenCodePluginApi("1.18.30"), "v1");
    assert.strictEqual(detectOpenCodePluginApi("2.0.22"), "v2");
    assert.strictEqual(detectOpenCodePluginApi(""), "unknown");
  });
});

describe("OpenCode adapter installation", { skip: !haveDist ? "dist not built" : false }, () => {
  test("writes the V2 default plugin and removes a stale V1 plugin", () => {
    const ctx = project();
    const first = installOpenCodePlugin(ctx, "v1");
    assert.ok(first.actions.some(action => action.includes(".opencode/plugin/openwolf.ts")));

    const second = installOpenCodePlugin(ctx, "v2");
    const v2Entry = path.join(ctx.projectRoot, ".opencode", "plugins", "openwolf", "index.ts");
    assert.ok(second.actions.some(action => action.includes(".opencode/plugins/openwolf/index.ts")));
    assert.ok(fs.readFileSync(v2Entry, "utf-8").includes('id: "openwolf"'));
    assert.ok(fs.readFileSync(v2Entry, "utf-8").includes("setupOpenWolfV2"));
    assert.strictEqual(fs.existsSync(path.join(ctx.projectRoot, ".opencode", "plugin", "openwolf.ts")), false);
    assert.strictEqual(fs.existsSync(path.join(ctx.projectRoot, ".opencode", "plugin", "openwolf")), false);
  });

  test("falls back to V1 with an actionable warning when detection is unavailable", () => {
    const ctx = project();
    const result = installOpenCodePlugin(ctx, "unknown");
    assert.ok(fs.existsSync(path.join(ctx.projectRoot, ".opencode", "plugin", "openwolf.ts")));
    assert.ok(result.warnings.some(warning => warning.includes("version could not be detected")));
  });
});
