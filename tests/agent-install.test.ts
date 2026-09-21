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
const DIST_SKILLS = path.resolve(import.meta.dirname ?? ".", "..", "dist", "src", "agents", "skills.js");
const haveDist = fs.existsSync(DIST_AGENTS) && fs.existsSync(DIST_SKILLS);

async function loadCodexAdapter(): Promise<{ install: (ctx: unknown) => { actions: string[]; warnings: string[] } }> {
  const { resolveAgents } = await import(pathToFileURL(DIST_AGENTS).href);
  const [adapter] = resolveAgents(["codex"]);
  return adapter;
}

async function loadAgentModules(): Promise<{
  resolveAgents: (names: string[]) => Array<{ name: string; install: (ctx: unknown) => { actions: string[]; warnings: string[] } }>;
  detectInstalledAgents: (options?: { home?: string; hasCommand?: (bin: string) => boolean }) => string[];
  installSkills: (projectRoot: string, templatesDir: string, agents: string[]) => string[];
}> {
  const agents = await import(pathToFileURL(DIST_AGENTS).href);
  const skills = await import(pathToFileURL(DIST_SKILLS).href);
  return { ...agents, installSkills: skills.installSkills };
}

function project(): { projectRoot: string; wolfDir: string; templatesDir: string } {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ow-codex-"));
  const wolfDir = path.join(projectRoot, ".wolf");
  const templatesDir = path.join(projectRoot, "templates");
  fs.mkdirSync(wolfDir, { recursive: true });
  fs.mkdirSync(templatesDir, { recursive: true });
  return { projectRoot, wolfDir, templatesDir };
}

function writeSkillTemplates(templatesDir: string): void {
  const skillsDir = path.join(templatesDir, "skills");
  fs.mkdirSync(skillsDir, { recursive: true });
  for (const skill of ["security-audit", "reframe", "designqc", "handoff"]) {
    fs.writeFileSync(
      path.join(skillsDir, `${skill}.md`),
      `---\nname: ${skill}\ndescription: ${skill}\n---\n\n${skill} body\n`,
      "utf-8",
    );
  }
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

describe("Pi and OMP adapters", { skip: !haveDist ? "dist not built" : false }, () => {
  test("install shared context idempotently and preserve user content", async () => {
    const { resolveAgents } = await loadAgentModules();

    for (const name of ["pi", "omp"]) {
      const ctx = project();
      fs.writeFileSync(path.join(ctx.projectRoot, "AGENTS.md"), "# Project rules\n\nKeep this text.\n", "utf-8");
      const [adapter] = resolveAgents([name]);
      const first = adapter.install(ctx);
      const second = adapter.install(ctx);
      const content = fs.readFileSync(path.join(ctx.projectRoot, "AGENTS.md"), "utf-8");
      assert.ok(first.actions.some((action) => action.includes("AGENTS.md updated")));
      assert.deepStrictEqual(second.actions, []);
      assert.ok(content.includes("Keep this text."));
      assert.strictEqual((content.match(/<!-- openwolf:begin -->/g) ?? []).length, 1);
    }
  });

  test("detects Pi and OMP from user directories or PATH without machine state", async () => {
    const { detectInstalledAgents } = await loadAgentModules();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ow-agents-"));
    fs.mkdirSync(path.join(home, ".pi", "agent"), { recursive: true });
    assert.deepStrictEqual(
      detectInstalledAgents({ home, hasCommand: (bin) => bin === "omp" }),
      ["pi", "omp"],
    );
  });

  test("installs shared skills once and preserves customized files", async () => {
    const { installSkills } = await loadAgentModules();
    const ctx = project();
    writeSkillTemplates(ctx.templatesDir);
    const first = installSkills(ctx.projectRoot, ctx.templatesDir, ["pi", "omp"]);
    const skillPath = path.join(ctx.projectRoot, ".agents", "skills", "handoff", "SKILL.md");
    assert.ok(fs.existsSync(skillPath));
    assert.ok(first.some((line) => line.includes("pi/omp")));

    const custom = "custom skill\n";
    fs.writeFileSync(skillPath, custom, "utf-8");
    const second = installSkills(ctx.projectRoot, ctx.templatesDir, ["pi", "omp"]);
    assert.ok(second.some((line) => line.includes("customized")));
    assert.strictEqual(fs.readFileSync(skillPath, "utf-8"), custom);
  });

  test("installs native OMP hooks and preserves a customized hook", async () => {
    const { resolveAgents } = await loadAgentModules();
    const ctx = project();
    const sourceDir = path.join(ctx.templatesDir, "omp-hooks");
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, "openwolf.ts"), "// openwolf:managed-omp-hook\nexport default function openwolf() {}\n", "utf-8");

    const [adapter] = resolveAgents(["omp"]);
    const first = adapter.install(ctx);
    const hookPath = path.join(ctx.projectRoot, ".omp", "hooks", "pre", "openwolf.ts");
    assert.ok(fs.existsSync(hookPath));
    assert.ok(first.actions.some((line) => line.includes("OMP hooks registered")));

    fs.writeFileSync(hookPath, `${fs.readFileSync(hookPath, "utf-8")}// user customization\n`, "utf-8");
    const second = adapter.install(ctx);
    assert.ok(second.warnings.some((line) => line.includes("customized")));
    assert.match(fs.readFileSync(hookPath, "utf-8"), /openwolf:managed-omp-hook/);
    assert.match(fs.readFileSync(hookPath, "utf-8"), /user customization/);
  });
});
