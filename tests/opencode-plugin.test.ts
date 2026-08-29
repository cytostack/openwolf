import { test, describe, before } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

import { sessionFilePath } from "../src/templates/opencode-plugin/fs.ts";

// Issue #89 (davdittrich): every OpenCode handler receives a sessionId, but
// lifecycle, read, write, and stop handlers all persisted to one shared
// hooks/_session.json. A second session in the same project overwrote the
// first one's state, and later reads or writes from either session mutated
// whichever record survived.
//
// The plugin ships as .ts (OpenCode's runtime resolves ./x.js to x.ts, Node's
// type stripping does not), so the integration test compiles it first.

const ROOT = path.resolve(import.meta.dirname ?? ".", "..");
const PLUGIN_SRC = path.join(ROOT, "src", "templates", "opencode-plugin");
const TSC = path.join(ROOT, "node_modules", "typescript", "bin", "tsc");
let outDir = "";
let compiled = false;

before(() => {
  if (!fs.existsSync(TSC)) return;
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), "ow-plugin-build-"));
  // index.ts needs @opencode-ai/plugin, which is not a dependency here.
  const sources = fs.readdirSync(PLUGIN_SRC).filter((f) => f.endsWith(".ts") && f !== "index.ts");
  try {
    execFileSync(
      process.execPath,
      [TSC, "--outDir", outDir, "--target", "ES2022", "--module", "Node16",
       "--moduleResolution", "Node16", "--skipLibCheck",
       ...sources.map((f) => path.join(PLUGIN_SRC, f))],
      { stdio: "pipe" },
    );
  } catch {
    // tsc exits nonzero on the plugin's pre-existing type errors but still
    // emits; only a missing output file is fatal for this suite.
  }
  fs.writeFileSync(path.join(outDir, "package.json"), JSON.stringify({ type: "module" }));
  compiled = fs.existsSync(path.join(outDir, "session.js")) && fs.existsSync(path.join(outDir, "post-read.js"));
});

describe("sessionFilePath", () => {
  test("a valid session id gets its own file", () => {
    assert.strictEqual(sessionFilePath("/h", "ses_abc123"), path.join("/h", "sessions", "ses_abc123.json"));
    assert.strictEqual(sessionFilePath("/h", "a.b-c_d"), path.join("/h", "sessions", "a.b-c_d.json"));
  });

  test("missing or unusable ids fall back to the legacy shared file", () => {
    // Same validation as getSessionFilePath() in src/hooks/shared.ts.
    assert.strictEqual(sessionFilePath("/h", undefined), path.join("/h", "_session.json"));
    assert.strictEqual(sessionFilePath("/h", "abc"), path.join("/h", "_session.json"), "under 4 chars");
    assert.strictEqual(sessionFilePath("/h", "../../etc/passwd"), path.join("/h", "_session.json"), "path chars");
    assert.strictEqual(sessionFilePath("/h", "x".repeat(129)), path.join("/h", "_session.json"), "over 128 chars");
  });

  test("no handler builds the shared path directly any more", () => {
    for (const f of fs.readdirSync(PLUGIN_SRC)) {
      if (!f.endsWith(".ts") || f === "fs.ts") continue;
      const src = fs.readFileSync(path.join(PLUGIN_SRC, f), "utf-8");
      assert.ok(!src.includes('"_session.json"'), `${f} must go through sessionFilePath()`);
    }
  });
});

describe("two concurrent OpenCode sessions", () => {
  test("#89: session B does not overwrite session A's state", async (t) => {
    if (!compiled) return t.skip("plugin could not be compiled");
    const { handleSessionStart } = await import(path.join(outDir, "session.js"));
    const { handlePostRead } = await import(path.join(outDir, "post-read.js"));

    const project = fs.mkdtempSync(path.join(os.tmpdir(), "ow-oc-"));
    fs.mkdirSync(path.join(project, ".wolf"), { recursive: true });
    const fileA = path.join(project, "a.ts");
    const fileB = path.join(project, "b.ts");
    fs.writeFileSync(fileA, "export const a = 1;\n");
    fs.writeFileSync(fileB, "export const b = 2;\n");

    handleSessionStart(project, "ses_alpha01");
    handleSessionStart(project, "ses_beta002");

    // A reads after B started: on the shared file this mutated B's record.
    handlePostRead(project, "ses_alpha01", fileA, "export const a = 1;\n");
    handlePostRead(project, "ses_beta002", fileB, "export const b = 2;\n");

    const sessionsDir = path.join(project, ".wolf", "hooks", "sessions");
    const stateA = JSON.parse(fs.readFileSync(path.join(sessionsDir, "ses_alpha01.json"), "utf-8"));
    const stateB = JSON.parse(fs.readFileSync(path.join(sessionsDir, "ses_beta002.json"), "utf-8"));

    assert.strictEqual(stateA.session_id, "ses_alpha01");
    assert.strictEqual(stateB.session_id, "ses_beta002");
    assert.deepStrictEqual(
      Object.keys(stateA.files_read).map((k) => path.basename(k)),
      ["a.ts"],
      "session A must hold only its own read",
    );
    assert.deepStrictEqual(
      Object.keys(stateB.files_read).map((k) => path.basename(k)),
      ["b.ts"],
      "session B must hold only its own read",
    );
    assert.strictEqual(
      fs.existsSync(path.join(project, ".wolf", "hooks", "_session.json")),
      false,
      "with valid ids the legacy shared file must not be written at all",
    );
  });

  test("#89: an agent with no usable session id still works via the legacy file", async (t) => {
    if (!compiled) return t.skip("plugin could not be compiled");
    const { handleSessionStart } = await import(path.join(outDir, "session.js"));
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "ow-oc-legacy-"));
    fs.mkdirSync(path.join(project, ".wolf"), { recursive: true });

    handleSessionStart(project, "ab");

    assert.ok(fs.existsSync(path.join(project, ".wolf", "hooks", "_session.json")));
  });
});
