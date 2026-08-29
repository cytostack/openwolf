import { before, test, describe } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import { resolveAgents } from "../dist/src/agents/index.js";
import { installSkills } from "../dist/src/agents/skills.js";

const templatesDir = path.resolve(import.meta.dirname, "../src/templates");
const kiloPluginSrc = path.join(templatesDir, "kilo-plugin");
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "wolf-kilo-"));

type SessionIdOf = (event: { type: string; properties?: Record<string, unknown> } & Record<string, unknown>) => string;
type HandlePrecompact = (directory: string, sessionId: string) => void;

let sessionIdOf: SessionIdOf;
let handlePrecompact: HandlePrecompact;

/** Node cannot resolve the template's `./x.js` specifiers to `x.ts`. Rewrite into a temp copy. */
before(async () => {
  const dest = tmpDir();
  for (const name of fs.readdirSync(kiloPluginSrc)) {
    if (!name.endsWith(".ts")) continue;
    const text = fs.readFileSync(path.join(kiloPluginSrc, name), "utf-8")
      .replace(/from "(\.\/[^"]+)\.js"/g, 'from "$1.ts"');
    fs.writeFileSync(path.join(dest, name), text);
  }
  ({ sessionIdOf } = await import(pathToFileURL(path.join(dest, "index.ts")).href));
  ({ handlePrecompact } = await import(pathToFileURL(path.join(dest, "session.ts")).href));
});

describe("sessionIdOf", () => {
  test("reads session.created id from properties.info.id", () => {
    assert.strictEqual(
      sessionIdOf({ type: "session.created", properties: { info: { id: "ses_1" } } }),
      "ses_1",
    );
  });

  test("reads session.idle id from properties.sessionID", () => {
    assert.strictEqual(
      sessionIdOf({ type: "session.idle", properties: { sessionID: "ses_1" } }),
      "ses_1",
    );
  });

  test("falls back to top-level sessionID", () => {
    assert.strictEqual(
      sessionIdOf({ type: "session.created", sessionID: "ses_1" }),
      "ses_1",
    );
  });

  test("falls back to top-level session_id", () => {
    assert.strictEqual(
      sessionIdOf({ type: "session.created", session_id: "ses_1" }),
      "ses_1",
    );
  });

  test("returns empty string when no id is present", () => {
    assert.strictEqual(sessionIdOf({ type: "session.created" }), "");
  });

  test("properties.info.id wins over properties.sessionID and top-level", () => {
    assert.strictEqual(
      sessionIdOf({
        type: "session.created",
        properties: { info: { id: "from_info" }, sessionID: "from_props" },
        sessionID: "from_top",
      }),
      "from_info",
    );
  });

  test("empty info.id falls through to properties.sessionID", () => {
    assert.strictEqual(
      sessionIdOf({
        type: "session.created",
        properties: { info: { id: "" }, sessionID: "ses_1" },
      }),
      "ses_1",
    );
  });

  test("non-object properties.info falls through", () => {
    assert.strictEqual(
      sessionIdOf({
        type: "session.created",
        properties: { info: "not-an-object", sessionID: "ses_1" },
      }),
      "ses_1",
    );
  });
});

describe("handlePrecompact", () => {
  test("no-ops when .wolf is missing", () => {
    const projectRoot = tmpDir();
    handlePrecompact(projectRoot, "ses_1");
    assert.ok(!fs.existsSync(path.join(projectRoot, ".wolf")));
  });

  test("snapshots existing _session.json with trigger compacting", () => {
    const projectRoot = tmpDir();
    const hooksDir = path.join(projectRoot, ".wolf", "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(
      path.join(hooksDir, "_session.json"),
      JSON.stringify({ session_id: "ses_1", stop_count: 2 }),
      "utf-8",
    );

    handlePrecompact(projectRoot, "ses_1");

    const snap = JSON.parse(fs.readFileSync(path.join(hooksDir, "_precompact-snapshot.json"), "utf-8"));
    assert.strictEqual(snap.trigger, "compacting");
    assert.strictEqual(typeof snap.at, "string");
    assert.ok(snap.at.length > 0);
    assert.deepStrictEqual(snap.session, { session_id: "ses_1", stop_count: 2 });
  });

  test("writes empty session object when _session.json is missing", () => {
    const projectRoot = tmpDir();
    fs.mkdirSync(path.join(projectRoot, ".wolf"), { recursive: true });

    handlePrecompact(projectRoot, "ses_1");

    const snap = JSON.parse(
      fs.readFileSync(path.join(projectRoot, ".wolf", "hooks", "_precompact-snapshot.json"), "utf-8"),
    );
    assert.strictEqual(snap.trigger, "compacting");
    assert.deepStrictEqual(snap.session, {});
  });
});

