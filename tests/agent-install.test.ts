import { test, describe } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Issue #81 (davdittrich): the Codex adapter caught the parse failure for an
// existing .codex/hooks.json, kept its OpenWolf-only defaults, and wrote them
// over the user's malformed file. The original bytes (the only material for
// repairing it) were lost, and install still reported success.
//
// Exercised through the build output, like buglog-shape.test.ts, because the
// adapter's relative .js imports do not resolve under type stripping.
// Imported through the agents index, not codex.js directly: codex.js imports
// index.js for readSnippet(), so entering the cycle at codex.js hits the
// adapter registry before it is initialized.
const DIST_AGENTS = path.resolve(import.meta.dirname ?? ".", "..", "dist", "src", "agents", "index.js");
const haveDist = fs.existsSync(DIST_AGENTS);

async function loadCodexAdapter(): Promise<{ install: (ctx: unknown) => { actions: string[]; warnings: string[] } }> {
  const { resolveAgents } = await import(DIST_AGENTS);
  const [adapter] = resolveAgents(["codex"]);
  return adapter;
}

function project(): { projectRoot: string; wolfDir: string; templatesDir: string } {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ow-codex-"));
  const wolfDir = path.join(projectRoot, ".wolf");
  const templatesDir = path.join(projectRoot, "templates");
  fs.mkdirSync(wolfDir, { recursive: true });
  fs.mkdirSync(templatesDir, { recursive: true });
  return { projectRoot, wolfDir, templatesDir };
}

describe("codex adapter hooks.json", { skip: !haveDist ? "dist not built" : false }, () => {
  test("a malformed existing hooks.json is left byte-identical and warned about", async () => {
    const codexAdapter = await loadCodexAdapter();
    const ctx = project();
    const hooksPath = path.join(ctx.projectRoot, ".codex", "hooks.json");
    fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
    // Valid-looking user hooks with one trailing comma: recoverable by hand.
    const original = '{\n  "hooks": {\n    "SessionStart": [{ "matcher": "startup" }],\n  }\n}\n';
    fs.writeFileSync(hooksPath, original, "utf-8");
    const before = fs.readFileSync(hooksPath);

    const result = codexAdapter.install(ctx);

    assert.deepStrictEqual(
      fs.readFileSync(hooksPath),
      before,
      "malformed user file must be byte-identical after install",
    );
    assert.strictEqual(
      result.warnings.filter((w: string) => w.includes("hooks.json")).length,
      1,
      "exactly one actionable warning about the file",
    );
    assert.ok(
      !result.actions.some((a: string) => a.includes("hooks registered")),
      "install must not claim hooks were registered",
    );
  });

  test("an unreadable-shaped hooks.json (top-level array) is also preserved", async () => {
    const codexAdapter = await loadCodexAdapter();
    const ctx = project();
    const hooksPath = path.join(ctx.projectRoot, ".codex", "hooks.json");
    fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
    fs.writeFileSync(hooksPath, '["something else entirely"]\n', "utf-8");
    const before = fs.readFileSync(hooksPath);

    const result = codexAdapter.install(ctx);

    assert.deepStrictEqual(fs.readFileSync(hooksPath), before);
    assert.ok(result.warnings.some((w: string) => w.includes("hooks.json")));
  });

  test("a valid existing hooks.json keeps user hooks and unknown top-level keys", async () => {
    const codexAdapter = await loadCodexAdapter();
    const ctx = project();
    const hooksPath = path.join(ctx.projectRoot, ".codex", "hooks.json");
    fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
    fs.writeFileSync(
      hooksPath,
      JSON.stringify(
        {
          version: 3,
          hooks: { SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: "echo mine" }] }] },
        },
        null,
        2,
      ),
      "utf-8",
    );

    const result = codexAdapter.install(ctx);
    const written = JSON.parse(fs.readFileSync(hooksPath, "utf-8"));

    assert.strictEqual(written.version, 3, "unknown top-level keys survive");
    const sessionStart = JSON.stringify(written.hooks.SessionStart);
    assert.ok(sessionStart.includes("echo mine"), "user hook preserved");
    assert.ok(sessionStart.includes("session-start.js"), "OpenWolf hook added");
    assert.ok(result.actions.some((a: string) => a.includes("hooks registered")));
  });

  test("no existing file: OpenWolf hooks are written", async () => {
    const codexAdapter = await loadCodexAdapter();
    const ctx = project();
    const result = codexAdapter.install(ctx);
    const written = JSON.parse(fs.readFileSync(path.join(ctx.projectRoot, ".codex", "hooks.json"), "utf-8"));
    assert.ok(Array.isArray(written.hooks.SessionStart));
    assert.ok(result.actions.some((a: string) => a.includes("hooks registered")));
  });

  test("install is idempotent: a second run does not duplicate OpenWolf entries", async () => {
    const codexAdapter = await loadCodexAdapter();
    const ctx = project();
    codexAdapter.install(ctx);
    codexAdapter.install(ctx);
    const written = JSON.parse(fs.readFileSync(path.join(ctx.projectRoot, ".codex", "hooks.json"), "utf-8"));
    assert.strictEqual(written.hooks.SessionStart.length, 1);
    assert.strictEqual(written.hooks.PostToolUse.length, 2);
  });
});
