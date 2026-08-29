// Spec-driven development (SDD) state model for OpenWolf.
// One durable row per project: which spec is active, what phase it is in,
// which numbered task is current, and whether the work is active/paused/
// blocked/complete. "complete" lives only in `status` — the terminal state —
// so it never collides with the phase axis.

export type SpecPhase = "specify" | "plan" | "tasks" | "implement";

export type SpecStatus = "active" | "paused" | "blocked" | "complete";

export interface SpecState {
  version: 1;
  /** Spec directory id under specs/, e.g. "001-user-auth", or null if none. */
  activeSpec: string | null;
  phase: SpecPhase;
  /** Numbered task id (e.g. "T042") during the implement phase, else null. */
  currentTask: string | null;
  status: SpecStatus;
  updatedAt: string;
}

export const SPEC_PHASES: SpecPhase[] = ["specify", "plan", "tasks", "implement"];
export const SPEC_STATUSES: SpecStatus[] = ["active", "paused", "blocked", "complete"];

export function createEmptySpecState(now?: string): SpecState {
  return {
    version: 1,
    activeSpec: null,
    phase: "specify",
    currentTask: null,
    status: "active",
    updatedAt: now ?? new Date().toISOString(),
  };
}

export function isSpecPhase(v: unknown): v is SpecPhase {
  return typeof v === "string" && (SPEC_PHASES as string[]).includes(v);
}

export function isSpecStatus(v: unknown): v is SpecStatus {
  return typeof v === "string" && (SPEC_STATUSES as string[]).includes(v);
}
