import { describe, test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { Hippocampus } from "../dist/hooks/hippocampus/index.js";
import {
  buildClaimIndex,
  claimIndexNeedsRebuild,
  loadClaimIndex,
} from "../dist/hooks/hippocampus/claim-index.js";
import { loadClaimStore } from "../dist/hooks/hippocampus/claim-store.js";
import { loadClaimCandidateStore } from "../dist/hooks/hippocampus/claim-candidate-store.js";
import type {
  ClaimObservation,
  ClaimScope,
  EvidenceQuality,
  MemoryClaim,
  WolfEvent,
} from "../src/hippocampus/types.ts";

const tmpProject = () => fs.mkdtempSync(path.join(os.tmpdir(), "wolf-claims-"));
const hippoUrl = pathToFileURL(
  path.resolve(import.meta.dirname, "../dist/hooks/hippocampus/index.js")
).href;
const cliPath = path.resolve(import.meta.dirname, "../dist/bin/openwolf.js");

function eventData(
  projectRoot: string,
  label: string
): Omit<WolfEvent, "id" | "consolidation"> {
  const now = new Date().toISOString();
  return {
    version: 1,
    timestamp: now,
    session_id: `claim-test-${label}`,
    context: {
      project_root: projectRoot,
      files_involved: [`src/${label}.ts`],
      cwd_at_time: projectRoot,
      spatial_path: "src",
      spatial_depth: 1,
      session_start: now,
      turn_in_session: 1,
    },
    action: {
      type: "discover",
      description: label,
      tokens_spent: 1,
      files_modified: [`src/${label}.ts`],
      succeeded: true,
    },
    outcome: {
      valence: "neutral",
      intensity: 0.2,
      reflection: label,
    },
    source: "manual",
    tags: ["claim-test"],
  };
}

function observation(
  statement: string,
  eventId: string,
  quality: EvidenceQuality,
  overrides: Partial<ClaimObservation> = {}
): ClaimObservation {
  return {
    statement,
    event_id: eventId,
    relation: "confirms",
    quality,
    verification_method: quality,
    provenance: {
      source: "manual",
      authority: 1,
      label: "claim test",
    },
    ...overrides,
  };
}

function runChild(script: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
      stdio: "ignore",
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

function claimWriterScript(projectRoot: string, eventId: string, index: number): string {
  return `
    const { Hippocampus } = await import(${JSON.stringify(hippoUrl)});
    new Hippocampus(${JSON.stringify(projectRoot)}).recordClaimObservation({
      statement: "Concurrent claim identity",
      event_id: ${JSON.stringify(eventId)},
      relation: "confirms",
      quality: "direct-tool-result",
      verification_method: "direct-tool-result",
      provenance: { source: "manual", authority: 1, label: "writer-${index}" }
    });
  `;
}

function assertClaimLinks(claim: MemoryClaim, evidenceId: string): void {
  assert.ok(claim.evidence_event_ids.includes(evidenceId));
  assert.ok(claim.evidence.some((item) => item.provenance.event_id === evidenceId));
}

describe("hippocampus truth maintenance", () => {
  test("reinforces deterministic statement and scope identity without duplicate claims", () => {
    const root = tmpProject();
    const hippo = new Hippocampus(root);
    const first = hippo.addEvent(eventData(root, "first"));
    const second = hippo.addEvent(eventData(root, "second"));
    const scope: ClaimScope = { paths: ["src\\feature.ts"], platforms: ["WINDOWS"] };

    const created = hippo.recordClaimObservation(observation(
      "Use Atomic Writes!",
      first.id,
      "verified-code-inspection",
      { scope }
    ));
    const reinforced = hippo.recordClaimObservation(observation(
      " use atomic writes ",
      second.id,
      "direct-tool-result",
      { scope: { paths: ["src/feature.ts"], platforms: ["windows"] } }
    ));

    assert.strictEqual(created.kind, "created");
    assert.strictEqual(reinforced.kind, "reinforced");
    assert.strictEqual(created.claim.id, reinforced.claim.id);
    assert.strictEqual(hippo.getClaims().length, 1);
    assert.deepStrictEqual(new Set(reinforced.claim.evidence_event_ids), new Set([first.id, second.id]));
  });

  test("verified correction supersedes weak original while preserving both events and provenance", () => {
    const root = tmpProject();
    const hippo = new Hippocampus(root);
    const originalEvent = hippo.addEvent(eventData(root, "old-belief"));
    const correctionEvent = hippo.addEvent(eventData(root, "verified-correction"));
    const original = hippo.recordClaimObservation(observation(
      "The retry limit is three",
      originalEvent.id,
      "unverified-assumption"
    )).claim;

    const result = hippo.recordClaimObservation(observation(
      "The retry limit is five",
      correctionEvent.id,
      "automated-test",
      { relation: "contradicts", target_claim_id: original.id }
    ));
    const claims = hippo.getClaims();
    const persistedOriginal = claims.find((claim) => claim.id === original.id)!;
    const correction = claims.find((claim) => claim.id === result.claim.id)!;

    assert.strictEqual(persistedOriginal.status, "superseded");
    assert.strictEqual(persistedOriginal.superseded_by, correction.id);
    assert.strictEqual(correction.status, "active");
    assert.deepStrictEqual(correction.contradicts_claim_ids, [original.id]);
    assertClaimLinks(persistedOriginal, originalEvent.id);
    assert.ok(persistedOriginal.contradicting_event_ids.includes(correctionEvent.id));
    assertClaimLinks(correction, correctionEvent.id);
    assert.ok(hippo.getEvents().some((event) => event.id === originalEvent.id));
    assert.ok(hippo.getEvents().some((event) => event.id === correctionEvent.id));
  });

  test("newer agent inference cannot override an automated-test-backed fact", () => {
    const root = tmpProject();
    const hippo = new Hippocampus(root);
    const verifiedEvent = hippo.addEvent(eventData(root, "verified"));
    const guessEvent = hippo.addEvent(eventData(root, "guess"));
    const verified = hippo.recordClaimObservation(observation(
      "The lock is a directory",
      verifiedEvent.id,
      "automated-test"
    )).claim;

    const guess = hippo.recordClaimObservation(observation(
      "The lock is a regular file",
      guessEvent.id,
      "agent-inference",
      {
        relation: "contradicts",
        target_claim_id: verified.id,
        provenance: { source: "agent", authority: 1, label: "new guess" },
      }
    )).claim;
    const current = hippo.getClaims();

    assert.strictEqual(current.find((claim) => claim.id === verified.id)?.status, "active");
    assert.strictEqual(current.find((claim) => claim.id === guess.id)?.status, "disputed");
    assert.deepStrictEqual(
      hippo.recallClaims({ query: "lock directory" }).claims.map((claim) => claim.id),
      [verified.id]
    );
  });

  test("near-equal contradiction disputes both claims and active-only recall excludes them", () => {
    const root = tmpProject();
    const hippo = new Hippocampus(root);
    const firstEvent = hippo.addEvent(eventData(root, "option-a"));
    const secondEvent = hippo.addEvent(eventData(root, "option-b"));
    const first = hippo.recordClaimObservation(observation(
      "Use option alpha",
      firstEvent.id,
      "direct-tool-result"
    )).claim;
    const second = hippo.recordClaimObservation(observation(
      "Use option beta",
      secondEvent.id,
      "direct-tool-result",
      { relation: "contradicts", target_claim_id: first.id }
    )).claim;

    assert.deepStrictEqual(
      new Set(hippo.getClaims().map((claim) => claim.status)),
      new Set(["disputed"])
    );
    assert.strictEqual(hippo.recallClaims({ query: "option" }).total_matches, 0);
    assert.deepStrictEqual(
      new Set(hippo.recallClaims({ query: "option", include_disputed: true }).claims.map((claim) => claim.id)),
      new Set([first.id, second.id])
    );
  });

  test("refinement creates a scoped claim without rewriting its broader source", () => {
    const root = tmpProject();
    const hippo = new Hippocampus(root);
    const broadEvent = hippo.addEvent(eventData(root, "broad"));
    const scopedEvent = hippo.addEvent(eventData(root, "scoped"));
    const broad = hippo.recordClaimObservation(observation(
      "Use directory locks",
      broadEvent.id,
      "verified-code-inspection"
    )).claim;
    const refined = hippo.recordClaimObservation(observation(
      "Use directory locks for Windows filesystem mutations",
      scopedEvent.id,
      "reproducible-observation",
      {
        relation: "refines",
        target_claim_id: broad.id,
        scope: { paths: ["src/hippocampus"], platforms: ["windows"] },
      }
    )).claim;

    assert.strictEqual(refined.refined_from, broad.id);
    assert.strictEqual(hippo.getClaims().find((claim) => claim.id === broad.id)?.statement, "Use directory locks");
    assert.deepStrictEqual(
      hippo.recallClaims({ paths: ["src/hippocampus/index.ts"], platforms: ["windows"] }).claims.map((claim) => claim.id),
      [refined.id, broad.id]
    );
    assert.deepStrictEqual(
      hippo.recallClaims({ paths: ["docs/readme.md"], platforms: ["linux"] }).claims.map((claim) => claim.id),
      [broad.id]
    );
  });

  test("recall exposes evidence, provenance, and optional superseded history", () => {
    const root = tmpProject();
    const hippo = new Hippocampus(root);
    const oldEvent = hippo.addEvent(eventData(root, "old"));
    const newEvent = hippo.addEvent(eventData(root, "new"));
    const oldClaim = hippo.recordClaimObservation(observation(
      "The mode is old",
      oldEvent.id,
      "unverified-assumption"
    )).claim;
    const correction = hippo.recordClaimObservation(observation(
      "The mode is new",
      newEvent.id,
      "explicit-user-correction",
      {
        relation: "contradicts",
        target_claim_id: oldClaim.id,
        provenance: { source: "user", authority: 1, label: "operator correction" },
      }
    )).claim;

    const active = hippo.recallClaims({ query: "mode" });
    assert.deepStrictEqual(active.claims.map((claim) => claim.id), [correction.id]);
    assert.strictEqual(active.claims[0].evidence[0].provenance.source, "user");
    assert.strictEqual(active.match_details[0].claim_id, correction.id);
    assert.ok(active.match_details[0].evidence_strength > 0);

    const history = hippo.recallClaims({ query: "mode", include_superseded: true });
    assert.deepStrictEqual(new Set(history.claims.map((claim) => claim.id)), new Set([oldClaim.id, correction.id]));
  });

  test("repairs malformed and stale claim indexes from the authoritative claim store", () => {
    const root = tmpProject();
    const hippo = new Hippocampus(root);
    const event = hippo.addEvent(eventData(root, "index"));
    const claim = hippo.recordClaimObservation(observation(
      "Index repair works",
      event.id,
      "automated-test"
    )).claim;
    const indexPath = path.join(root, ".wolf", "claim-index.json");
    fs.writeFileSync(indexPath, JSON.stringify({ version: 1, last_updated: "invalid" }), "utf-8");

    assert.deepStrictEqual(new Hippocampus(root).recallClaims({ query: "repair" }).claims.map((item) => item.id), [claim.id]);
    const repaired = loadClaimIndex(indexPath);
    assert.ok(repaired);
    assert.strictEqual(claimIndexNeedsRebuild(repaired, new Hippocampus(root).getClaims()), false);
    assert.ok(fs.readdirSync(path.dirname(indexPath)).some((file) => /^claim-index\.corrupt-.*\.json$/.test(file)));

    const stale = buildClaimIndex([]);
    fs.writeFileSync(indexPath, JSON.stringify(stale), "utf-8");
    new Hippocampus(root).recallClaims({ query: "repair" });
    assert.deepStrictEqual(loadClaimIndex(indexPath)?.claim_ids, [claim.id]);
  });

  test("backs up a corrupt claim store and starts a valid empty projection", () => {
    const root = tmpProject();
    const wolfDir = path.join(root, ".wolf");
    fs.mkdirSync(wolfDir, { recursive: true });
    fs.writeFileSync(path.join(wolfDir, "claims.json"), "{broken-claims", "utf-8");

    assert.deepStrictEqual(new Hippocampus(root).recallClaims({}), {
      claims: [],
      total_matches: 0,
      match_details: [],
    });
    assert.ok(loadClaimStore(path.join(wolfDir, "claims.json")));
    assert.ok(fs.readdirSync(wolfDir).some((file) => /^claims\.corrupt-.*\.json$/.test(file)));
  });

  test("missing evidence fails closed without partial claim persistence", () => {
    const root = tmpProject();
    const hippo = new Hippocampus(root);
    assert.throws(
      () => hippo.recordClaimObservation(observation(
        "Unsupported claim",
        "evt-missing",
        "direct-tool-result"
      )),
      /Evidence event not found/
    );
    assert.strictEqual(hippo.claimsExist(), false);
    assert.strictEqual(fs.existsSync(path.join(root, ".wolf", "claim-index.json")), false);
  });

  test("concurrent claim writers preserve independent evidence on one identity", async () => {
    const root = tmpProject();
    const hippo = new Hippocampus(root);
    const events = Array.from({ length: 6 }, (_, index) => hippo.addEvent(eventData(root, `writer-${index}`)));
    const codes = await Promise.all(
      events.map((event, index) => runChild(claimWriterScript(root, event.id, index)))
    );

    assert.deepStrictEqual(codes, Array(6).fill(0));
    const claims = new Hippocampus(root).getClaims();
    assert.strictEqual(claims.length, 1);
    assert.deepStrictEqual(new Set(claims[0].evidence_event_ids), new Set(events.map((event) => event.id)));
    assert.strictEqual(loadClaimIndex(path.join(root, ".wolf", "claim-index.json"))?.claim_ids.length, 1);
  });

  test("claim CLI records JSON, recalls provenance, and rejects sensitive scope", () => {
    const root = tmpProject();
    const event = new Hippocampus(root).addEvent(eventData(root, "cli"));
    const record = spawnSync(process.execPath, [
      cliPath,
      "claim",
      "record",
      "CLI claim works",
      "--event",
      event.id,
      "--quality",
      "direct-tool-result",
      "--verification",
      "direct-tool-result",
      "--source",
      "manual",
      "--json",
    ], { cwd: root, encoding: "utf-8" });
    assert.strictEqual(record.status, 0, record.stderr);
    const report = JSON.parse(record.stdout) as { claim: MemoryClaim };
    assert.strictEqual(report.claim.statement, "CLI claim works");

    const recall = spawnSync(process.execPath, [
      cliPath,
      "claim",
      "recall",
      "CLI works",
      "--json",
    ], { cwd: root, encoding: "utf-8" });
    assert.strictEqual(recall.status, 0, recall.stderr);
    const response = JSON.parse(recall.stdout) as { claims: MemoryClaim[] };
    assert.strictEqual(response.claims[0].evidence[0].provenance.source, "manual");

    const sensitive = spawnSync(process.execPath, [
      cliPath,
      "claim",
      "record",
      "Do not persist this scope",
      "--event",
      event.id,
      "--paths",
      ".env",
    ], { cwd: root, encoding: "utf-8" });
    assert.strictEqual(sensitive.status, 1);
    assert.match(sensitive.stderr, /Sensitive paths cannot be used/);
  });

  test("queues, deduplicates, approves, and rejects evidence-backed candidates", () => {
    const root = tmpProject();
    const hippo = new Hippocampus(root);
    const firstEvent = hippo.addEvent(eventData(root, "candidate-first"));
    const secondEvent = hippo.addEvent(eventData(root, "candidate-second"));
    const firstObservation = observation(
      "Candidate approval creates current knowledge",
      firstEvent.id,
      "automated-test",
      { scope: { paths: ["src/candidate.ts"] } }
    );

    const created = hippo.addClaimCandidate(firstObservation);
    const reinforced = hippo.addClaimCandidate({ ...firstObservation, note: "verified again" });
    assert.strictEqual(created.kind, "created");
    assert.strictEqual(reinforced.kind, "reinforced");
    assert.strictEqual(created.candidate.id, reinforced.candidate.id);
    assert.strictEqual(hippo.getClaims().length, 0);

    const approved = hippo.approveClaimCandidate(created.candidate.id, "accepted after review");
    assert.strictEqual(approved.kind, "approved");
    assert.strictEqual(approved.candidate.status, "approved");
    assert.strictEqual(approved.claim?.statement, firstObservation.statement);
    assert.strictEqual(hippo.listClaimCandidates().length, 0);
    assert.strictEqual(hippo.listClaimCandidates({ include_resolved: true }).length, 1);

    const rejectedCandidate = hippo.addClaimCandidate(observation(
      "Rejected candidates do not become claims",
      secondEvent.id,
      "direct-tool-result",
      { scope: { paths: ["src/candidate.ts"] } }
    )).candidate;
    const rejected = hippo.rejectClaimCandidate(rejectedCandidate.id, "not generally applicable");
    assert.strictEqual(rejected.candidate.status, "rejected");
    assert.strictEqual(hippo.getClaims().length, 1);
    assert.throws(() => hippo.approveClaimCandidate(rejectedCandidate.id), /already rejected/);

    const persisted = loadClaimCandidateStore(path.join(root, ".wolf", "claim-candidates.json"));
    assert.ok(persisted);
    assert.strictEqual(persisted!.stats.approved_count, 1);
    assert.strictEqual(persisted!.stats.rejected_count, 1);
  });

  test("candidate creation fails closed when evidence is missing", () => {
    const root = tmpProject();
    const hippo = new Hippocampus(root);
    assert.throws(
      () => hippo.addClaimCandidate(observation(
        "Unsupported candidate",
        "evt-missing",
        "direct-tool-result"
      )),
      /Evidence event not found/
    );
    assert.strictEqual(hippo.candidatesExist(), false);
  });

  test("candidate CLI queues, lists, approves, and rejects sensitive scope", () => {
    const root = tmpProject();
    const event = new Hippocampus(root).addEvent(eventData(root, "candidate-cli"));
    const add = spawnSync(process.execPath, [
      cliPath, "claim", "candidate", "add", "Candidate CLI works",
      "--event", event.id,
      "--quality", "automated-test",
      "--paths", "src/candidate.ts",
      "--json",
    ], { cwd: root, encoding: "utf-8" });
    assert.strictEqual(add.status, 0, add.stderr);
    const added = JSON.parse(add.stdout) as { candidate: { id: string; status: string } };
    assert.strictEqual(added.candidate.status, "pending");

    const list = spawnSync(process.execPath, [
      cliPath, "claim", "candidate", "list", "CLI works", "--json",
    ], { cwd: root, encoding: "utf-8" });
    assert.strictEqual(list.status, 0, list.stderr);
    assert.strictEqual((JSON.parse(list.stdout) as unknown[]).length, 1);

    const approve = spawnSync(process.execPath, [
      cliPath, "claim", "candidate", "approve", added.candidate.id, "--json",
    ], { cwd: root, encoding: "utf-8" });
    assert.strictEqual(approve.status, 0, approve.stderr);
    assert.strictEqual(JSON.parse(approve.stdout).claim.statement, "Candidate CLI works");

    const sensitive = spawnSync(process.execPath, [
      cliPath, "claim", "candidate", "add", "Sensitive candidate",
      "--event", event.id,
      "--paths", ".env",
    ], { cwd: root, encoding: "utf-8" });
    assert.strictEqual(sensitive.status, 1);
    assert.match(sensitive.stderr, /Sensitive paths cannot be used/);
  });
});
