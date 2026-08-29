import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import { findProjectRoot } from "../scanner/project-root.js";
import { loadSpecState, saveSpecState } from "../specs/spec-store.js";
import { advancePhase, setStatus } from "../specs/phase-machine.js";
import { nextTask } from "../specs/tasks-parse.js";
import type { SpecPhase, SpecStatus } from "../specs/types.js";

// `openwolf spec` — the sole writer of .wolf/specs-state.json. The /specify,
// /plan, /tasks, /implement skills write artifacts and call these commands to
// advance durable state; they never edit the JSON by hand.

function resolveWolf(): { projectRoot: string; wolfDir: string } {
  const projectRoot = findProjectRoot();
  return { projectRoot, wolfDir: path.join(projectRoot, ".wolf") };
}

const STATUS_ALIASES: Array<[string, SpecStatus]> = [
  ["pause", "paused"],
  ["resume", "active"],
  ["block", "blocked"],
  ["complete", "complete"],
];

export function createSpecCommand(): Command {
  const spec = new Command("spec").description("Spec-driven development (SDD) state");

  spec
    .command("status")
    .description("Show the active spec, phase, and current task")
    .action(() => {
      const { wolfDir } = resolveWolf();
      const state = loadSpecState(wolfDir);
      if (!state.activeSpec) {
        console.log("No active spec. Run: openwolf spec set <id>");
        return;
      }
      console.log(`Active spec: ${state.activeSpec}`);
      console.log(`Phase: ${state.phase}`);
      console.log(`Task: ${state.currentTask ?? "(none)"}`);
      console.log(`Status: ${state.status}`);
      console.log(`Updated: ${state.updatedAt}`);
    });

  spec
    .command("list")
    .description("List specs under specs/ and mark the active one")
    .action(() => {
      const { projectRoot, wolfDir } = resolveWolf();
      const state = loadSpecState(wolfDir);
      const specsDir = path.join(projectRoot, "specs");
      if (!fs.existsSync(specsDir)) {
        console.log("No specs directory yet. Run /specify first.");
        return;
      }
      const names = fs
        .readdirSync(specsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && fs.existsSync(path.join(specsDir, e.name, "spec.md")))
        .map((e) => e.name)
        .sort();
      if (names.length === 0) {
        console.log("No specs. Run /specify first.");
        return;
      }
      for (const name of names) {
        const mark = name === state.activeSpec ? " * active" : "";
        console.log(`  ${name}${mark}`);
      }
    });

  spec
    .command("set <id>")
    .description("Set the active spec (validates specs/<id>/spec.md exists)")
    .action((id: string) => {
      const { projectRoot, wolfDir } = resolveWolf();
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) || id.includes("..")) {
        console.error(`Invalid spec id "${id}". Use a slug like "001-user-auth".`);
        process.exit(1);
      }
      if (!fs.existsSync(path.join(projectRoot, "specs", id, "spec.md"))) {
        console.error(`No spec at specs/${id}/spec.md. Run /specify first.`);
        process.exit(1);
      }
      const state = loadSpecState(wolfDir);
      const switching = state.activeSpec !== id;
      state.activeSpec = id;
      if (switching) {
        // Re-activating a DIFFERENT spec starts at the top; re-activating the
        // SAME spec is idempotent and keeps its phase + current task.
        state.phase = "specify";
        state.currentTask = null;
      }
      state.status = "active";
      state.updatedAt = new Date().toISOString();
      saveSpecState(wolfDir, state);
      console.log(`Active spec: ${id}`);
    });

  spec
    .command("phase <p>")
    .description("Advance the spec phase: specify | plan | tasks | implement")
    .action((p: string) => {
      const { wolfDir } = resolveWolf();
      const state = loadSpecState(wolfDir);
      try {
        const next = advancePhase(state, p as SpecPhase);
        saveSpecState(wolfDir, next);
        console.log(`Phase: ${next.phase}`);
      } catch (err) {
        console.error((err as Error).message);
        process.exit(1);
      }
    });

  spec
    .command("next")
    .description("Advance the current task to the next unchecked task in tasks.md")
    .action(() => {
      const { projectRoot, wolfDir } = resolveWolf();
      const state = loadSpecState(wolfDir);
      if (!state.activeSpec) {
        console.error("No active spec. Run: openwolf spec set <id>");
        process.exit(1);
      }
      const tasksPath = path.join(projectRoot, "specs", state.activeSpec, "tasks.md");
      if (!fs.existsSync(tasksPath)) {
        console.error(`No tasks.md at specs/${state.activeSpec}/tasks.md. Run /tasks first.`);
        process.exit(1);
      }
      const task = nextTask(fs.readFileSync(tasksPath, "utf-8"));
      if (!task) {
        if (state.status === "complete") {
          console.log("Spec already complete.");
        } else if (state.status === "active") {
          const done = setStatus(state, "complete");
          saveSpecState(wolfDir, done);
          console.log("All tasks checked. Status: complete");
        } else {
          console.log(`All tasks checked (status: ${state.status}). Resume then complete.`);
        }
        return;
      }
      state.currentTask = task;
      state.updatedAt = new Date().toISOString();
      saveSpecState(wolfDir, state);
      console.log(`Task: ${task}`);
    });

  for (const [name, status] of STATUS_ALIASES) {
    spec
      .command(name)
      .description(`Mark the spec ${status}`)
      .action(() => {
        const { wolfDir } = resolveWolf();
        const state = loadSpecState(wolfDir);
        try {
          const next = setStatus(state, status);
          saveSpecState(wolfDir, next);
          console.log(`Status: ${next.status}`);
        } catch (err) {
          console.error((err as Error).message);
          process.exit(1);
        }
      });
  }

  return spec;
}
