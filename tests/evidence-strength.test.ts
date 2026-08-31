import { test } from "node:test";
import assert from "node:assert/strict";
import { EVIDENCE_WEIGHTS, evidenceStrength } from "../dist/hooks/hippocampus/claims.js";
import type { ClaimEvidence, EvidenceQuality } from "../src/hippocampus/types.ts";

function evidence(quality: EvidenceQuality, authority: number): ClaimEvidence {
  return {
    event_id: "evt-1",
    relation: "confirms",
    quality,
    verification_method: quality,
    provenance: { source: "manual", authority, event_id: "evt-1" },
    recorded_at: "2026-01-01T00:00:00Z",
  };
}

test("EVIDENCE_WEIGHTS is a strictly decreasing kebab-case ladder", () => {
  const keys = Object.keys(EVIDENCE_WEIGHTS) as EvidenceQuality[];
  assert.deepStrictEqual(keys, [
    "automated-test",
    "reproducible-observation",
    "direct-tool-result",
    "explicit-user-correction",
    "verified-code-inspection",
    "agent-inference",
    "unverified-assumption",
  ]);
  for (let i = 1; i < keys.length; i++) {
    assert.ok(
      EVIDENCE_WEIGHTS[keys[i - 1]] > EVIDENCE_WEIGHTS[keys[i]],
      `${keys[i - 1]} must outrank ${keys[i]}`
    );
  }
});

test("evidenceStrength = weight × authority (same authority: higher quality wins)", () => {
  assert.strictEqual(
    evidenceStrength(evidence("automated-test", 0.8)),
    EVIDENCE_WEIGHTS["automated-test"] * 0.8
  );
  assert.ok(
    evidenceStrength(evidence("automated-test", 0.5)) >
      evidenceStrength(evidence("agent-inference", 0.5)),
    "automated-test outranks agent-inference at equal authority"
  );
});

test("evidenceStrength: authority can flip the ordering", () => {
  const hi = evidenceStrength(evidence("agent-inference", 1.0)); // 0.35
  const lo = evidenceStrength(evidence("automated-test", 0.3)); // 0.3
  assert.ok(hi > lo, "inference×1.0 beats test×0.3");
});
