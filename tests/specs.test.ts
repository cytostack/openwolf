import { describe, test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

import {
  createEmptySpecState,
  advancePhase,
  setStatus,
  nextTask,
  taskCounts,
  buildSpecContext,
  buildTddReminder,
  getSpecStatePath,
  loadSpecState,
  saveSpecState,
  statusMentionsActiveSpec,
} from "../dist/src/specs/index.js";
import type { SpecState } from "../dist/src/specs/index.js";
import { formatSpecContext } from "../src/templates/kilo-plugin/spec.ts";

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "wolf-specs-"));

function state(overrides: Partial<SpecState> = {}): SpecState {
  return {
    ...createEmptySpecState("2026-01-01T00:00:00.000Z"),
    activeSpec: "001-user-auth",
    ...overrides,
  };
}

describe("advancePhase", () => {
  test("specify → plan is legal and bumps updatedAt", () => {
    const s = state({ phase: "specify" });
    const next = advancePhase(s, "plan", "2026-01-02T00:00:00.000Z");
    assert.strictEqual(next.phase, "plan");
    assert.strictEqual(next.updatedAt, "2026-01-02T00:00:00.000Z");
  });

  test("forward chain specify→plan→tasks→implement", () => {
    let s = state({ phase: "specify" });
    s = advancePhase(s, "plan");
    s = advancePhase(s, "tasks");
    s = advancePhase(s, "implement");
    assert.strictEqual(s.phase, "implement");
  });

  test("implement → tasks (re-plan) is legal", () => {
    const s = state({ phase: "implement" });
    assert.strictEqual(advancePhase(s, "tasks").phase, "tasks");
  });

  test("skipping a phase throws", () => {
    assert.throws(() => advancePhase(state({ phase: "specify" }), "implement"));
  });

  test("implement → plan (back more than one) throws", () => {
    assert.throws(() => advancePhase(state({ phase: "implement" }), "plan"));
  });

  test("no-op transition throws", () => {
    assert.throws(() => advancePhase(state({ phase: "plan" }), "plan"));
  });

  test("does not mutate the input state", () => {
    const s = state({ phase: "specify" });
    advancePhase(s, "plan");
    assert.strictEqual(s.phase, "specify");
  });
});

describe("setStatus", () => {
  test("active → paused / blocked / complete are legal", () => {
    assert.strictEqual(setStatus(state({ status: "active" }), "paused").status, "paused");
    assert.strictEqual(setStatus(state({ status: "active" }), "blocked").status, "blocked");
    assert.strictEqual(setStatus(state({ status: "active" }), "complete").status, "complete");
  });

  test("paused → active and blocked → active are legal", () => {
    assert.strictEqual(setStatus(state({ status: "paused" }), "active").status, "active");
    assert.strictEqual(setStatus(state({ status: "blocked" }), "active").status, "active");
  });

  test("complete is terminal", () => {
    assert.throws(() => setStatus(state({ status: "complete" }), "active"));
  });

  test("no-op status throws", () => {
    assert.throws(() => setStatus(state({ status: "active" }), "active"));
  });

  test("uses injected now", () => {
    const s = setStatus(state({ status: "active" }), "paused", "2026-03-01T00:00:00.000Z");
    assert.strictEqual(s.updatedAt, "2026-03-01T00:00:00.000Z");
  });
});

describe("nextTask", () => {
  test("returns first unchecked task id", () => {
    const md = "# Tasks\n\n- [ ] T001 - Setup\n- [ ] T002 - Next\n";
    assert.strictEqual(nextTask(md), "T001");
  });

  test("skips checked tasks", () => {
    const md = "- [x] T001 - done\n- [ ] T002 - next\n";
    assert.strictEqual(nextTask(md), "T002");
  });

  test("accepts uppercase [X]", () => {
    const md = "- [X] T001 - done\n- [ ] T002 - next\n";
    assert.strictEqual(nextTask(md), "T002");
  });

  test("tolerates [P] marker after the id", () => {
    const md = "- [ ] T101 - [P] Write user test\n";
    assert.strictEqual(nextTask(md), "T101");
  });

  test("returns null when all tasks checked", () => {
    const md = "- [x] T001 - done\n- [x] T002 - done\n";
    assert.strictEqual(nextTask(md), null);
  });

  test("returns null for empty or prose-only markdown", () => {
    assert.strictEqual(nextTask(""), null);
    assert.strictEqual(nextTask("# Just a heading\nno tasks here\n"), null);
  });
});

