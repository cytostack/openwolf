import { describe, test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { Hippocampus } from "../dist/hooks/hippocampus/index.js";

// Reproduces the REAL dogfood break: openwolf has 133 real penalties (VibeGames
// alone has 120) but recurrences = 0. Inspection of the live
// `.wolf/hippocampus.json` for VibeGames showed the overwhelming majority of
// penalties are tagged to a ROOT-LEVEL file — `AGENTS.md` (99×) plus introScene.ts /
// borderKernel.ts / Simulation.ts — i.e. a path with NO directory component.
//
// `match_mode:"parent"` computes the cue path's parent directories and keeps only
// events whose path starts with one of them. A root-level file has no parent
// directory (`getParentDirectories → []`), so even a fix-shaped edit on the VERY
// SAME file can never be recalled → recordRecurrence never fires → recurrences stays 0.
//
// This test seeds the real shape (penalty on a root file, then a fix-shaped Edit
// on that same root file) and asserts the recurrence counter increments.

const tmpProject = () => fs.mkdtempSync(path.join(os.tmpdir(), "wolf-recur-real-"));
const hookPath = path.resolve(import.meta.dirname, "../dist/hooks/hooks/post-write.js");

function seedPenalty(root: string, file: string, intensity = 0.7): void {
  new Hippocampus(root).addEvent({
    version: 1,
    timestamp: new Date().toISOString(),
    session_id: "recur-real",
    context: {
      project_root: root,
      files_involved: [file],
      cwd_at_time: root,
      spatial_path: file.includes("/") ? file.replace(/\/[^/]+$/, "") : ".",
      spatial_depth: file.split("/").length - 1,
      session_start: new Date().toISOString(),
      turn_in_session: 1,
    },
    action: {
      type: "correct",
      subtype: "user-correction",
      description: "User corrected",
      tokens_spent: 0,
      files_modified: [file],
      succeeded: false,
      error_message: file,
    },
    outcome: {
      valence: "penalty",
      intensity,
      reflection: `User correction in ${file}`,
    },
    source: "test",
    tags: ["user-correction", "penalty"],
  });
}

function drive(relPath: string, oldString: string, newString: string): number {
  const root = tmpProject();
  const wolfDir = path.join(root, ".wolf");
  const hooksDir = path.join(wolfDir, "hooks");
  fs.mkdirSync(path.dirname(path.join(root, relPath)), { recursive: true });
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.writeFileSync(path.join(root, relPath), "", "utf-8");
  fs.writeFileSync(path.join(wolfDir, "memory.md"), "", "utf-8");
  fs.writeFileSync(
    path.join(hooksDir, "_session.json"),
    JSON.stringify({ files_written: [], edit_counts: {} }),
    "utf-8"
  );
  seedPenalty(root, relPath);

  const result = spawnSync(process.execPath, [hookPath], {
    cwd: root,
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, CLAUDE_SESSION_ID: "recur-real" },
    input: JSON.stringify({
      tool_name: "Edit",
      tool_input: { file_path: path.join(root, relPath), old_string: oldString, new_string: newString },
    }),
    encoding: "utf-8",
  });
  assert.strictEqual(result.status, 0, result.stderr);
  const store = JSON.parse(fs.readFileSync(path.join(wolfDir, "hippocampus.json"), "utf-8"));
  return store.stats.recurrences;
}

describe("recurrence detects the real dogfood break", () => {
  test("penalty on a ROOT-LEVEL file (AGENTS.md) + fix-edit on the same file → recurrence", () => {
    const recurrences = drive(
      "AGENTS.md",
      "const TAX_RATE = 1.2; // WRONG rate",
      "const TAX_RATE = 1.1;"
    );
    assert.strictEqual(recurrences, 1);
  });

  test("small value change still yields a non-empty error signature (TAX_RATE 1.2→1.1)", () => {
    const recurrences = drive("src/tax.ts", "const TAX_RATE = 1.2;", "const TAX_RATE = 1.1;");
    assert.strictEqual(recurrences, 1);
  });

  test("same-path penalty on a sub-directory file still counts (no regression)", () => {
    const recurrences = drive("src/fix.ts", "const cfg = { tts: 1 };", "const cfg = { talk: 1 };");
    assert.strictEqual(recurrences, 1);
  });

  test("a fix-edit on a DIFFERENT path does not count (exact, not blanket parent)", () => {
    const root = tmpProject();
    const wolfDir = path.join(root, ".wolf");
    const hooksDir = path.join(wolfDir, "hooks");
    fs.mkdirSync(path.join(root, "src", "game"), { recursive: true });
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(root, "AGENTS.md"), "", "utf-8");
    fs.writeFileSync(path.join(root, "src", "game", "RadioLog.tsx"), "", "utf-8");
    fs.writeFileSync(path.join(wolfDir, "memory.md"), "", "utf-8");
    fs.writeFileSync(
      path.join(hooksDir, "_session.json"),
      JSON.stringify({ files_written: [], edit_counts: {} }),
      "utf-8"
    );
    new Hippocampus(root).addEvent({
      version: 1,
      timestamp: new Date().toISOString(),
      session_id: "recur-real",
      context: { project_root: root, files_involved: ["AGENTS.md"], cwd_at_time: root, spatial_path: ".", spatial_depth: 0, session_start: new Date().toISOString(), turn_in_session: 1 },
      action: { type: "correct", subtype: "user-correction", description: "User corrected", tokens_spent: 0, files_modified: ["AGENTS.md"], succeeded: false, error_message: "AGENTS.md" },
      outcome: { valence: "penalty", intensity: 0.7, reflection: "User correction in AGENTS.md" },
      source: "test",
      tags: ["user-correction", "penalty"],
    });

    const filePath = path.join(root, "src", "game", "RadioLog.tsx");
    const result = spawnSync(process.execPath, [hookPath], {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root, CLAUDE_SESSION_ID: "recur-real" },
      input: JSON.stringify({
        tool_name: "Edit",
        tool_input: { file_path: filePath, old_string: "const A = 1;", new_string: "const A = 2;" },
      }),
      encoding: "utf-8",
    });
    assert.strictEqual(result.status, 0, result.stderr);
    const store = JSON.parse(fs.readFileSync(path.join(wolfDir, "hippocampus.json"), "utf-8"));
    assert.strictEqual(store.stats.recurrences, 0);
  });
});
