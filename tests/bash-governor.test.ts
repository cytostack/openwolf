import { test, describe } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";

import { classifyCommand, condenseOutput, estimateTokens } from "../src/hooks/bash-output-governor.ts";
import { parseBashRead } from "../src/hooks/bash-path-parser.ts";

describe("classifyCommand", () => {
  const cases: Array<[string, string]> = [
    ["grep -rn TODO src/", "grep_flood"],
    ["rg -n 'foo' .", "grep_flood"],
    ["cat -n src/app.ts", "file_print"],
    ["sed -n '100,300p' big.log", "file_print"],
    ["git show HEAD~2", "git_show"],
    ["git log -p --since=yesterday", "git_show"],
    ["git diff main..feature", "git_show"],
    ["npm test", "test"],
    ["pytest tests/", "test"],
    ["php artisan test", "test"],
    ["cargo build --release", "build"],
    ["tsc --noEmit", "build"],
    ["curl -s https://api.example.com/data", "unknown"],
    ["ls -la", "unknown"],
  ];
  for (const [cmd, family] of cases) {
    test(`${JSON.stringify(cmd)} -> ${family}`, () => {
      assert.strictEqual(classifyCommand(cmd), family);
    });
  }
});

describe("condenseOutput", () => {
  test("grep flood: keeps first matches per file, adds counts, big reduction", () => {
    const lines: string[] = [];
    for (let f = 0; f < 20; f++) {
      for (let m = 0; m < 30; m++) lines.push(`src/file${f}.ts:${m + 1}: const value${m} = something_reasonably_long_${m};`);
    }
    const stdout = lines.join("\n");
    const r = condenseOutput("grep_flood", stdout, 2000, ".wolf/cache/bash/x.log")!;
    assert.ok(r.condensed_tokens < r.original_tokens * 0.4, `${r.condensed_tokens} vs ${r.original_tokens}`);
    assert.ok(r.text.includes("src/file0.ts:1:"));
    assert.ok(r.text.includes("+27 more matches in src/file0.ts"));
    assert.ok(r.text.includes("total: 600 matching lines across 20 files"));
    assert.ok(r.text.includes("Full output preserved verbatim at .wolf/cache/bash/x.log"));
  });

  test("git show: keeps commit header, elides hunks with counts", () => {
    const header = ["commit abc123", "Author: Dev <dev@x.com>", "Date: today", "", "    fix: the thing", ""];
    const diff: string[] = [];
    for (let f = 0; f < 5; f++) {
      diff.push(`diff --git a/f${f}.ts b/f${f}.ts`);
      for (let l = 0; l < 400; l++) diff.push(`+ added line ${l} with some realistic content here`);
    }
    const r = condenseOutput("git_show", [...header, ...diff].join("\n"), 2000, "log")!;
    assert.ok(r.text.includes("commit abc123"));
    assert.ok(r.text.includes("fix: the thing"));
    assert.ok(r.text.includes("400 diff lines"));
    assert.ok(r.condensed_tokens < r.original_tokens * 0.1);
  });

  test("file print / unknown: head+tail window", () => {
    const stdout = Array.from({ length: 1000 }, (_, i) => `line ${i} of a moderately long file with content`).join("\n");
    const r = condenseOutput("file_print", stdout, 2000, "log")!;
    assert.ok(r.text.includes("line 0 "));
    assert.ok(r.text.includes("line 999 "));
    assert.ok(r.text.includes("lines elided"));
  });

  test("below threshold or insufficient savings: returns null (pass-through)", () => {
    assert.strictEqual(condenseOutput("grep_flood", "short output", 2000, "log"), null);
    // Output that cannot be condensed much (unique unstructured lines just over threshold)
    const dense = Array.from({ length: 100 }, (_, i) => `u${i} ${Math.sin(i)}`).join("\n");
    const r = condenseOutput("unknown", dense, Math.max(1, estimateTokens(dense) - 5), "log");
    assert.strictEqual(r, null);
  });
});

describe("parseBashRead", () => {
  const yes: Array<[string, string, boolean]> = [
    ["cat src/app.ts", "src/app.ts", true],
    ["cat -n src/app.ts", "src/app.ts", true],
    ["head -50 README.md", "README.md", false],
    ["tail -n 20 logs/out.log", "logs/out.log", false],
    ["sed -n '10,40p' src/big.ts", "src/big.ts", false],
    ["cat src/app.ts | head -100", "src/app.ts", false],
  ];
  for (const [cmd, file, full] of yes) {
    test(`parses ${JSON.stringify(cmd)}`, () => {
      const r = parseBashRead(cmd)!;
      assert.ok(r, "expected a parse");
      assert.strictEqual(r.file, file);
      assert.strictEqual(r.full, full);
    });
  }

  const no = [
    "cat a.ts b.ts",
    "cat *.ts",
    "cat $(find . -name x)",
    "cat a.ts > b.ts",
    "cat a.ts | grep foo | head",
    "grep -rn TODO src/",
    "cat file | tee out.log",
    "sed -i 's/a/b/' file.ts",
    "ls -la",
    "",
  ];
  for (const cmd of no) {
    test(`rejects ${JSON.stringify(cmd)}`, () => {
      assert.strictEqual(parseBashRead(cmd), null);
    });
  }
});