describe("taskCounts", () => {
  test("counts total / done / remaining", () => {
    const md = "- [x] T001 - a\n- [ ] T002 - b\n- [ ] T003 - c\n- [X] T004 - d\n";
    assert.deepStrictEqual(taskCounts(md), { total: 4, done: 2, remaining: 2 });
  });
});

describe("buildSpecContext", () => {
  test("returns empty string when no active spec", () => {
    assert.strictEqual(buildSpecContext(createEmptySpecState()), "");
  });

  test("includes spec id and phase, omits task when null", () => {
    const s = state({ phase: "plan", currentTask: null });
    assert.strictEqual(buildSpecContext(s), "📋 OpenWolf spec: 001-user-auth · phase plan\n");
  });

  test("includes task when set", () => {
    const s = state({ phase: "implement", currentTask: "T042" });
    assert.strictEqual(
      buildSpecContext(s),
      "📋 OpenWolf spec: 001-user-auth · phase implement · task T042\n",
    );
  });
});

describe("buildTddReminder", () => {
  test("empty for specify/plan phases", () => {
    assert.strictEqual(buildTddReminder(state({ phase: "specify" })), "");
    assert.strictEqual(buildTddReminder(state({ phase: "plan" })), "");
  });

  test("tasks-phase reminder mentions failing tests first", () => {
    const s = state({ phase: "tasks", status: "active" });
    assert.strictEqual(
      buildTddReminder(s),
      "🧪 OpenWolf TDD: define failing tests (T100-T199) before any implementation task.\n",
    );
  });

  test("implement-phase reminder is red-green-refactor", () => {
    const s = state({ phase: "implement", status: "active" });
    assert.strictEqual(
      buildTddReminder(s),
      "🧪 OpenWolf TDD: red → green → refactor — make the failing test pass with minimal code.\n",
    );
  });

  test("empty when status is not active", () => {
    assert.strictEqual(buildTddReminder(state({ phase: "implement", status: "paused" })), "");
    assert.strictEqual(buildTddReminder(state({ phase: "implement", status: "blocked" })), "");
    assert.strictEqual(buildTddReminder(state({ phase: "implement", status: "complete" })), "");
  });
});

describe("spec injection format parity (kilo-plugin vs src/specs)", () => {
  test("formatSpecContext matches buildSpecContext for a non-empty spec", () => {
    const s = state({ phase: "implement", currentTask: "T042" });
    assert.strictEqual(
      buildSpecContext(s),
      formatSpecContext("001-user-auth", "implement", "T042") + "\n",
    );
  });

  test("both return empty when no active spec", () => {
    assert.strictEqual(buildSpecContext(createEmptySpecState()), "");
    assert.strictEqual(formatSpecContext(null, "specify", null), "");
  });
});

describe("statusMentionsActiveSpec", () => {
  test("true when STATUS.md contains the active spec id", () => {
    assert.strictEqual(
      statusMentionsActiveSpec("Active: 002-spec-status-json", "002-spec-status-json"),
      true,
    );
  });

  test("false when STATUS.md mentions a different spec", () => {
    assert.strictEqual(
      statusMentionsActiveSpec("Active: 001-spec-cli", "002-spec-status-json"),
      false,
    );
  });

  test("false for empty status or empty activeSpec", () => {
    assert.strictEqual(statusMentionsActiveSpec("", "002"), false);
    assert.strictEqual(statusMentionsActiveSpec("Active: 002", ""), false);
  });
});