describe("kiloAdapter.install", () => {
  test("writes plugin files and AGENTS.md without skills or OpenCode entry", () => {
    const kiloAdapter = resolveAgents(["kilo"])[0];
    const projectRoot = tmpDir();
    const wolfDir = path.join(projectRoot, ".wolf");
    const ctx = { projectRoot, wolfDir, templatesDir };

    const first = kiloAdapter.install(ctx);
    assert.ok(first.actions.length > 0);

    const entryPath = path.join(projectRoot, ".kilo", "plugin", "openwolf.ts");
    const pluginDir = path.join(projectRoot, ".kilo", "plugin", "openwolf");
    assert.ok(fs.existsSync(entryPath));
    for (const file of [
      "index.ts",
      "session.ts",
      "pre-read.ts",
      "pre-write.ts",
      "post-read.ts",
      "post-write.ts",
      "stop.ts",
      "fs.ts",
      "anatomy.ts",
      "types.ts",
    ]) {
      assert.ok(fs.existsSync(path.join(pluginDir, file)), `missing ${file}`);
    }
    assert.ok(!fs.existsSync(path.join(pluginDir, "session-id.ts")));
    assert.ok(!fs.existsSync(path.join(projectRoot, ".kilo", "command")));
    assert.ok(!fs.existsSync(path.join(projectRoot, ".opencode")));

    const agentsMd = fs.readFileSync(path.join(projectRoot, "AGENTS.md"), "utf-8");
    assert.match(agentsMd, /<!-- openwolf:begin -->/);
    const beginCount = agentsMd.split("<!-- openwolf:begin -->").length - 1;
    assert.strictEqual(beginCount, 1);

    kiloAdapter.install(ctx);
    const agentsMd2 = fs.readFileSync(path.join(projectRoot, "AGENTS.md"), "utf-8");
    assert.strictEqual(agentsMd2.split("<!-- openwolf:begin -->").length - 1, 1);

    const entry = fs.readFileSync(entryPath, "utf-8");
    assert.match(entry, /export default/);
    assert.match(entry, /id: "openwolf"/);
    assert.doesNotMatch(entry, /export \{ OpenWolf \}/);

    const index = fs.readFileSync(path.join(pluginDir, "index.ts"), "utf-8");
    assert.match(index, /import type/);
    assert.match(index, /@kilocode\/plugin/);
    assert.match(index, /export const server/);
    assert.match(index, /export function sessionIdOf/);
    assert.match(index, /session\.idle/);
    assert.match(index, /properties\.info/);
    assert.match(index, /properties\.sessionID/);
    assert.match(index, /experimental\.session\.compacting/);
    assert.match(index, /multiedit/);
    assert.doesNotMatch(index, /@opencode-ai\/plugin/);
    assert.doesNotMatch(index, /export \{ OpenWolf \}/);
    assert.doesNotMatch(index, /chat\.message/);
    assert.doesNotMatch(index, /output\.prompt/);
    assert.doesNotMatch(index, /\bbash\b/);
    assert.doesNotMatch(index, /^\s*stop\s*:/m);
  });

  test("warns and writes nothing when kilo-plugin templates are missing", () => {
    const kiloAdapter = resolveAgents(["kilo"])[0];
    const projectRoot = tmpDir();
    const result = kiloAdapter.install({
      projectRoot,
      wolfDir: path.join(projectRoot, ".wolf"),
      templatesDir: tmpDir(),
    });
    assert.ok(result.warnings.some((w) => /kilo-plugin templates missing/.test(w)));
    assert.deepStrictEqual(result.actions, []);
    assert.ok(!fs.existsSync(path.join(projectRoot, ".kilo")));
    assert.ok(!fs.existsSync(path.join(projectRoot, "AGENTS.md")));
  });
});

describe("installSkills kilo", () => {
  test("writes .kilo/command skills and not .opencode/command", () => {
    const projectRoot = tmpDir();
    const actions = installSkills(projectRoot, templatesDir, ["kilo"]);
    assert.ok(actions.some((line) => line.includes("kilo")));
    assert.ok(fs.existsSync(path.join(projectRoot, ".kilo", "command", "reframe.md")));
    assert.ok(fs.existsSync(path.join(projectRoot, ".kilo", "command", "security-audit.md")));
    assert.ok(!fs.existsSync(path.join(projectRoot, ".opencode", "command")));
  });

  test("writes SDD skills (specify/plan/tasks/implement)", () => {
    const projectRoot = tmpDir();
    installSkills(projectRoot, templatesDir, ["kilo"]);
    for (const s of ["specify", "plan", "tasks", "implement"]) {
      assert.ok(
        fs.existsSync(path.join(projectRoot, ".kilo", "command", `${s}.md`)),
        `missing ${s}`,
      );
    }
  });
});

describe("kilo registry", () => {
  test("resolveAgents([kilo]) returns the kilo adapter", () => {
    const adapters = resolveAgents(["kilo"]);
    assert.strictEqual(adapters.length, 1);
    assert.strictEqual(adapters[0].name, "kilo");
  });

  test("resolveAgents([claude]) returns empty (claude is always-on)", () => {
    assert.deepStrictEqual(resolveAgents(["claude"]), []);
  });

  test("unknown-agent error lists kilo", () => {
    assert.throws(
      () => resolveAgents(["not-an-agent"]),
      (err: Error) => {
        assert.match(err.message, /kilo/);
        return true;
      },
    );
  });
});
