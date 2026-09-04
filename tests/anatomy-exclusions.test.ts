import { test, describe } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  DEFAULT_EXCLUDE_PATTERNS,
  EXCLUDE_PATTERNS_ADDED_2_5_1,
  isVirtualenvDir,
  parseGitignore,
  isGitIgnored,
  loadGitignore,
} from "../src/scanner/exclusions.ts";

// Issue #93 (krsfer): `openwolf init`'s default exclude_patterns missed .venv,
// .gradle and .DS_Store, and the scanner carried a SHORTER fallback list, so
// the two disagreed. A mixed Android/Python repo indexed 526 files of which
// ~513 were inside .venv, including pip's own vendored dependencies.

const ROOT = path.resolve(import.meta.dirname ?? ".", "..");
const DIST_SCANNER = path.join(ROOT, "dist", "src", "scanner", "anatomy-scanner.js");
const haveDist = fs.existsSync(DIST_SCANNER);

describe("default exclude patterns", () => {
  test("covers the directories the issue reported", () => {
    for (const p of [".venv", "venv", "site-packages", ".gradle", ".DS_Store"]) {
      assert.ok(DEFAULT_EXCLUDE_PATTERNS.includes(p), `${p} must be excluded by default`);
    }
  });

  test("does not exclude names that are plausible source directories", () => {
    // A bare `env` is a common virtualenv name AND a common source directory;
    // virtualenvs are caught by pyvenv.cfg detection instead. A bare `netlify`
    // would drop netlify/functions/, which is application code.
    for (const p of ["env", "netlify", "src", "lib", "app", "test", "tests", "vendor"]) {
      assert.ok(!DEFAULT_EXCLUDE_PATTERNS.includes(p), `${p} must NOT be excluded by default`);
    }
  });

  test("the shipped template config carries the same list", () => {
    const template = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "templates", "config.json"), "utf-8"));
    assert.deepStrictEqual(
      template.openwolf.anatomy.exclude_patterns,
      [...DEFAULT_EXCLUDE_PATTERNS],
      "init, the scanner fallback, and the template must not drift apart again",
    );
    assert.strictEqual(template.openwolf.anatomy.respect_gitignore, true);
  });

  test("the 2.5.1 additions are all genuinely in the default list", () => {
    for (const p of EXCLUDE_PATTERNS_ADDED_2_5_1) {
      assert.ok(DEFAULT_EXCLUDE_PATTERNS.includes(p), `${p} is offered as an addition but is not a default`);
    }
  });
});

describe("virtualenv detection", () => {
  test("a directory with pyvenv.cfg is a virtualenv whatever it is called", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "ow-venv-"));
    const weird = path.join(base, "env");
    fs.mkdirSync(weird);
    assert.strictEqual(isVirtualenvDir(weird), false, "an ordinary env/ directory is source");
    fs.writeFileSync(path.join(weird, "pyvenv.cfg"), "home = /usr/bin\n");
    assert.strictEqual(isVirtualenvDir(weird), true);
  });
});

describe("gitignore matching", () => {
  const match = (patterns: string, p: string, dir = false) =>
    isGitIgnored(parseGitignore(patterns), p, dir);

  test("a bare name matches at any depth", () => {
    assert.strictEqual(match(".DS_Store", ".DS_Store"), true);
    assert.strictEqual(match(".DS_Store", "a/b/.DS_Store"), true);
  });

  test("a trailing slash matches directories only", () => {
    assert.strictEqual(match(".venv/", ".venv", true), true);
    assert.strictEqual(match(".venv/", ".venv", false), false);
  });

  test("a leading slash anchors to the project root", () => {
    assert.strictEqual(match("/build", "build", true), true);
    assert.strictEqual(match("/build", "src/build", true), false);
  });

  test("wildcards do not cross directory boundaries, ** does", () => {
    assert.strictEqual(match("*.log", "server.log"), true);
    assert.strictEqual(match("*.log", "logs/server.log"), true);
    assert.strictEqual(match("build/*.o", "build/a.o"), true);
    assert.strictEqual(match("build/*.o", "build/sub/a.o"), false);
    assert.strictEqual(match("build/**/*.o", "build/sub/deep/a.o"), true);
  });

  test("a later negation re-includes", () => {
    assert.strictEqual(match("*.log\n!keep.log", "keep.log"), false);
    assert.strictEqual(match("*.log\n!keep.log", "other.log"), true);
  });

  test("comments and blank lines are ignored", () => {
    assert.strictEqual(parseGitignore("# comment\n\n   \n").length, 0);
    assert.strictEqual(match("# .venv\n", ".venv", true), false, "a commented pattern must not apply");
  });

  test("a missing .gitignore yields no rules", () => {
    assert.deepStrictEqual(loadGitignore(fs.mkdtempSync(path.join(os.tmpdir(), "ow-nogit-"))), []);
  });
});

