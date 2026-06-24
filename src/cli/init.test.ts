import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { initCommand } from "./init.js";

const runInit = initCommand as unknown as (target?: string) => Promise<void>;

function makeProject(name: string): string {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), `openwolf-${name}-`));
  fs.writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name, version: "1.0.0" }, null, 2),
    "utf-8"
  );
  fs.writeFileSync(
    path.join(projectRoot, "index.ts"),
    "export const value = 1;\n",
    "utf-8"
  );
  return projectRoot;
}

function read(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}

function readJSON(filePath: string): Record<string, unknown> {
  return JSON.parse(read(filePath)) as Record<string, unknown>;
}

test("default init installs both Claude and Codex integration files", async () => {
  const projectRoot = makeProject("dual-target");
  const previousCwd = process.cwd();
  const previousHome = process.env.HOME;
  const previousCodexVersion = process.env.OPENWOLF_CODEX_VERSION;
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "openwolf-home-"));

  process.chdir(projectRoot);
  process.env.HOME = fakeHome;
  process.env.OPENWOLF_CODEX_VERSION = "0.129.0";

  try {
    await runInit();

    assert.ok(fs.existsSync(path.join(projectRoot, ".wolf", "OPENWOLF.md")));
    assert.ok(fs.existsSync(path.join(projectRoot, "CLAUDE.md")));
    assert.ok(fs.existsSync(path.join(projectRoot, ".claude", "settings.json")));
    assert.ok(fs.existsSync(path.join(projectRoot, ".claude", "rules", "openwolf.md")));
    assert.ok(fs.existsSync(path.join(projectRoot, "AGENTS.md")));
    assert.ok(fs.existsSync(path.join(projectRoot, ".codex", "hooks.json")));
    assert.ok(fs.existsSync(path.join(projectRoot, ".codex", "config.toml")));
    assert.ok(fs.existsSync(path.join(projectRoot, ".wolf", "hooks", "claude", "session-start.js")));
    assert.ok(fs.existsSync(path.join(projectRoot, ".wolf", "hooks", "codex", "session-start.js")));
    assert.equal(fs.existsSync(path.join(projectRoot, ".wolf", "hooks", "session-start.js")), false);

    assert.match(read(path.join(projectRoot, "CLAUDE.md")), /@\.wolf\/OPENWOLF\.md/);
    assert.match(read(path.join(projectRoot, "AGENTS.md")), /@\.wolf\/OPENWOLF\.md/);
    assert.match(
      JSON.stringify(readJSON(path.join(projectRoot, ".codex", "hooks.json"))),
      /\.wolf\/hooks\/codex\/session-start\.js/
    );
    assert.match(
      JSON.stringify(readJSON(path.join(projectRoot, ".codex", "hooks.json"))),
      /git rev-parse --show-toplevel 2>\/dev\/null \|\| pwd/
    );
    assert.match(read(path.join(projectRoot, ".codex", "config.toml")), /hooks = true/);
    assert.doesNotMatch(read(path.join(projectRoot, ".codex", "config.toml")), /codex_hooks = true/);
  } finally {
    process.chdir(previousCwd);
    process.env.HOME = previousHome;
    process.env.OPENWOLF_CODEX_VERSION = previousCodexVersion;
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(fakeHome, { recursive: true, force: true });
  }
});

test("claude target only installs Claude integration files", async () => {
  const projectRoot = makeProject("claude-only");
  const previousCwd = process.cwd();
  const previousHome = process.env.HOME;
  const previousCodexVersion = process.env.OPENWOLF_CODEX_VERSION;
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "openwolf-home-"));

  process.chdir(projectRoot);
  process.env.HOME = fakeHome;
  process.env.OPENWOLF_CODEX_VERSION = "0.129.0";

  try {
    await runInit("claude");

    assert.ok(fs.existsSync(path.join(projectRoot, "CLAUDE.md")));
    assert.ok(fs.existsSync(path.join(projectRoot, ".claude", "settings.json")));
    assert.ok(fs.existsSync(path.join(projectRoot, ".wolf", "hooks", "claude", "session-start.js")));
    assert.equal(fs.existsSync(path.join(projectRoot, ".codex", "hooks.json")), false);
    assert.equal(fs.existsSync(path.join(projectRoot, ".codex", "config.toml")), false);
    assert.equal(fs.existsSync(path.join(projectRoot, ".wolf", "hooks", "codex", "session-start.js")), false);
    assert.equal(fs.existsSync(path.join(projectRoot, "AGENTS.md")), false);
  } finally {
    process.chdir(previousCwd);
    process.env.HOME = previousHome;
    process.env.OPENWOLF_CODEX_VERSION = previousCodexVersion;
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(fakeHome, { recursive: true, force: true });
  }
});

test("codex target only installs Codex integration files", async () => {
  const projectRoot = makeProject("codex-only");
  const previousCwd = process.cwd();
  const previousHome = process.env.HOME;
  const previousCodexVersion = process.env.OPENWOLF_CODEX_VERSION;
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "openwolf-home-"));

  process.chdir(projectRoot);
  process.env.HOME = fakeHome;
  process.env.OPENWOLF_CODEX_VERSION = "0.129.0";

  try {
    await runInit("codex");

    assert.ok(fs.existsSync(path.join(projectRoot, "AGENTS.md")));
    assert.ok(fs.existsSync(path.join(projectRoot, ".codex", "hooks.json")));
    assert.ok(fs.existsSync(path.join(projectRoot, ".codex", "config.toml")));
    assert.ok(fs.existsSync(path.join(projectRoot, ".wolf", "hooks", "codex", "session-start.js")));
    assert.equal(fs.existsSync(path.join(projectRoot, ".wolf", "hooks", "claude", "session-start.js")), false);
    assert.equal(fs.existsSync(path.join(projectRoot, "CLAUDE.md")), false);
    assert.equal(fs.existsSync(path.join(projectRoot, ".claude", "settings.json")), false);
    assert.match(read(path.join(projectRoot, ".codex", "config.toml")), /hooks = true/);
    assert.doesNotMatch(read(path.join(projectRoot, ".codex", "config.toml")), /codex_hooks = true/);
  } finally {
    process.chdir(previousCwd);
    process.env.HOME = previousHome;
    process.env.OPENWOLF_CODEX_VERSION = previousCodexVersion;
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(fakeHome, { recursive: true, force: true });
  }
});
