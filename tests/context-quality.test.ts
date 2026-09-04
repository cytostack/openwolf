import { test, describe } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";

import { topRules, globToRegExp, scopedRulesForFiles } from "../src/hooks/rule-reinjection.ts";
import { computeRootHash, quickStaleCheck, newStore } from "../src/hooks/anatomy-store.ts";
import { rankFromEdges } from "../src/anatomy/importance.ts";

describe("topRules", () => {
  test("returns the newest K bullet rules from Do-Not-Repeat", () => {
    const cerebrum = [
      "# Cerebrum", "", "## User Preferences", "- prefers pnpm", "",
      "## Do-Not-Repeat", "- never use em dashes in docs", "- do not bump ports", "- [2026-08-01] avoid intval for marks", "- keep hooks dependency-free", "",
      "## Decision Log", "- something",
    ].join("\n");
    const rules = topRules(cerebrum, 3);
    assert.strictEqual(rules.length, 3);
    assert.ok(rules[2].includes("keep hooks dependency-free"));
    assert.ok(!rules.some((r) => r.includes("prefers pnpm")));
  });

  test("empty section yields no rules", () => {
    assert.deepStrictEqual(topRules("# C\n\n## Do-Not-Repeat\n\n## Next\n"), []);
    assert.deepStrictEqual(topRules("no section at all"), []);
  });
});

describe("globToRegExp", () => {
  const cases: Array<[string, string, boolean]> = [
    ["src/**/*.ts", "src/deep/nested/file.ts", true],
    ["src/**/*.ts", "lib/file.ts", false],
    ["src/*.ts", "src/file.ts", true],
    ["src/*.ts", "src/deep/file.ts", false],
    ["**/*.{ts,tsx}", "a/b/c.tsx", true],
    ["**/*.{ts,tsx}", "a/b/c.js", false],
    ["app/Models/*.php", "app/Models/Quiz.php", true],
  ];
  for (const [glob, file, expected] of cases) {
    test(`${glob} vs ${file} -> ${expected}`, () => {
      assert.strictEqual(globToRegExp(glob).test(file), expected);
    });
  }
});

describe("scopedRulesForFiles", () => {
  test("returns only rules whose paths match session files", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-rules-"));
    const rulesDir = path.join(root, ".claude", "rules");
    fs.mkdirSync(rulesDir, { recursive: true });
    fs.writeFileSync(path.join(rulesDir, "ts.md"), `---\npaths:\n  - "src/**/*.ts"\n---\n\n- Always use strict types in src.`);
    fs.writeFileSync(path.join(rulesDir, "php.md"), `---\npaths:\n  - "app/**/*.php"\n---\n\n- Follow PSR-12 in app.`);
    fs.writeFileSync(path.join(rulesDir, "unscoped.md"), `---\ndescription: no paths key\n---\n\n- Loads at launch, never lost.`);

    const hits = scopedRulesForFiles(root, ["src/hooks/shared.ts"]);
    assert.strictEqual(hits.length, 1);
    assert.ok(hits[0].includes("strict types"));
    assert.ok(hits[0].includes("ts.md"));

    assert.deepStrictEqual(scopedRulesForFiles(root, ["README.md"]), []);
  });
});

describe("Merkle freshness (2.4)", () => {
  test("rootHash is stable for identical content and changes with it", () => {
    const a = newStore();
    a.files["src/x.ts"] = { description: "", tokens: 10, hash: "abc", updatedAt: "", source: "scan" };
    a.files["src/y.ts"] = { description: "", tokens: 10, hash: "def", updatedAt: "", source: "scan" };
    const b = newStore();
    // Insertion order must not matter.
    b.files["src/y.ts"] = { description: "", tokens: 99, hash: "def", updatedAt: "later", source: "hook" };
    b.files["src/x.ts"] = { description: "", tokens: 99, hash: "abc", updatedAt: "later", source: "hook" };
    assert.strictEqual(computeRootHash(a), computeRootHash(b));
    b.files["src/x.ts"].hash = "changed";
    assert.notStrictEqual(computeRootHash(a), computeRootHash(b));
  });

  test("quickStaleCheck flags modified and missing files, passes a fresh index", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-stale-"));
    const f1 = path.join(root, "a.ts");
    fs.writeFileSync(f1, "export const a = 1;\n");
    const st = fs.statSync(f1);
    const store = newStore();
    store.files["a.ts"] = { description: "", tokens: 5, hash: "h", size: st.size, mtimeMs: st.mtimeMs, updatedAt: "", source: "scan" };

    assert.strictEqual(quickStaleCheck(store, root).stale, false);

    fs.appendFileSync(f1, "export const b = 2;\n");
    const afterEdit = quickStaleCheck(store, root);
    assert.strictEqual(afterEdit.stale, true);
    assert.deepStrictEqual(afterEdit.changed, ["a.ts"]);

    store.files["gone.ts"] = { description: "", tokens: 5, hash: "h", size: 10, mtimeMs: 1, updatedAt: "", source: "scan" };
    assert.ok(quickStaleCheck(store, root).missing.includes("gone.ts"));
  });
});

