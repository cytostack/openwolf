import { describe, test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

// Hippocampus impact measurement: real outcome detectors (user corrections,
// test failures) must produce penalty events and move the recurrence counter,
// while ordinary prompts/tool output must NOT.

const tmpProject = () => fs.mkdtempSync(path.join(os.tmpdir(), "wolf-outcome-"));

function newHippoStore(root: string) {
  const wolfDir = path.join(root, ".wolf");
  fs.mkdirSync(wolfDir, { recursive: true });
}

describe("detectCorrection", () => {
  test("flags explicit corrections with a path target", async () => {
    const { detectCorrection } = await import("../src/hooks/shared.ts");
    const sig = detectCorrection("That is wrong, fix the parse error in src/hooks/shared.ts");
    assert.ok(sig);
    assert.strictEqual(sig!.path, "src/hooks/shared.ts");
    assert.match(sig!.error, /shared\.ts/);
  });

  test("flags corrections with a backtick identifier", async () => {
    const { detectCorrection } = await import("../src/hooks/shared.ts");
    const sig = detectCorrection("You made a mistake - `loadStore` returns the wrong thing");
    assert.ok(sig);
    assert.strictEqual(sig!.error, "loadStore");
  });

  test("ignores ordinary prompts and requests", async () => {
    const { detectCorrection } = await import("../src/hooks/shared.ts");
    assert.strictEqual(detectCorrection("please add a new feature to the dashboard"), null);
    assert.strictEqual(detectCorrection("what does this code do?"), null);
    assert.strictEqual(detectCorrection(""), null);
  });
});

describe("extractTestFailures", () => {
  test("extracts failure lines from failing test output", async () => {
    const { extractTestFailures } = await import("../src/hooks/shared.ts");
    const out = [
      "  PASS tests/a.test.ts",
      "  FAIL tests/b.test.ts",
      "  ✗ countMoreThanOne (8ms)",
      "  AssertionError: expected 1 to equal 2",
      "  Error: Cannot find module",
      "  expected: 2",
      "  received: 1",
      "Tests: 1 failed, 2 passed",
    ].join("\n");
    const failures = extractTestFailures(out);
    assert.ok(failures);
    assert.ok(failures!.length >= 3);
    assert.ok(failures!.some((f) => f.includes("FAIL tests/b.test.ts")));
    assert.ok(failures!.some((f) => f.includes("AssertionError")));
  });

  test("returns null for clean passing output", async () => {
    const { extractTestFailures } = await import("../src/hooks/shared.ts");
    const out = [
      "  PASS tests/a.test.ts",
      "  PASS tests/b.test.ts",
      "Tests: 2 passed, 0 failed",
    ].join("\n");
    assert.strictEqual(extractTestFailures(out), null);
    assert.strictEqual(extractTestFailures(""), null);
  });
});

describe("user-prompt hook", () => {
  test("records a penalty event when the user corrects the agent", () => {
    const root = tmpProject();
    newHippoStore(root);
    const hookPath = path.resolve(import.meta.dirname, "../dist/hooks/hooks/user-prompt.js");
    const result = spawnSync(process.execPath, [hookPath], {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root, CLAUDE_SESSION_ID: "corr-test" },
      input: JSON.stringify({ prompt: "That is wrong, fix the bug in src/auth.ts" }),
      encoding: "utf-8",
    });
    assert.strictEqual(result.status, 0, result.stderr);
    const store = JSON.parse(fs.readFileSync(path.join(root, ".wolf", "hippocampus.json"), "utf-8"));
    assert.strictEqual(store.stats.penalty_count, 1);
    assert.strictEqual(store.stats.negative_writes, 1);
    const evt = store.buffer[store.buffer.length - 1];
    assert.strictEqual(evt.outcome.valence, "penalty");
    assert.strictEqual(evt.action.type, "correct");
    assert.ok(evt.context.files_involved.includes("src/auth.ts"));
    assert.match(evt.outcome.reflection, /User correction/);
  });

  test("does NOT record events for ordinary prompts", () => {
    const root = tmpProject();
    newHippoStore(root);
    const hookPath = path.resolve(import.meta.dirname, "../dist/hooks/hooks/user-prompt.js");
    const result = spawnSync(process.execPath, [hookPath], {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root, CLAUDE_SESSION_ID: "norm-test" },
      input: JSON.stringify({ prompt: "add a new feature to the dashboard" }),
      encoding: "utf-8",
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(fs.existsSync(path.join(root, ".wolf", "hippocampus.json")), false);
  });
});

describe("post-test hook", () => {
  test("records a penalty event when tests fail", () => {
    const root = tmpProject();
    newHippoStore(root);
    const hookPath = path.resolve(import.meta.dirname, "../dist/hooks/hooks/post-test.js");
    const result = spawnSync(process.execPath, [hookPath], {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root, CLAUDE_SESSION_ID: "test-fail-test" },
      input: JSON.stringify({
        tool_name: "Bash",
        tool_input: { command: "pnpm test" },
        tool_response: {
          output: [
            "  PASS tests/a.test.ts",
            "  FAIL tests/b.test.ts",
            "  AssertionError: expected 1 to equal 2",
            "Tests: 1 failed, 2 passed",
          ].join("\n"),
        },
      }),
      encoding: "utf-8",
    });
    assert.strictEqual(result.status, 0, result.stderr);
    const store = JSON.parse(fs.readFileSync(path.join(root, ".wolf", "hippocampus.json"), "utf-8"));
    assert.strictEqual(store.stats.penalty_count, 1);
    assert.strictEqual(store.stats.negative_writes, 1);
    const evt = store.buffer[store.buffer.length - 1];
    assert.strictEqual(evt.outcome.valence, "penalty");
    assert.strictEqual(evt.action.subtype, "test-failure");
    assert.ok(evt.action.error_message.includes("FAIL tests/b.test.ts"));
  });

  test("does NOT record events for passing tests", () => {
    const root = tmpProject();
    newHippoStore(root);
    const hookPath = path.resolve(import.meta.dirname, "../dist/hooks/hooks/post-test.js");
    const result = spawnSync(process.execPath, [hookPath], {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root, CLAUDE_SESSION_ID: "test-pass-test" },
      input: JSON.stringify({
        tool_name: "Bash",
        tool_input: { command: "pnpm test" },
        tool_response: { output: "Tests: 2 passed, 0 failed\n" },
      }),
      encoding: "utf-8",
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(fs.existsSync(path.join(root, ".wolf", "hippocampus.json")), false);
  });
});

describe("post-write no longer fabricates trauma from edit counts", () => {
  test("3+ edits of the same file produce a neutral event, not trauma", () => {
    const root = tmpProject();
    const wolfDir = path.join(root, ".wolf");
    const hooksDir = path.join(wolfDir, "hooks");
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.mkdirSync(hooksDir, { recursive: true });
    const target = path.join(root, "src", "iter.ts");
    fs.writeFileSync(target, "export const value = 1;", "utf-8");
    fs.writeFileSync(path.join(wolfDir, "memory.md"), "", "utf-8");
    fs.writeFileSync(
      path.join(hooksDir, "_session.json"),
      JSON.stringify({ files_written: [], edit_counts: { "src/iter.ts": 5 } }),
      "utf-8"
    );
    const hookPath = path.resolve(import.meta.dirname, "../dist/hooks/hooks/post-write.js");
    const result = spawnSync(process.execPath, [hookPath], {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root, CLAUDE_SESSION_ID: "iter-test" },
      input: JSON.stringify({
        tool_name: "Edit",
        tool_input: { file_path: target, old_string: "value = 1", new_string: "value = 2" },
      }),
      encoding: "utf-8",
    });
    assert.strictEqual(result.status, 0, result.stderr);
    const store = JSON.parse(fs.readFileSync(path.join(wolfDir, "hippocampus.json"), "utf-8"));
    assert.strictEqual(store.stats.trauma_count, 0);
    assert.strictEqual(store.stats.penalty_count, 0);
    assert.strictEqual(store.stats.neutral_count, 1);
    const evt = store.buffer[store.buffer.length - 1];
    assert.strictEqual(evt.outcome.valence, "neutral");
    assert.strictEqual(evt.outcome.is_recurring, true);
  });
});
