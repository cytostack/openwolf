import { describe, test } from "node:test";
import * as assert from "node:assert";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const DIST_BIN = path.resolve(import.meta.dirname ?? ".", "..", "dist", "bin", "openwolf.js");
const haveDist = fs.existsSync(DIST_BIN);

function fixture(name: string): { base: string; home: string; project: string } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "ow-init-agents-"));
  const home = path.join(base, "home");
  const project = path.join(base, "project");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({ name }, null, 2));
  return { base, home, project };
}

function runCli(project: string, home: string, args: string[]): string {
  return execFileSync(process.execPath, [DIST_BIN, ...args], {
    cwd: project,
    encoding: "utf-8",
    timeout: 30_000,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      NO_COLOR: "1",
    },
  });
}

function configuredAgents(project: string): string[] {
  const config = JSON.parse(fs.readFileSync(path.join(project, ".wolf", "config.json"), "utf-8"));
  return config.openwolf.agents;
}

describe("init --agent selection", { skip: !haveDist ? "dist not built" : false }, () => {
  test("--agent codex creates only Codex configuration", (t) => {
    const { base, home, project } = fixture("agent-selection-codex");
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));

    runCli(project, home, ["init", "--agent", "codex"]);

    assert.deepStrictEqual(configuredAgents(project), ["codex"]);
    assert.ok(fs.existsSync(path.join(project, ".codex", "hooks.json")));
    assert.ok(fs.existsSync(path.join(project, ".codex", "prompts", "handoff.md")));
    assert.strictEqual(fs.existsSync(path.join(project, ".claude")), false);
    assert.strictEqual(fs.existsSync(path.join(project, "CLAUDE.md")), false);
    assert.strictEqual(fs.existsSync(path.join(project, ".opencode")), false);
    assert.strictEqual(fs.existsSync(path.join(project, "GEMINI.md")), false);
    assert.strictEqual(fs.existsSync(path.join(project, ".cursor")), false);

    const status = runCli(project, home, ["status"]);
    assert.doesNotMatch(status, /\.claude\/settings\.json not found/);
  });

  test("--agent all includes Claude and every registered adapter", (t) => {
    const { base, home, project } = fixture("agent-selection-all");
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));

    runCli(project, home, ["init", "--agent", "all"]);

    assert.deepStrictEqual(configuredAgents(project), [
      "claude",
      "codex",
      "opencode",
      "gemini",
      "cursor",
      "antigravity",
    ]);
    assert.ok(fs.existsSync(path.join(project, ".claude", "settings.json")));
    assert.ok(fs.existsSync(path.join(project, ".codex", "hooks.json")));
    assert.ok(fs.existsSync(path.join(project, ".opencode", "plugin", "openwolf.ts")));
    assert.ok(fs.existsSync(path.join(project, "GEMINI.md")));
    assert.ok(fs.existsSync(path.join(project, ".cursor", "rules", "openwolf.mdc")));
  });

  test("update does not add Claude configuration to a Codex-only project", (t) => {
    const { base, home, project } = fixture("agent-selection-update");
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));

    runCli(project, home, ["init", "--agent", "codex"]);
    runCli(project, home, ["update", "--project", "agent-selection-update"]);

    assert.deepStrictEqual(configuredAgents(project), ["codex"]);
    assert.strictEqual(fs.existsSync(path.join(project, ".claude")), false);
    assert.strictEqual(fs.existsSync(path.join(project, "CLAUDE.md")), false);
  });

  test("update keeps the Claude default for legacy configs without agents", (t) => {
    const { base, home, project } = fixture("agent-selection-legacy");
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));

    runCli(project, home, ["init", "--agent", "codex"]);
    const configPath = path.join(project, ".wolf", "config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    delete config.openwolf.agents;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");

    runCli(project, home, ["update", "--project", "agent-selection-legacy"]);

    assert.ok(fs.existsSync(path.join(project, ".claude", "settings.json")));
    assert.ok(fs.existsSync(path.join(project, ".claude", "rules", "openwolf.md")));
  });
});