describe("personalized PageRank (2.5)", () => {
  test("seeds pull their neighborhood above globally-popular nodes", () => {
    // hub is imported by everything; leaf-a/leaf-b import target.
    const nodes = ["hub", "a", "b", "c", "target", "leaf"];
    const edges = new Map<string, string[]>([
      ["a", ["hub"]], ["b", ["hub"]], ["c", ["hub"]],
      ["leaf", ["target"]],
    ]);
    const global = rankFromEdges(nodes, edges);
    assert.ok(global["hub"] > global["target"], "unseeded: hub dominates");
    const seeded = rankFromEdges(nodes, edges, { leaf: 10 });
    assert.ok(
      seeded["target"] / seeded["hub"] > global["target"] / global["hub"],
      "seeding leaf must raise target relative to hub"
    );
  });
});

// Compiled-hook digest behavior (2.4): index-shaped, no nag, no placeholders.
const DIST_HOOKS = path.resolve(import.meta.dirname ?? ".", "..", "dist", "hooks");
const haveDist = fs.existsSync(path.join(DIST_HOOKS, "session-start.js"));

describe("session-start digest (compiled)", { skip: !haveDist ? "dist not built" : false }, () => {
  function setup(): { root: string; hooksDir: string; wolfDir: string } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-digest-"));
    const wolfDir = path.join(root, ".wolf");
    const hooksDir = path.join(wolfDir, "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    for (const f of fs.readdirSync(DIST_HOOKS)) {
      if (f.endsWith(".js")) fs.copyFileSync(path.join(DIST_HOOKS, f), path.join(hooksDir, f));
    }
    fs.writeFileSync(path.join(hooksDir, "package.json"), JSON.stringify({ type: "module" }));
    return { root, hooksDir, wolfDir };
  }

  const run = (hooksDir: string, root: string, payload: unknown): Promise<string> =>
    new Promise((resolve, reject) => {
      const child = execFile(
        process.execPath,
        [path.join(hooksDir, "session-start.js")],
        { env: { ...process.env, CLAUDE_PROJECT_DIR: root, HOME: path.join(root, "fakehome") }, timeout: 10000 },
        (err, stdout) => (err ? reject(err) : resolve(stdout))
      );
      child.stdin!.end(JSON.stringify(payload));
    });

  test("injects an index, real DNR rules, and no placeholder or nag text", async () => {
    const { root, hooksDir, wolfDir } = setup();
    fs.writeFileSync(path.join(wolfDir, "cerebrum.md"),
      `---\ndescription: learned preferences\n---\n# Cerebrum\n\n## Do-Not-Repeat\n- never use intval for marks\n- keep hooks dependency-free\n\n## Decision Log\n- stuff that pads the file length beyond the template threshold for the index line\n`);
    fs.writeFileSync(path.join(wolfDir, "STATUS.md"),
      `# STATUS\n\n## 🚀 Next phase\n\n_<what we're building next, in 1 sentence>_\n`);
    fs.writeFileSync(path.join(wolfDir, "buglog.json"), JSON.stringify({ bugs: [{ error_message: "x", fix: "y" }] }));
    fs.writeFileSync(path.join(wolfDir, "_scan-state.json"), JSON.stringify({ last_scanned: "2026-01-01T00:00:00Z", git_head: "old" }));

    const out = await run(hooksDir, root, { source: "startup", session_id: "dg-100" });
    const ctx = JSON.parse(out).hookSpecificOutput.additionalContext as string;
    assert.ok(ctx.includes("never use intval"), "top DNR rules injected");
    assert.ok(ctx.includes(".wolf/cerebrum.md:"), "index line for cerebrum");
    assert.ok(ctx.includes("openwolf bug search") || ctx.includes("buglog.json"), "buglog pointer");
    assert.ok(!ctx.includes("may be stale"), "staleness nag deleted");
    assert.ok(!ctx.includes("what we're building next"), "no placeholder text");
  });

  test("compact source restores scoped rules for session files + top rules", async () => {
    const { root, hooksDir, wolfDir } = setup();
    fs.writeFileSync(path.join(wolfDir, "cerebrum.md"),
      `# Cerebrum\n\n## Do-Not-Repeat\n- rule alpha\n- rule beta\n`);
    const rulesDir = path.join(root, ".claude", "rules");
    fs.mkdirSync(rulesDir, { recursive: true });
    fs.writeFileSync(path.join(rulesDir, "scoped.md"), `---\npaths:\n  - "src/**/*.ts"\n---\n\n- Scoped rule: strict null checks.`);
    // Pre-existing session with a read in scope.
    const sessionsDir = path.join(wolfDir, "hooks", "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(sessionsDir, "cp-100.json"), JSON.stringify({
      session_id: "cp-100", started: "2026-08-20T00:00:00Z",
      files_read: { [path.join(root, "src", "a.ts")]: { count: 1, tokens: 100, first_read: "x" } },
      files_written: [{ file: path.join(root, "src", "a.ts"), action: "edit", tokens: 10, at: "x" }],
    }));

    const out = await run(hooksDir, root, { source: "compact", session_id: "cp-100" });
    const ctx = JSON.parse(out).hookSpecificOutput.additionalContext as string;
    assert.ok(ctx.includes("Session in progress"), "in-flight state restored");
    assert.ok(ctx.includes("rule alpha") || ctx.includes("rule beta"), "decay rules re-injected");
    assert.ok(ctx.includes("strict null checks"), "paths-scoped rule restored (documented compaction loss)");
  });
});
