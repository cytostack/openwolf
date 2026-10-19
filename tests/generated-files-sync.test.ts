import { test, describe } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";

// scripts/sync-plugin-runtime.mjs copies these standalone hook sources
// byte-for-byte into the OpenCode plugin template (and pricing.ts into the
// dashboard) so both runtimes share one implementation. Nothing enforces that
// copy at commit time, so editing a source file and forgetting to re-run the
// sync script (or to commit its output) silently leaves the generated file
// stale. This caught exactly that for src/hooks/shared.ts and
// src/templates/opencode-plugin/shared.ts after antigravity detection was
// added to one and not the other.
//
// This list must be kept in sync with scripts/sync-plugin-runtime.mjs by hand;
// a drifted list only weakens this test's coverage, it cannot pass falsely.
const SYNCED_HOOK_NAMES = [
  "anatomy-lock", "bug-id", "trusted-memory", "shared", "ledger", "ledger-math",
  "knowledge-root", "bug-journal", "session-state", "event-journal",
  "runtime-updates", "handoff-state", "visibility",
];

const ROOT = path.resolve(import.meta.dirname ?? ".", "..");

describe("generated plugin/dashboard files match their sync-plugin-runtime.mjs sources", () => {
  for (const name of SYNCED_HOOK_NAMES) {
    test(`opencode-plugin/${name}.ts matches hooks/${name}.ts`, () => {
      const source = fs.readFileSync(path.join(ROOT, "src", "hooks", `${name}.ts`), "utf-8");
      const generated = fs.readFileSync(path.join(ROOT, "src", "templates", "opencode-plugin", `${name}.ts`), "utf-8");
      assert.strictEqual(
        generated,
        source,
        `src/templates/opencode-plugin/${name}.ts is out of sync with src/hooks/${name}.ts - run: node scripts/sync-plugin-runtime.mjs`,
      );
    });
  }

  test("dashboard pricing.ts matches tracker/pricing.ts", () => {
    const source = fs.readFileSync(path.join(ROOT, "src", "tracker", "pricing.ts"), "utf-8");
    const generated = fs.readFileSync(path.join(ROOT, "src", "dashboard", "app", "lib", "pricing.ts"), "utf-8");
    assert.strictEqual(
      generated,
      source,
      "src/dashboard/app/lib/pricing.ts is out of sync with src/tracker/pricing.ts - run: node scripts/sync-plugin-runtime.mjs",
    );
  });
});
