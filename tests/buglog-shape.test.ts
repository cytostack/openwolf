import { test, describe } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { readBugLogFile } from "../src/hooks/shared.ts";
import { buildHookSettings, HOOK_COUNT } from "../src/cli/hook-manifest.ts";

// bug-tracker.ts imports ../utils/fs-safe.js, and node's type stripping does
// not map a .js specifier onto its .ts source, so the CLI side is exercised
// through the build output the way hook-health.test.ts does with dist/hooks.
const DIST = path.resolve(import.meta.dirname ?? ".", "..", "dist", "src", "buglog", "bug-tracker.js");
const tracker: { readBugLog: (d: string) => { bugs: any[] }; searchBugs: (d: string, t: string) => any[] } | null =
  fs.existsSync(DIST) ? await import(DIST) : null;

function tmpWolf(contents: string | null): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-bl-"));
  const wolfDir = path.join(root, ".wolf");
  fs.mkdirSync(wolfDir, { recursive: true });
  if (contents !== null) fs.writeFileSync(path.join(wolfDir, "buglog.json"), contents, "utf-8");
  return wolfDir;
}

const ENTRY = {
  id: "x-1",
  timestamp: "2026-08-21T10:00:00",
  error_message: "boom in widget",
  file: "src/a.ts",
  root_cause: "r",
  fix: "f",
  tags: ["widget"],
};

// A hand-written buglog is commonly a bare array of entries rather than the
// { version, bugs } envelope bug-tracker writes. That shape reached
// `bugLog.bugs.length` unguarded and threw, which is how the pre-write hook
// accumulated 465 consecutive failures on one project with nothing but the
// heartbeat noticing, and how one malformed file blanked the whole dashboard.
describe("buglog shape coercion", () => {
  const readers: Array<[string, (d: string) => { bugs: any[] }]> = [["hooks.readBugLogFile", readBugLogFile]];
  if (tracker) readers.push(["bug-tracker.readBugLog", tracker.readBugLog]);

  for (const [name, read] of readers) {
    test(`${name}: bare array becomes { version, bugs }`, () => {
      const wolfDir = tmpWolf(JSON.stringify([ENTRY]));
      const log = read(wolfDir);
      assert.ok(Array.isArray(log.bugs), "bugs must always be an array");
      assert.equal(log.bugs.length, 1);
      assert.equal(log.bugs[0].id, "x-1");
    });

    test(`${name}: proper envelope passes through`, () => {
      const wolfDir = tmpWolf(JSON.stringify({ version: 1, bugs: [ENTRY] }));
      assert.equal(read(wolfDir).bugs.length, 1);
    });

    test(`${name}: missing, empty, and junk shapes yield an empty log`, () => {
      for (const contents of [null, "", "not json", "null", "42", '{"bugs":"nope"}', '{"nothing":1}']) {
        const wolfDir = tmpWolf(contents);
        const log = read(wolfDir);
        assert.ok(Array.isArray(log.bugs), `bugs must be an array for ${JSON.stringify(contents)}`);
        assert.equal(log.bugs.length, 0);
      }
    });
  }

  test("searchBugs survives an array-shaped log instead of throwing", { skip: tracker ? false : "run pnpm build first" }, () => {
    const wolfDir = tmpWolf(JSON.stringify([ENTRY]));
    assert.equal(tracker!.searchBugs(wolfDir, "widget").length, 1);
    assert.equal(tracker!.searchBugs(wolfDir, "nothing-matches-this").length, 0);
  });
});

// Hook commands used to carry $CLAUDE_PROJECT_DIR / %CLAUDE_PROJECT_DIR%.
// PowerShell expands neither, and Claude Code never puts the variable in the
// hook environment on any platform, so every hook died with MODULE_NOT_FOUND
// on Windows. The command now carries a resolved absolute path.
describe("hook settings paths", () => {
  test("no shell variable of any syntax survives into a command", () => {
    for (const dir of ["/Users/dev/proj", "C:\\Users\\dev\\proj", "/tmp/p/"]) {
      for (const matchers of Object.values(buildHookSettings(dir).hooks)) {
        for (const m of matchers) {
          for (const h of m.hooks) {
            assert.ok(!h.command.includes("$CLAUDE_PROJECT_DIR"), h.command);
            assert.ok(!h.command.includes("%CLAUDE_PROJECT_DIR%"), h.command);
            assert.ok(!/[$%]/.test(h.command), `no variable syntax: ${h.command}`);
          }
        }
      }
    }
  });

  test("windows paths are normalised to forward slashes, trailing slash dropped", () => {
    const win = buildHookSettings("C:\\Users\\dev\\proj").hooks.Stop[0].hooks[0].command;
    assert.equal(win, 'node "C:/Users/dev/proj/.wolf/hooks/stop.js"');
    const posix = buildHookSettings("/tmp/p/").hooks.Stop[0].hooks[0].command;
    assert.equal(posix, 'node "/tmp/p/.wolf/hooks/stop.js"');
  });

  test("every registered hook is counted and unique", () => {
    const commands = Object.values(buildHookSettings("/p").hooks)
      .flatMap((matchers) => matchers.flatMap((m) => m.hooks.map((h) => h.command)));
    assert.equal(commands.length, HOOK_COUNT);
    assert.equal(new Set(commands).size, HOOK_COUNT);
  });
});
