import { test } from "node:test";
import assert from "node:assert/strict";
import {
  eventSignature,
  buildTrajectoryIndex,
  matchTrajectory,
} from "../src/hippocampus/trajectory.ts";

// Minimal WolfEvent-shaped objects. The pure functions only read
// action.type / outcome.valence / session_id / timestamp.
function makeEvent(
  id: string,
  session: string,
  timestamp: string,
  actionType: string,
  valence: string
) {
  return {
    id,
    version: 1,
    timestamp,
    session_id: session,
    context: {
      project_root: "/p",
      files_involved: [],
      cwd_at_time: "/p",
      spatial_path: "x.ts",
      spatial_depth: 0,
      session_start: timestamp,
      turn_in_session: 0,
    },
    action: { type: actionType, description: "", tokens_spent: 0 },
    outcome: { valence, intensity: 0.5, reflection: "" },
    consolidation: {
      stage: "short-term",
      access_count: 0,
      last_accessed: timestamp,
      consolidation_score: 0,
      should_consolidate: false,
      decay_factor: 1,
      last_decay_check: timestamp,
    },
    source: "manual",
    tags: [],
  };
}

test("eventSignature collapses an event to action:valence", () => {
  const e = makeEvent("1", "s1", "2026-01-01T00:00:00Z", "edit", "penalty");
  assert.strictEqual(eventSignature(e), "edit:penalty");
});

test("buildTrajectoryIndex prefers turn_in_session over later timestamp", () => {
  const laterFirst = makeEvent("1", "s1", "2026-01-01T00:00:02Z", "fix", "neutral");
  laterFirst.context.turn_in_session = 1;
  const earlierSecond = makeEvent("2", "s1", "2026-01-01T00:00:01Z", "edit", "penalty");
  earlierSecond.context.turn_in_session = 2;
  const index = buildTrajectoryIndex([laterFirst, earlierSecond]);
  assert.deepStrictEqual(index.get("s1"), ["fix:neutral", "edit:penalty"]);
});

test("buildTrajectoryIndex groups by session and orders by timestamp", () => {
  const a = makeEvent("1", "s1", "2026-01-01T00:00:02Z", "fix", "neutral");
  const b = makeEvent("2", "s1", "2026-01-01T00:00:01Z", "edit", "penalty");
  const c = makeEvent("3", "s2", "2026-01-01T00:00:01Z", "edit", "neutral");
  const index = buildTrajectoryIndex([a, b, c]);
  assert.deepStrictEqual(index.get("s1"), ["edit:penalty", "fix:neutral"]);
  assert.deepStrictEqual(index.get("s2"), ["edit:neutral"]);
});

test("matchTrajectory predicts the next signature from a historical suffix", () => {
  const history = buildTrajectoryIndex([
    makeEvent("1", "h1", "2026-01-01T00:00:01Z", "edit", "neutral"),
    makeEvent("2", "h1", "2026-01-01T00:00:02Z", "edit", "neutral"),
    makeEvent("3", "h1", "2026-01-01T00:00:03Z", "edit", "penalty"),
    makeEvent("4", "h1", "2026-01-01T00:00:04Z", "fix", "neutral"),
  ]);
  const pred = matchTrajectory(["edit:neutral", "edit:neutral"], history, 2);
  assert.strictEqual(pred.matched, true);
  assert.strictEqual(pred.next_signature, "edit:penalty");
  assert.strictEqual(pred.samples, 1);
  assert.strictEqual(pred.bad_ratio, 1);
});

test("matchTrajectory reports no match for an unseen suffix", () => {
  const history = buildTrajectoryIndex([
    makeEvent("1", "h1", "2026-01-01T00:00:01Z", "edit", "neutral"),
  ]);
  const pred = matchTrajectory(["fix:neutral", "edit:neutral"], history, 2);
  assert.strictEqual(pred.matched, false);
  assert.strictEqual(pred.samples, 0);
  assert.strictEqual(pred.next_signature, null);
});
