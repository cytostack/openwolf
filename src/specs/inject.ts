import type { SpecState } from "./types.js";

/**
 * One-line context injected on file read so the agent keeps the active spec,
 * phase, and current task in view. Empty when no spec is active.
 */
export function buildSpecContext(state: SpecState): string {
  if (!state.activeSpec) return "";
  let line = `📋 OpenWolf spec: ${state.activeSpec} · phase ${state.phase}`;
  if (state.currentTask) line += ` · task ${state.currentTask}`;
  return line + "\n";
}

/**
 * TDD discipline reminder injected before writes. Only fires while the spec is
 * active and in a phase where test-first applies.
 */
export function buildTddReminder(state: SpecState): string {
  if (state.status !== "active") return "";
  if (state.phase === "tasks") {
    return "🧪 OpenWolf TDD: define failing tests (T100-T199) before any implementation task.\n";
  }
  if (state.phase === "implement") {
    return "🧪 OpenWolf TDD: red → green → refactor — make the failing test pass with minimal code.\n";
  }
  return "";
}
