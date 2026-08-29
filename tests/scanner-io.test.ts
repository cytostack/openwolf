import { test, describe } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { extractDescription } from "../src/scanner/description-extractor.ts";

// #92 (davdittrich): the scanner read each eligible file in full for hashing,
// tokens and symbols, then called extractDescription(filePath), which opened
// and read the first 12 KiB of the same file again. Two opens per file, on
// every full scan, scaling with project size.
//
// #91 (davdittrich): the daemon watcher read and broadcast every per-session
// hook file, which no dashboard consumer maps to state.

const ROOT = path.resolve(import.meta.dirname ?? ".", "..");
const DIST_SCANNER = path.join(ROOT, "dist", "src", "scanner", "anatomy-scanner.js");
const haveDist = fs.existsSync(DIST_SCANNER);

describe("#92 extractDescription", () => {
  test("supplied content produces a byte-identical description to reading the file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ow-desc-"));
    const cases: Array<[string, string]> = [
      ["mod.ts", "/**\n * Does the thing well.\n */\nexport function go() {}\n"],
      ["notes.md", "# Title\n\nA paragraph describing the document.\n"],
      ["script.py", '"""Module docstring here."""\n\ndef f():\n    pass\n'],
      ["plain.txt", "just some text\n"],
      ["empty.ts", ""],
      ["big.ts", "// leading comment\n" + "const filler = 1;\n".repeat(5000)],
    ];
    for (const [name, body] of cases) {
      const p = path.join(dir, name);
      fs.writeFileSync(p, body);
      assert.strictEqual(
        extractDescription(p, body),
        extractDescription(p),
        `${name}: passing content must not change the description`,
      );
    }
  });

  test("a known filename does not need content at all", () => {
    assert.strictEqual(extractDescription("/anywhere/README.md", "ignored"), "Project documentation");
  });
});

describe("#92 scan file I/O (compiled)", { skip: !haveDist ? "dist not built" : false }, () => {
  test("each eligible file is opened once, not twice", async () => {
    // Node freezes builtin module namespaces, so the read cannot be spied on
    // in place. Instrument a COPY of the compiled scanner instead: identical
    // code, plus a counter in the one function whose extra open is the bug.
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), "ow-io-dist-"));
    fs.cpSync(path.join(ROOT, "dist", "src"), path.join(stage, "src"), { recursive: true });
    fs.cpSync(path.join(ROOT, "dist", "hooks"), path.join(stage, "hooks"), { recursive: true });
    fs.writeFileSync(path.join(stage, "package.json"), JSON.stringify({ type: "module" }));

    const tallyPath = path.join(stage, "opens.log");
    const extractorPath = path.join(stage, "src", "scanner", "description-extractor.js");
    const extractorSrc = fs.readFileSync(extractorPath, "utf-8");
    assert.ok(extractorSrc.includes("fs.openSync"), "the extractor's own read path must still exist");
    fs.writeFileSync(
      extractorPath,
      extractorSrc.replace(
        "const fd = fs.openSync(filePath, \"r\");",
        `fs.appendFileSync(${JSON.stringify(tallyPath)}, filePath + "\\n"); const fd = fs.openSync(filePath, "r");`,
      ),
    );

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ow-io-"));
    const wolfDir = path.join(root, ".wolf");
    fs.mkdirSync(wolfDir, { recursive: true });
    // Non-"known" filenames, so the extractor cannot short-circuit on the name.
    const names = Array.from({ length: 12 }, (_, i) => `module-${i}.ts`);
    for (const n of names) {
      fs.writeFileSync(path.join(root, n), `// ${n} does a thing\nexport const x = 1;\n`);
    }

    const { scanProject } = await import(path.join(stage, "src", "scanner", "anatomy-scanner.js"));
    await scanProject(wolfDir, root);

    const store = JSON.parse(fs.readFileSync(path.join(wolfDir, "anatomy-index.json"), "utf-8"));
    assert.strictEqual(Object.keys(store.files).length, names.length, "every file should have been scanned");
    assert.ok(store.files["module-0.ts"].description.length > 0, "descriptions must survive the change");

    const reopened = fs.existsSync(tallyPath)
      ? fs.readFileSync(tallyPath, "utf-8").split("\n").filter((l) => l.trim()).length
      : 0;
    assert.strictEqual(
      reopened,
      0,
      `the scanner reopened ${reopened} files it had already read in full`,
    );
  });
});

describe("#91 watcher ignore list", () => {
  test("per-session hook files, locks and the bash cache are not watched", () => {
    const src = fs.readFileSync(path.join(ROOT, "src", "daemon", "file-watcher.ts"), "utf-8");
    const ignored = src.slice(src.indexOf("ignored: ["), src.indexOf("persistent: true"));
    for (const glob of ["**/hooks/sessions/**", "**/*.lock", "**/cache/**", "**/hooks/_session.json"]) {
      assert.ok(ignored.includes(glob), `${glob} must be in the watcher ignore list`);
    }
  });

  test("everything the dashboard consumes is still watched", () => {
    const src = fs.readFileSync(path.join(ROOT, "src", "daemon", "file-watcher.ts"), "utf-8");
    const ignored = src.slice(src.indexOf("ignored: ["), src.indexOf("persistent: true"));
    // Extracted from useWolfData.ts: every path it maps to application state.
    const consumed = [
      "anatomy-index.json", "anatomy.md", "buglog.json", "cerebrum.md", "config.json",
      "cron-manifest.json", "cron-state.json", "hooks/_heartbeat.json", "identity.md",
      "memory.md", "STATUS.md", "token-ledger.json", "_scan-state.json",
    ];
    for (const file of consumed) {
      assert.ok(!ignored.includes(file), `${file} is consumed by the dashboard and must stay watched`);
    }
    // The heartbeat lives under hooks/ but must survive the sessions/ glob.
    assert.ok(!ignored.includes("**/hooks/**"), "an over-broad hooks glob would kill the heartbeat feed");
  });
});
