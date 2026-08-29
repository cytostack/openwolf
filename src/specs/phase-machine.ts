import type { SpecPhase, SpecState, SpecStatus } from "./types.js";

// Allowed phase transitions. Forward is one step at a time; `implement → tasks`
// re-opens task planning when the breakdown was wrong. Same-value and skipped
// transitions are rejected.
const PHASE_TRANSITIONS: Record<SpecPhase, SpecPhase[]> = {
  specify: ["plan"],
  plan: ["tasks"],
  tasks: ["implement"],
  implement: ["tasks"],
};

// Goal-persistence style status machine (usage/budget dropped — long-term
// state lives in STATUS.md, this is just the work pointer). `complete` is
// terminal.
const STATUS_TRANSITIONS: Record<SpecStatus, SpecStatus[]> = {
  active: ["paused", "blocked", "complete"],
  paused: ["active"],
  blocked: ["active"],
  complete: [],
};

export function advancePhase(state: SpecState, target: SpecPhase, now?: string): SpecState {
  if (!PHASE_TRANSITIONS[state.phase].includes(target)) {
    throw new Error(`Illegal phase transition: ${state.phase} → ${target}`);
  }
  return { ...state, phase: target, updatedAt: now ?? new Date().toISOString() };
}

export function setStatus(state: SpecState, status: SpecStatus, now?: string): SpecState {
  if (!STATUS_TRANSITIONS[state.status].includes(status)) {
    throw new Error(`Illegal status transition: ${state.status} → ${status}`);
  }
  return { ...state, status, updatedAt: now ?? new Date().toISOString() };
}
