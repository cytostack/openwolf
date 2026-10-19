import { pathToFileURL } from "node:url";
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
  const { resolveAgents } = await import(pathToFileURL(DIST_AGENTS).href);
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
    assert.strictEqual(written.hooks.PostToolUse.length, 3);
    assert.strictEqual(written.hooks.PostToolUse.filter((h: any) => h.matcher === "Bash").length, 1);
  });
});

async function loadAntigravityAdapter(): Promise<{ install: (ctx: unknown) => { actions: string[]; warnings: string[] } }> {
  const { resolveAgents } = await import(pathToFileURL(DIST_AGENTS).href);
  const [adapter] = resolveAgents(["antigravity"]);
  return adapter;
}

describe("antigravity adapter hooks.json", { skip: !haveDist ? "dist not built" : false }, () => {
  test("a malformed existing hooks.json is left byte-identical and warned about", async () => {
    const antigravityAdapter = await loadAntigravityAdapter();
    const ctx = project();
    const hooksPath = path.join(ctx.projectRoot, ".agents", "hooks.json");
    fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
    const original = '{\n  "custom": {\n    "PreInvocation": [],\n  }\n}\n';
    fs.writeFileSync(hooksPath, original, "utf-8");
    const before = fs.readFileSync(hooksPath);

    const result = antigravityAdapter.install(ctx);

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
    const antigravityAdapter = await loadAntigravityAdapter();
    const ctx = project();
    const hooksPath = path.join(ctx.projectRoot, ".agents", "hooks.json");
    fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
    fs.writeFileSync(hooksPath, '["something else entirely"]\n', "utf-8");
    const before = fs.readFileSync(hooksPath);

    const result = antigravityAdapter.install(ctx);

    assert.deepStrictEqual(fs.readFileSync(hooksPath), before);
    assert.ok(result.warnings.some((w: string) => w.includes("hooks.json")));
  });

  test("a valid existing hooks.json keeps user hooks and adds openwolf group", async () => {
    const antigravityAdapter = await loadAntigravityAdapter();
    const ctx = project();
    const hooksPath = path.join(ctx.projectRoot, ".agents", "hooks.json");
    fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
    fs.writeFileSync(
      hooksPath,
      JSON.stringify(
        {
          "user-custom-group": {
            PreInvocation: [{ type: "command", command: "echo mine" }],
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    const result = antigravityAdapter.install(ctx);
    const written = JSON.parse(fs.readFileSync(hooksPath, "utf-8"));

    assert.ok(written["user-custom-group"], "user hook group preserved");
    assert.ok(written.openwolf, "openwolf group added");
    assert.ok(Array.isArray(written.openwolf.PreInvocation));
    assert.ok(result.actions.some((a: string) => a.includes("hooks registered")));
  });

  test("no existing file: OpenWolf hooks are written under openwolf group", async () => {
    const antigravityAdapter = await loadAntigravityAdapter();
    const ctx = project();
    const result = antigravityAdapter.install(ctx);
    const written = JSON.parse(fs.readFileSync(path.join(ctx.projectRoot, ".agents", "hooks.json"), "utf-8"));
    assert.ok(written.openwolf);
    assert.ok(Array.isArray(written.openwolf.PreInvocation));
    assert.ok(Array.isArray(written.openwolf.PreToolUse));
    assert.ok(Array.isArray(written.openwolf.PostToolUse));
    assert.ok(Array.isArray(written.openwolf.Stop));
    assert.ok(result.actions.some((a: string) => a.includes("hooks registered")));
  });

  test("install is idempotent: a second run does not corrupt or duplicate", async () => {
    const antigravityAdapter = await loadAntigravityAdapter();
    const ctx = project();
    antigravityAdapter.install(ctx);
    antigravityAdapter.install(ctx);
    const written = JSON.parse(fs.readFileSync(path.join(ctx.projectRoot, ".agents", "hooks.json"), "utf-8"));
    assert.strictEqual(written.openwolf.PreInvocation.length, 1);
    assert.strictEqual(written.openwolf.PreToolUse.length, 3);
    assert.strictEqual(written.openwolf.PostToolUse.length, 3);
    assert.strictEqual(written.openwolf.Stop.length, 1);
  });
});

// Antigravity's own docs (bundled with the CLI: builtin/skills/agy-customizations
// /docs/rules.md) document GEMINI.md and AGENTS.md as equally valid, interchangeable
// "Directory-Based Rules" files with no precedence between them. The adapter reuses
// whichever the project already has and defaults to AGENTS.md, matching every other
// agent adapter's context-file convention (Codex, OpenCode) for portability.
describe("antigravity adapter context file", { skip: !haveDist ? "dist not built" : false }, () => {
  test("no existing GEMINI.md or AGENTS.md: defaults to AGENTS.md", async () => {
    const antigravityAdapter = await loadAntigravityAdapter();
    const ctx = project();
    const result = antigravityAdapter.install(ctx);
    assert.ok(fs.existsSync(path.join(ctx.projectRoot, "AGENTS.md")));
    assert.ok(!fs.existsSync(path.join(ctx.projectRoot, "GEMINI.md")));
    assert.ok(result.actions.some((a: string) => a.includes("AGENTS.md updated")));
  });

  test("a pre-existing GEMINI.md is reused instead of creating AGENTS.md", async () => {
    const antigravityAdapter = await loadAntigravityAdapter();
    const ctx = project();
    fs.writeFileSync(path.join(ctx.projectRoot, "GEMINI.md"), "# Project rules\n\nSome existing content.\n", "utf-8");

    const result = antigravityAdapter.install(ctx);

    assert.ok(!fs.existsSync(path.join(ctx.projectRoot, "AGENTS.md")), "must not create a second context file");
    const gemini = fs.readFileSync(path.join(ctx.projectRoot, "GEMINI.md"), "utf-8");
    assert.ok(gemini.includes("Some existing content."), "user content preserved");
    assert.ok(gemini.includes("<!-- openwolf:begin -->"), "OpenWolf block added");
    assert.ok(result.actions.some((a: string) => a.includes("GEMINI.md updated")));
  });
});

// src/hooks/session-start.ts resolves a per-agent context budget via
// ctx.budgets?.[agent], falling back to a generic default when an agent has
// no entry. That fallback is silent, so a registered adapter can go without
// its own tuned budget indefinitely without any install or test failing.
// This guards every adapter in the registry, not just antigravity: it would
// have caught the antigravity budget being left out when the adapter shipped.
describe("context.budgets covers every registered agent adapter", { skip: !haveDist ? "dist not built" : false }, () => {
  test("src/templates/config.json has a budget entry for each agent adapter", async () => {
    const ROOT = path.resolve(import.meta.dirname ?? ".", "..");
    const { availableAgents } = await import(pathToFileURL(DIST_AGENTS).href);
    const template = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "templates", "config.json"), "utf-8"));
    const budgets = template.openwolf.context.budgets;

    for (const agent of availableAgents() as string[]) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(budgets, agent),
        `context.budgets in src/templates/config.json is missing an entry for "${agent}"`,
      );
      assert.strictEqual(typeof budgets[agent], "number");
    }
  });
});
