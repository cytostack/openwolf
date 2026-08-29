import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { createEmptySpecState, isSpecPhase, isSpecStatus } from "./types.js";
import type { SpecState } from "./types.js";

// Self-contained on purpose: this module is compiled into both the main build
// (dist/src/specs) and the standalone hooks build (dist/hooks/specs), and the
// hooks build only includes src/hooks + src/hippocampus + src/specs. Importing
// src/utils would break the hooks build, so file IO is inlined here.

export function getSpecStatePath(wolfDir: string): string {
  return path.join(wolfDir, "specs-state.json");
}

/** Load the durable spec state; default when missing, backup-then-default on corrupt. */
export function loadSpecState(wolfDir: string, now?: string): SpecState {
  const p = getSpecStatePath(wolfDir);
  if (!fs.existsSync(p)) return createEmptySpecState(now);
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf-8")) as Partial<SpecState>;
    return normalizeState(parsed, now);
  } catch {
    const bak = `${p}.corrupt-${Date.now()}`;
    try {
      fs.copyFileSync(p, bak);
    } catch {}
    return createEmptySpecState(now);
  }
}

function normalizeState(parsed: Partial<SpecState>, now?: string): SpecState {
  const base = createEmptySpecState(now);
  return {
    version: 1,
    activeSpec:
      typeof parsed.activeSpec === "string" && parsed.activeSpec ? parsed.activeSpec : null,
    phase: isSpecPhase(parsed.phase) ? parsed.phase : base.phase,
    currentTask:
      typeof parsed.currentTask === "string" && parsed.currentTask ? parsed.currentTask : null,
    status: isSpecStatus(parsed.status) ? parsed.status : base.status,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : base.updatedAt,
  };
}

/** Atomic sibling-temp write (same protocol as utils/fs-safe.writeJSON). */
export function saveSpecState(wolfDir: string, state: SpecState): void {
  const p = getSpecStatePath(wolfDir);
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${p}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
    fs.renameSync(tmp, p);
  } catch {
    // Windows rename can fail on an open handle; fall back to direct write.
    try {
      fs.writeFileSync(p, JSON.stringify(state, null, 2), "utf-8");
    } catch {}
    try {
      fs.unlinkSync(tmp);
    } catch {}
  }
}
