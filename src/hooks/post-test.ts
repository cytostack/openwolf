import * as path from "node:path";
import {
  getWolfDir, ensureWolfDir, readStdin, getProjectDir,
  extractTestFailures, normalizePath,
} from "./shared.js";
import { Hippocampus } from "../hippocampus/index.js";

const TEST_COMMAND_RE = /(?:^|[\s&|;])(?:pnpm|npm|yarn|bun|npx|python|pytest|go|deno|node)\s+(?:run\s+)?(?:test|jest|vitest|ava|mocha|karma|cypress|playwright|spec|check)\b/i;
const TEST_FLAG_RE = /(?:--test|--tests|test:|\btest\b)/i;

/**
 * PostToolUse hook for test commands: when the tool output contains failure
 * markers (FAIL, Error:, AssertionError...), record a penalty event carrying
 * the failing test signature. This is the strongest observable "agent was
 * wrong" signal: tests are the ground truth for code correctness.
 */
async function main(): Promise<void> {
  ensureWolfDir();
  const raw = await readStdin();
  let input: {
    tool_name?: string;
    tool_input?: { command?: string; cmd?: string };
    tool_response?: { output?: string };
    tool_result?: { output?: string; content?: string };
  };
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0);
    return;
  }

  const toolName = (input.tool_name ?? "").toLowerCase();
  const command = input.tool_input?.command ?? input.tool_input?.cmd ?? "";
  const isTestTool =
    toolName.includes("test") ||
    toolName.includes("shell") ||
    toolName.includes("exec") ||
    toolName.includes("bash") ||
    toolName.includes("cmd") ||
    toolName.includes("run") ||
    toolName.includes("tool") ||
    TEST_COMMAND_RE.test(command) ||
    TEST_FLAG_RE.test(command);
  if (!isTestTool) {
    process.exit(0);
    return;
  }

  const output =
    input.tool_response?.output ??
    input.tool_result?.output ??
    (typeof input.tool_result?.content === "string" ? input.tool_result.content : "") ??
    "";
  const failures = extractTestFailures(output);
  if (!failures) {
    process.exit(0);
    return;
  }

  const projectRoot = getProjectDir();
  const now = new Date().toISOString();
  const wolfDir = getWolfDir();

  try {
    const hippocampus = new Hippocampus(projectRoot);
    const signature = failures[0].slice(0, 200);
    hippocampus.addEvent({
      version: 1,
      timestamp: now,
      session_id: process.env.CLAUDE_SESSION_ID || "unknown",
      context: {
        project_root: projectRoot,
        files_involved: [],
        cwd_at_time: projectRoot,
        spatial_path: "./",
        spatial_depth: 0,
        session_start: process.env.CLAUDE_SESSION_START || now,
        turn_in_session: 0,
        current_goal: undefined,
        recent_errors: failures.slice(0, 3),
      },
      action: {
        type: "execute",
        subtype: "test-failure",
        description: `Tests failed: ${command.slice(0, 100) || "test command"}`,
        tokens_spent: 0,
        succeeded: false,
        error_message: signature,
      },
      outcome: {
        valence: "penalty",
        intensity: 0.8,
        reflection: `Test failure: ${signature}`,
      },
      source: "hook",
      tags: ["test-failure", "penalty", "verify"],
    });
    process.stderr.write(`OpenWolf hippocampus: recorded test failure: ${signature}\n`);
  } catch (error) {
    // Fail silently - hippocampus should not break the agent loop.
    process.stderr.write(`OpenWolf hippocampus: test hook skipped (${String(error)})\n`);
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
