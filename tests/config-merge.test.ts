import { test, describe } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { deepMergeMissing, mergeConfigDefaults } from "../src/cli/config-merge.ts";

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "wolf-cfg-"));

describe("deepMergeMissing", () => {
  test("adds missing keys without touching existing values", () => {
    const target: Record<string, unknown> = {
      openwolf: { daemon: { port: 18801 }, anatomy: { max_files: 900 } },
    };
    const defaults = {
      version: 1,
      openwolf: {
        reads: { duplicate_mode: "warn" },
        daemon: { port: 18790, log_level: "info" },
        anatomy: { max_files: 500 },
      },
    };

    const changed = deepMergeMissing(target, defaults);

    assert.strictEqual(changed, true);
    const ow = target.openwolf as any;
    assert.strictEqual(ow.reads.duplicate_mode, "warn");
    assert.strictEqual(ow.daemon.port, 18801);
    assert.strictEqual(ow.daemon.log_level, "info");
    assert.strictEqual(ow.anatomy.max_files, 900);
    assert.strictEqual((target as any).version, 1);
  });

  test("treats arrays as leaves: a customized list is never re-populated", () => {
    const target: Record<string, unknown> = { exclude: ["node_modules"] };
    const changed = deepMergeMissing(target, { exclude: ["node_modules", "dist", ".git"] });
    assert.strictEqual(changed, false);
    assert.deepStrictEqual(target.exclude, ["node_modules"]);
  });

  test("returns false when nothing is missing", () => {
    const target = { a: { b: 1 } };
    assert.strictEqual(deepMergeMissing(target, { a: { b: 2 } }), false);
    assert.strictEqual(target.a.b, 1);
  });
});

describe("mergeConfigDefaults", () => {
  test("merges the shipped template into a legacy project config on disk", () => {
    const dir = tmpDir();
    const templatesDir = path.join(dir, "templates");
    fs.mkdirSync(templatesDir);
    fs.writeFileSync(
      path.join(templatesDir, "config.json"),
      JSON.stringify({
        version: 1,
        openwolf: { reads: { duplicate_mode: "warn" }, dashboard: { port: 18791 } },
      }),
      "utf-8"
    );
    const cfgPath = path.join(dir, "config.json");
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({ version: 1, openwolf: { dashboard: { port: 18877 } } }),
      "utf-8"
    );

    assert.strictEqual(mergeConfigDefaults(cfgPath, templatesDir), true);
    const merged = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
    assert.strictEqual(merged.openwolf.reads.duplicate_mode, "warn");
    assert.strictEqual(merged.openwolf.dashboard.port, 18877);

    // Second run: nothing missing anymore.
    assert.strictEqual(mergeConfigDefaults(cfgPath, templatesDir), false);
  });

  test("no-ops when the project config does not exist", () => {
    const dir = tmpDir();
    assert.strictEqual(mergeConfigDefaults(path.join(dir, "config.json"), dir), false);
    assert.strictEqual(fs.existsSync(path.join(dir, "config.json")), false);
  });
});