// End-to-end through the compiled hook: replacement emitted with exact schema,
// full log written, measurement recorded.
const DIST_HOOKS = path.resolve(import.meta.dirname ?? ".", "..", "dist", "hooks");
const haveDist = fs.existsSync(path.join(DIST_HOOKS, "post-bash.js"));

describe("post-bash compiled hook", { skip: !haveDist ? "dist not built" : false }, () => {
  function setupProject(): { root: string; hooksDir: string } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-gov-"));
    const hooksDir = path.join(root, ".wolf", "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    for (const f of fs.readdirSync(DIST_HOOKS)) {
      if (f.endsWith(".js")) fs.copyFileSync(path.join(DIST_HOOKS, f), path.join(hooksDir, f));
    }
    fs.writeFileSync(path.join(hooksDir, "package.json"), JSON.stringify({ type: "module" }));
    return { root, hooksDir };
  }

  const runHook = (hooksDir: string, root: string, payload: unknown): Promise<string> =>
    new Promise((resolve, reject) => {
      const child = execFile(
        process.execPath,
        [path.join(hooksDir, "post-bash.js")],
        { env: { ...process.env, CLAUDE_PROJECT_DIR: root }, timeout: 10000, maxBuffer: 10 * 1024 * 1024 },
        (err, stdout) => (err ? reject(err) : resolve(stdout))
      );
      child.stdin!.end(JSON.stringify(payload));
    });

  test("replaces an oversized grep flood and preserves the full log", async () => {
    const { root, hooksDir } = setupProject();
    const lines: string[] = [];
    for (let f = 0; f < 30; f++) for (let m = 0; m < 40; m++) lines.push(`src/f${f}.ts:${m}: match content ${m}`);
    const stdout = lines.join("\n");

    const out = await runHook(hooksDir, root, {
      session_id: "gov1",
      tool_use_id: "toolu_test123",
      tool_input: { command: "grep -rn 'match' src/" },
      tool_response: { stdout, stderr: "", interrupted: false, isImage: false },
    });

    const parsed = JSON.parse(out);
    const updated = parsed.hookSpecificOutput.updatedToolOutput;
    assert.ok(updated, "expected updatedToolOutput");
    // Schema mirror: all original fields present, only stdout changed.
    assert.strictEqual(updated.stderr, "");
    assert.strictEqual(updated.interrupted, false);
    assert.strictEqual(updated.isImage, false);
    assert.ok(updated.stdout.length < stdout.length * 0.5);
    assert.ok(updated.stdout.includes("Full output preserved verbatim at .wolf/cache/bash/toolu_test123.log"));

    const logged = fs.readFileSync(path.join(root, ".wolf", "cache", "bash", "toolu_test123.log"), "utf-8");
    assert.strictEqual(logged, stdout);

    const session = JSON.parse(fs.readFileSync(path.join(hooksDir, "sessions", "gov1.json"), "utf-8"));
    assert.strictEqual(session.bash_governed.length, 1);
    assert.strictEqual(session.bash_governed[0].action, "replaced");
    assert.ok(session.bash_governed[0].original_tokens > session.bash_governed[0].entered_tokens);
  });

  test("suggests (never replaces) for test-runner output, and stays silent under threshold", async () => {
    const { root, hooksDir } = setupProject();
    const bigTestOutput = Array.from({ length: 900 }, (_, i) => `PASS test case number ${i} with a description`).join("\n");
    const out = await runHook(hooksDir, root, {
      session_id: "gov2",
      tool_input: { command: "npm test" },
      tool_response: { stdout: bigTestOutput, stderr: "", interrupted: false, isImage: false },
    });
    const parsed = JSON.parse(out);
    assert.strictEqual(parsed.hookSpecificOutput.updatedToolOutput, undefined);
    assert.ok(parsed.hookSpecificOutput.additionalContext.includes("saved at .wolf/cache/bash/"));

    const quiet = await runHook(hooksDir, root, {
      session_id: "gov2",
      tool_input: { command: "ls -la" },
      tool_response: { stdout: "total 8\nfile.txt", stderr: "", interrupted: false, isImage: false },
    });
    assert.strictEqual(quiet.trim(), "");
  });

  test("bash read dedupe: second cat of an unchanged file gets a factual advisory", async () => {
    const { root, hooksDir } = setupProject();
    const target = path.join(root, "notes.md");
    fs.writeFileSync(target, "hello world\n".repeat(50));
    const content = fs.readFileSync(target, "utf-8");
    const payload = (id: string) => ({
      session_id: id,
      tool_input: { command: `cat ${target}` },
      tool_response: { stdout: content, stderr: "", interrupted: false, isImage: false },
    });
    const first = await runHook(hooksDir, root, payload("dedup1"));
    assert.ok(!first.includes("already fully output"));
    const second = await runHook(hooksDir, root, payload("dedup1"));
    assert.ok(second.includes("already fully output"), second || "(empty)");
    // Different session: no advisory.
    const otherSession = await runHook(hooksDir, root, payload("dedup2"));
    assert.ok(!otherSession.includes("already fully output"));
  });
});
