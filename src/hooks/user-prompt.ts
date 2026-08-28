import * as path from "node:path";
import {
  getWolfDir, ensureWolfDir, readStdin, getProjectDir,
  detectCorrection, normalizePath,
} from "./shared.js";
import { Hippocampus } from "../hippocampus/index.js";

/**
 * UserPromptSubmit hook: turn an explicit user correction into a durable
 * penalty event. This is the *real* "agent got it wrong" signal ??much
 * stronger than the edit-count heuristic. The recurrence counter then has a
 * meaningful numerator: a later fix-shaped edit matching this penalty path.
 *
 * Claude Code payload: { prompt, tool_name, tool_input, hook_event_name }
 */
async function main(): Promise<void> {
  ensureWolfDir();
  const raw = await readStdin();
  let input: { prompt?: string; tool_input?: { prompt?: string; message?: string } };
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0);
    return;
  }

  const promptText =
    input.prompt ?? input.tool_input?.prompt ?? input.tool_input?.message ?? "";
  const signal = detectCorrection(promptText);
  if (!signal) {
    process.exit(0);
    return;
  }

  const projectRoot = getProjectDir();
  const now = new Date().toISOString();
  const filesInvolved = signal.path ? [normalizePath(signal.path)] : [];
  const wolfDir = getWolfDir();

  try {
    const hippocampus = new Hippocampus(projectRoot);
    hippocampus.addEvent({
      version: 1,
      timestamp: now,
      session_id: process.env.CLAUDE_SESSION_ID || "unknown",
      context: {
        project_root: projectRoot,
        files_involved: filesInvolved,
        cwd_at_time: projectRoot,
        spatial_path: filesInvolved.length > 0
          ? (path.dirname(filesInvolved[0]).replace(/\\/g, "/") || "./")
          : "./",
        spatial_depth: filesInvolved.length > 0 ? filesInvolved[0].split("/").length - 1 : 0,
        session_start: process.env.CLAUDE_SESSION_START || now,
        turn_in_session: 0,
        current_goal: undefined,
      },
      action: {
        type: "correct",
        subtype: "user-correction",
        description: `User corrected: ${signal.message.slice(0, 120)}`,
        tokens_spent: 0,
        files_modified: filesInvolved.length > 0 ? filesInvolved : undefined,
        succeeded: false,
        error_message: signal.error,
      },
      outcome: {
        valence: "penalty",
        intensity: 0.7,
        reflection: `User correction${signal.path ? ` in ${signal.path}` : ""}: ${signal.message.slice(0, 160)}`,
        is_recurring: false,
      },
      source: "hook",
      tags: ["user-correction", "penalty"],
    });
    process.stderr.write(`OpenWolf hippocampus: recorded user correction${signal.path ? ` for ${signal.path}` : ""}.\n`);
  } catch (error) {
    // Fail silently - hippocampus should not break the agent loop.
    process.stderr.write(`OpenWolf hippocampus: correction hook skipped (${String(error)})\n`);
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