describe("scan of a polluted project (compiled)", { skip: !haveDist ? "dist not built" : false }, () => {
  test("#93: .venv, .gradle and .DS_Store stay out; real source stays in", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ow-poll-"));
    const wolfDir = path.join(root, ".wolf");
    fs.mkdirSync(wolfDir, { recursive: true });

    const write = (rel: string, body = "x = 1\n") => {
      const p = path.join(root, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, body);
    };

    // Real project source.
    write("src/main.py", "def main():\n    return 1\n");
    write("app/src/main/java/App.java", "class App {}\n");
    // The pollution from the issue.
    for (let i = 0; i < 30; i++) write(`.venv/lib/python3.14/site-packages/pip/_vendor/mod${i}.py`);
    write(".gradle/8.5/checksums/checksums.lock", "junk\n");
    write(".DS_Store", "junk\n");
    // A virtualenv under a name no list would guess.
    write("myenv/pyvenv.cfg", "home = /usr/bin\n");
    write("myenv/lib/site.py", "x = 1\n");
    // An `env/` that is real source, not a virtualenv.
    write("env/settings.py", "DEBUG = True\n");

    const { scanProject } = await import(DIST_SCANNER);
    await scanProject(wolfDir, root);

    const store = JSON.parse(fs.readFileSync(path.join(wolfDir, "anatomy-index.json"), "utf-8"));
    const indexed = Object.keys(store.files);

    assert.deepStrictEqual(indexed.filter((f) => f.includes(".venv/")), [], "no virtualenv contents");
    assert.deepStrictEqual(indexed.filter((f) => f.includes("site-packages")), [], "no vendored packages");
    assert.deepStrictEqual(indexed.filter((f) => f.startsWith(".gradle/")), [], "no gradle cache");
    assert.deepStrictEqual(indexed.filter((f) => f.includes(".DS_Store")), [], "no Finder metadata");
    assert.deepStrictEqual(indexed.filter((f) => f.startsWith("myenv/")), [], "pyvenv.cfg marks a virtualenv");

    assert.ok(indexed.includes("src/main.py"), "real source must survive");
    assert.ok(indexed.includes("app/src/main/java/App.java"), "real source must survive");
    assert.ok(indexed.includes("env/settings.py"), "an env/ that is not a virtualenv is real source");
  });

  test("#93: .gitignore alone is enough, even with an old config", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ow-git-"));
    const wolfDir = path.join(root, ".wolf");
    fs.mkdirSync(wolfDir, { recursive: true });
    // A project created before this release: the short legacy exclusion list.
    fs.writeFileSync(
      path.join(wolfDir, "config.json"),
      JSON.stringify({
        version: 1,
        openwolf: {
          anatomy: {
            max_description_length: 100, max_files: 500,
            exclude_patterns: ["node_modules", ".git", "dist", "build", ".wolf"],
          },
          token_audit: { chars_per_token_code: 3.5, chars_per_token_prose: 4.0 },
        },
      }),
    );
    fs.writeFileSync(path.join(root, ".gitignore"), ".venv/\ngenerated/\n*.log\n");
    fs.mkdirSync(path.join(root, ".venv", "lib"), { recursive: true });
    fs.writeFileSync(path.join(root, ".venv", "lib", "pkg.py"), "x = 1\n");
    fs.mkdirSync(path.join(root, "generated"), { recursive: true });
    fs.writeFileSync(path.join(root, "generated", "api.ts"), "export const x = 1;\n");
    fs.writeFileSync(path.join(root, "debug.log"), "noise\n");
    fs.writeFileSync(path.join(root, "real.ts"), "export const real = 1;\n");

    const { scanProject } = await import(DIST_SCANNER);
    await scanProject(wolfDir, root);

    const store = JSON.parse(fs.readFileSync(path.join(wolfDir, "anatomy-index.json"), "utf-8"));
    const indexed = Object.keys(store.files);
    assert.deepStrictEqual(indexed.filter((f) => f.startsWith(".venv/")), []);
    assert.deepStrictEqual(indexed.filter((f) => f.startsWith("generated/")), []);
    assert.deepStrictEqual(indexed.filter((f) => f.endsWith(".log")), []);
    assert.ok(indexed.includes("real.ts"));
  });
});