describe("spec-store", () => {
  test("getSpecStatePath is under .wolf", () => {
    const wolfDir = path.join(tmpDir(), ".wolf");
    assert.strictEqual(getSpecStatePath(wolfDir), path.join(wolfDir, "specs-state.json"));
  });

  test("round-trips through save/load", () => {
    const wolfDir = path.join(tmpDir(), ".wolf");
    const s = state({ phase: "implement", currentTask: "T042", status: "active" });
    saveSpecState(wolfDir, s);
    const loaded = loadSpecState(wolfDir, "2026-01-01T00:00:00.000Z");
    assert.strictEqual(loaded.activeSpec, "001-user-auth");
    assert.strictEqual(loaded.phase, "implement");
    assert.strictEqual(loaded.currentTask, "T042");
    assert.strictEqual(loaded.status, "active");
  });

  test("returns default state when missing", () => {
    const wolfDir = path.join(tmpDir(), ".wolf");
    const loaded = loadSpecState(wolfDir, "2026-01-01T00:00:00.000Z");
    assert.strictEqual(loaded.activeSpec, null);
    assert.strictEqual(loaded.phase, "specify");
    assert.strictEqual(loaded.status, "active");
  });

  test("backs up and returns default when corrupt", () => {
    const wolfDir = path.join(tmpDir(), ".wolf");
    fs.mkdirSync(wolfDir, { recursive: true });
    fs.writeFileSync(getSpecStatePath(wolfDir), "{not valid json", "utf-8");

    const loaded = loadSpecState(wolfDir, "2026-01-01T00:00:00.000Z");
    assert.strictEqual(loaded.activeSpec, null);

    const backups = fs.readdirSync(wolfDir).filter((f) => f.startsWith("specs-state.json.corrupt-"));
    assert.strictEqual(backups.length, 1);
  });
});

