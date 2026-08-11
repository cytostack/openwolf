// OpenWolf CLI — Recall Command
// Phase 2: Query hippocampus for events matching a cue

import { Command } from "commander";
import * as path from "path";
import { Hippocampus, RecallRequest } from "../hippocampus/index.js";
import { LocationCue, QuestionCue, StateCue } from "../hippocampus/types.js";

export function recallCommand(query: string, opts: {
  type?: string;
  limit?: number;
  json?: boolean;
  matchMode?: string;
  error?: string;
}): void {
  const projectRoot = process.cwd();
  const hippocampus = new Hippocampus(projectRoot);

  if (!hippocampus.exists()) {
    console.error("Error: hippocampus.json not found. Run 'openwolf init' first.");
    process.exit(1);
  }

  // Build the cue based on type
  const cue = buildCue(opts.type || "location", query, opts);

  // Build recall request
  const request: RecallRequest = {
    cue,
    limit: opts.limit || 5,
  };

  // Execute recall
  let response;
  try {
    response = hippocampus.recall(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: hippocampus recall failed: ${message}`);
    process.exitCode = 1;
    return;
  }

  // Output results
  if (opts.json) {
    console.log(JSON.stringify(response, null, 2));
  } else {
    printTextOutput(response, cue);
  }
}

function buildCue(
  type: string,
  query: string,
  opts: { matchMode?: string; error?: string }
): LocationCue | QuestionCue | StateCue {
  switch (type) {
    case "location":
      return {
        type: "location",
        path: query,
        match_mode: (opts.matchMode as LocationCue["match_mode"]) || "exact",
      } as LocationCue;

    case "question":
      return {
        type: "question",
        query,
      } as QuestionCue;

    case "state":
      const stateCue: StateCue = {
        type: "state",
        turn_count: 0,
      };
      if (opts.error) {
        stateCue.error = {
          type: opts.error.split(":")[0] || opts.error,
          message: opts.error,
        };
      }
      return stateCue;

    default:
      console.error(`Error: Unknown cue type '${type}'. Use: location, question, or state`);
      process.exit(1);
  }
}

function printTextOutput(
  response: { events: any[]; total_matches: number; confidence: number; match_details: any[] },
  cue: LocationCue | QuestionCue | StateCue
): void {
  if (response.events.length === 0) {
    console.log("No events found.");
    return;
  }

  console.log(`Found ${response.total_matches} matching event(s) (avg confidence: ${(response.confidence * 100).toFixed(0)}%)`);
  console.log();

  response.events.forEach((event, i) => {
    const detail = response.match_details[i];
    const valence = event.outcome.valence;
    const intensity = event.outcome.intensity;
    const reflection = event.outcome.reflection || "(no reflection)";
    const timestamp = formatRelativeTime(event.timestamp);
    const files = event.context.files_involved.join(", ");

    console.log(`${i + 1}. [${valence} ${intensity.toFixed(1)}] ${files}`);
    console.log(`   "${reflection}" (${timestamp})`);
    if (detail.match_reasons.length > 0) {
      console.log(`   Match: ${detail.match_reasons.join(", ")}`);
    }
    console.log();
  });
}

function formatRelativeTime(timestamp: string): string {
  const ms = Date.now() - new Date(timestamp).getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor(ms / (1000 * 60));

  if (days > 0) return `${days} day${days > 1 ? "s" : ""} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
  return "just now";
}

export function createRecallCommand(): Command {
  const recall = new Command();

  recall
    .name("recall")
    .description("Recall events from hippocampus memory")
    .argument("<query>", "The search query (file path for location, text for question)")
    .option("--type <type>", "Cue type: location, question, state", "location")
    .option("--limit <n>", "Maximum number of events to return", (n) => parseInt(n, 10), 5)
    .option("--json", "Output as JSON", false)
    .option("--match-mode <mode>", "Location match mode: exact, prefix, glob, parent, sibling", "exact")
    .option("--error <msg>", "Error message for state cue")
    .action(async (query: string, opts: any) => {
      recallCommand(query, opts);
    });

  return recall;
}