describe("openwolf spec CLI", () => {
  const cliPath = path.resolve(import.meta.dirname, "../dist/bin/openwolf.js");

  function specProject(): string {
    const root = tmpDir();
    fs.mkdirSync(path.join(root, "specs", "001-user-auth"), { recursive: true });
    fs.writeFileSync(path.join(root, "specs", "001-user-auth", "spec.md"), "# Spec\n", "utf-8");
    return root;
  }

  function run(root: string, args: string[]) {
    return spawnSync(process.execPath, [cliPath, ...args], { cwd: root, encoding: "utf-8" });
  }

  test("set validates the spec exists, status reflects it", () => {
    const root = specProject();
    const setOk = run(root, ["spec", "set", "001-user-auth"]);
    assert.strictEqual(setOk.status, 0);

    const status = run(root, ["spec", "status"]);
    assert.strictEqual(status.status, 0);
    assert.match(status.stdout, /001-user-auth/);
  });

  test("set fails (non-zero) for a missing spec", () => {
    const root = specProject();
    const r = run(root, ["spec", "set", "999-missing"]);
    assert.notStrictEqual(r.status, 0);
  });

  test("next advances to the first unchecked task", () => {
    const root = specProject();
    assert.strictEqual(run(root, ["spec", "set", "001-user-auth"]).status, 0);

    const tasks = "- [x] T001 - done\n- [ ] T002 - next\n";
    fs.writeFileSync(path.join(root, "specs", "001-user-auth", "tasks.md"), tasks, "utf-8");

    const next = run(root, ["spec", "next"]);
    assert.strictEqual(next.status, 0);
    assert.match(next.stdout, /T002/);

    const status = run(root, ["spec", "status"]);
    assert.match(status.stdout, /T002/);
  });

  test("phase skips are rejected (non-zero)", () => {
    const root = specProject();
    assert.strictEqual(run(root, ["spec", "set", "001-user-auth"]).status, 0);
    const r = run(root, ["spec", "phase", "implement"]); // specify → implement is illegal
    assert.notStrictEqual(r.status, 0);
  });

  test("re-set of the same spec is idempotent (keeps phase)", () => {
    const root = specProject();
    assert.strictEqual(run(root, ["spec", "set", "001-user-auth"]).status, 0);
    assert.strictEqual(run(root, ["spec", "phase", "plan"]).status, 0);
    assert.strictEqual(run(root, ["spec", "set", "001-user-auth"]).status, 0);
    const status = run(root, ["spec", "status"]);
    assert.match(status.stdout, /plan/);
    assert.doesNotMatch(status.stdout, /specify/);
  });

  test("set a different spec resets to specify", () => {
    const root = specProject();
    fs.mkdirSync(path.join(root, "specs", "002-other"), { recursive: true });
    fs.writeFileSync(path.join(root, "specs", "002-other", "spec.md"), "# Spec\n", "utf-8");
    assert.strictEqual(run(root, ["spec", "set", "001-user-auth"]).status, 0);
    assert.strictEqual(run(root, ["spec", "phase", "plan"]).status, 0);
    assert.strictEqual(run(root, ["spec", "set", "002-other"]).status, 0);
    const status = run(root, ["spec", "status"]);
    assert.match(status.stdout, /002-other/);
    assert.match(status.stdout, /specify/);
  });

  test("set rejects a path-traversal id", () => {
    const root = specProject();
    const r = run(root, ["spec", "set", "../../etc"]);
    assert.notStrictEqual(r.status, 0);
  });

  test("list marks the active spec", () => {
    const root = specProject();
    fs.mkdirSync(path.join(root, "specs", "002-other"), { recursive: true });
    fs.writeFileSync(path.join(root, "specs", "002-other", "spec.md"), "# Spec\n", "utf-8");
    assert.strictEqual(run(root, ["spec", "set", "001-user-auth"]).status, 0);
    const list = run(root, ["spec", "list"]);
    assert.strictEqual(list.status, 0);
    assert.match(list.stdout, /001-user-auth/);
    assert.match(list.stdout, /002-other/);
    assert.match(list.stdout, /001-user-auth\s*\*\s*active/);
  });

  test("list empty specs dir exits 0", () => {
    const root = tmpDir();
    fs.mkdirSync(path.join(root, "specs"), { recursive: true });
    const list = run(root, ["spec", "list"]);
    assert.strictEqual(list.status, 0);
    assert.match(list.stdout, /No specs/);
  });

  test("list ignores dirs without spec.md", () => {
    const root = specProject();
    fs.mkdirSync(path.join(root, "specs", "002-no-spec"), { recursive: true });
    const list = run(root, ["spec", "list"]);
    assert.doesNotMatch(list.stdout, /002-no-spec/);
  });

  test("next auto-completes when all tasks checked", () => {
    const root = specProject();
    assert.strictEqual(run(root, ["spec", "set", "001-user-auth"]).status, 0);
    fs.writeFileSync(
      path.join(root, "specs", "001-user-auth", "tasks.md"),
      "- [x] T001 - done\n",
      "utf-8",
    );
    const next = run(root, ["spec", "next"]);
    assert.strictEqual(next.status, 0);
    const status = run(root, ["spec", "status"]);
    assert.match(status.stdout, /Status: complete/);
  });

  test("next is idempotent when already complete", () => {
    const root = specProject();
    assert.strictEqual(run(root, ["spec", "set", "001-user-auth"]).status, 0);
    fs.writeFileSync(
      path.join(root, "specs", "001-user-auth", "tasks.md"),
      "- [x] T001 - done\n",
      "utf-8",
    );
    assert.strictEqual(run(root, ["spec", "next"]).status, 0);
    assert.strictEqual(run(root, ["spec", "next"]).status, 0);
    const status = run(root, ["spec", "status"]);
    assert.match(status.stdout, /Status: complete/);
  });

  test("next keeps status active when tasks remain", () => {
    const root = specProject();
    assert.strictEqual(run(root, ["spec", "set", "001-user-auth"]).status, 0);
    fs.writeFileSync(
      path.join(root, "specs", "001-user-auth", "tasks.md"),
      "- [x] T001 - done\n- [ ] T002 - next\n",
      "utf-8",
    );
    assert.strictEqual(run(root, ["spec", "next"]).status, 0);
    const status = run(root, ["spec", "status"]);
    assert.match(status.stdout, /Status: active/);
  });

  test("status warns when STATUS.md does not mention the active spec", () => {
    const root = specProject();
    assert.strictEqual(run(root, ["spec", "set", "001-user-auth"]).status, 0);
    const status = run(root, ["spec", "status"]);
    assert.strictEqual(status.status, 0);
    assert.match(status.stderr, /STATUS.md does not mention/);
  });

  test("status no warning when STATUS.md mentions the active spec", () => {
    const root = specProject();
    assert.strictEqual(run(root, ["spec", "set", "001-user-auth"]).status, 0);
    fs.mkdirSync(path.join(root, ".wolf"), { recursive: true });
    fs.writeFileSync(path.join(root, ".wolf", "STATUS.md"), "Active: 001-user-auth\n", "utf-8");
    const status = run(root, ["spec", "status"]);
    assert.doesNotMatch(status.stderr, /STATUS.md does not mention/);
  });
});
