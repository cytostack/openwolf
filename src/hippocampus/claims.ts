import * as crypto from "node:crypto";
import type {
  ClaimEvidence,
  ClaimObservation,
  ClaimRecallRequest,
  ClaimRecallResponse,
  ClaimScope,
  ClaimStatus,
  ClaimStore,
  ClaimUpdateReport,
  EvidenceQuality,
  MemoryClaim,
} from "./types.js";
import { normalizeRecallPath } from "./cue-recall.js";

export const EVIDENCE_WEIGHTS: Record<EvidenceQuality, number> = {
  "automated-test": 1,
  "reproducible-observation": 0.95,
  "direct-tool-result": 0.85,
  "explicit-user-correction": 0.75,
  "verified-code-inspection": 0.65,
  "agent-inference": 0.35,
  "unverified-assumption": 0.15,
};

export const CLAIM_DISPUTE_MARGIN = 0.12;
export const CLAIM_SUPERSESSION_MARGIN = 0.2;
export const CLAIM_SUPERSESSION_MIN_STRENGTH = 0.65;

const CLAIM_RELATIONS = new Set(["confirms", "contradicts", "refines"]);
const PROVENANCE_SOURCES = new Set(["user", "hook", "daemon", "manual", "agent"]);

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function validateClaimObservation(observation: ClaimObservation): void {
  if (!observation.statement.trim()) throw new Error("Claim statement is required");
  if (!observation.event_id.trim()) throw new Error("Claim evidence event_id is required");
  if (observation.relation && !CLAIM_RELATIONS.has(observation.relation)) {
    throw new Error(`Unknown claim relation: ${observation.relation}`);
  }
  if (!(observation.quality in EVIDENCE_WEIGHTS)) {
    throw new Error(`Unknown evidence quality: ${observation.quality}`);
  }
  if (!(observation.verification_method in EVIDENCE_WEIGHTS)) {
    throw new Error(`Unknown verification method: ${observation.verification_method}`);
  }
  if (!PROVENANCE_SOURCES.has(observation.provenance.source)) {
    throw new Error(`Unknown provenance source: ${observation.provenance.source}`);
  }
  if (
    !Number.isFinite(observation.provenance.authority) ||
    observation.provenance.authority < 0 ||
    observation.provenance.authority > 1
  ) {
    throw new Error("Provenance authority must be between 0 and 1");
  }
  if (observation.observed_at && !Number.isFinite(Date.parse(observation.observed_at))) {
    throw new Error("observed_at must be an ISO-compatible timestamp");
  }
  for (const value of Object.values(observation.scope ?? {})) {
    if (value !== undefined && !isStringArray(value)) {
      throw new Error("Claim scope values must be string arrays");
    }
  }
}

const TOKEN_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in",
  "is", "it", "of", "on", "or", "that", "the", "this", "to", "was", "with",
]);

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

export function normalizeClaimStatement(statement: string): string {
  return statement
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeClaimScope(scope: ClaimScope = {}): ClaimScope {
  return {
    paths: scope.paths
      ? uniqueSorted(scope.paths.map(normalizeRecallPath))
      : undefined,
    platforms: scope.platforms
      ? uniqueSorted(scope.platforms.map((item) => item.toLowerCase().trim()))
      : undefined,
    versions: scope.versions
      ? uniqueSorted(scope.versions.map((item) => item.trim()))
      : undefined,
    contexts: scope.contexts
      ? uniqueSorted(scope.contexts.map((item) => item.toLowerCase().trim()))
      : undefined,
  };
}

function compactScope(scope: ClaimScope): ClaimScope {
  return Object.fromEntries(
    Object.entries(scope).filter(([, value]) => Array.isArray(value) && value.length > 0)
  ) as ClaimScope;
}

export function buildClaimIdentityKey(
  statement: string,
  scope: ClaimScope = {}
): string {
  const normalizedScope = compactScope(normalizeClaimScope(scope));
  return `${normalizeClaimStatement(statement)}\0${JSON.stringify(normalizedScope)}`;
}

export function tokenizeClaim(statement: string): string[] {
  return uniqueSorted(
    normalizeClaimStatement(statement)
      .split(" ")
      .filter((token) => token.length > 1 && !TOKEN_STOP_WORDS.has(token))
  );
}

export function evidenceStrength(evidence: ClaimEvidence): number {
  return EVIDENCE_WEIGHTS[evidence.quality] * evidence.provenance.authority;
}

function independentEvidenceStrength(
  evidence: readonly ClaimEvidence[],
  relations: readonly ClaimEvidence["relation"][]
): number {
  const strongestByEvent = new Map<string, number>();
  for (const item of evidence) {
    if (!relations.includes(item.relation)) continue;
    const strength = evidenceStrength(item);
    strongestByEvent.set(
      item.event_id,
      Math.max(strongestByEvent.get(item.event_id) ?? 0, strength)
    );
  }
  const strengths = [...strongestByEvent.values()].sort((a, b) => b - a);
  if (strengths.length === 0) return 0;
  const strongest = strengths[0];
  const reinforcement = strengths
    .slice(1)
    .reduce((sum, strength, index) => sum + strength * (0.15 / (index + 1)), 0);
  return Math.min(1, strongest + Math.min(0.2, reinforcement));
}

export function claimEvidenceScores(claim: MemoryClaim): {
  support: number;
  contradiction: number;
} {
  return {
    support: independentEvidenceStrength(claim.evidence, ["confirms", "refines"]),
    contradiction: independentEvidenceStrength(claim.evidence, ["contradicts"]),
  };
}

export function calculateClaimConfidence(claim: MemoryClaim): number {
  const { support, contradiction } = claimEvidenceScores(claim);
  if (support === 0 && contradiction === 0) return 0;
  const denominator = support + contradiction;
  return Math.round((support / denominator) * 1000) / 1000;
}

export function determineClaimStatus(claim: MemoryClaim): ClaimStatus {
  if (claim.superseded_by) return "superseded";
  const { support, contradiction } = claimEvidenceScores(claim);
  if (contradiction > 0 && Math.abs(support - contradiction) < CLAIM_DISPUTE_MARGIN) {
    return "disputed";
  }
  if (contradiction > support) return "disputed";
  return "active";
}

export function refreshClaim(claim: MemoryClaim, updatedAt: string): void {
  claim.evidence_event_ids = uniqueSorted(
    claim.evidence
      .filter((item) => item.relation !== "contradicts")
      .map((item) => item.event_id)
  );
  claim.contradicting_event_ids = uniqueSorted(
    claim.evidence
      .filter((item) => item.relation === "contradicts")
      .map((item) => item.event_id)
  );
  claim.contradicts_claim_ids = uniqueSorted(claim.contradicts_claim_ids ?? []);
  claim.confidence = calculateClaimConfidence(claim);
  claim.status = determineClaimStatus(claim);
  claim.updated_at = updatedAt;
}

function createEvidence(
  observation: ClaimObservation,
  relation: ClaimEvidence["relation"],
  recordedAt: string
): ClaimEvidence {
  return {
    event_id: observation.event_id,
    relation,
    quality: observation.quality,
    verification_method: observation.verification_method,
    provenance: {
      ...observation.provenance,
      authority: Math.max(0, Math.min(1, observation.provenance.authority)),
      event_id: observation.event_id,
    },
    recorded_at: recordedAt,
    note: observation.note,
  };
}

function addEvidence(claim: MemoryClaim, evidence: ClaimEvidence): void {
  const duplicate = claim.evidence.some(
    (item) =>
      item.event_id === evidence.event_id &&
      item.relation === evidence.relation &&
      item.quality === evidence.quality
  );
  if (!duplicate) claim.evidence.push(evidence);
}

function createClaim(
  observation: ClaimObservation,
  relation: "confirms" | "refines",
  now: string,
  refinedFrom?: string
): MemoryClaim {
  const scope = compactScope(normalizeClaimScope(observation.scope));
  const evidence = createEvidence(observation, relation, now);
  const claim: MemoryClaim = {
    id: `clm-${crypto.randomUUID()}`,
    version: 1,
    identity_key: buildClaimIdentityKey(observation.statement, scope),
    statement: observation.statement.trim(),
    status: "active",
    confidence: 0,
    evidence: [evidence],
    evidence_event_ids: [],
    contradicting_event_ids: [],
    contradicts_claim_ids: [],
    refined_from: refinedFrom,
    scope,
    provenance: evidence.provenance,
    created_at: now,
    updated_at: now,
  };
  refreshClaim(claim, now);
  return claim;
}

function findClaim(store: ClaimStore, claimId: string): MemoryClaim {
  const claim = store.claims.find((item) => item.id === claimId);
  if (!claim) throw new Error(`Claim not found: ${claimId}`);
  return claim;
}

function maybeSupersede(
  original: MemoryClaim,
  correction: MemoryClaim,
  now: string
): void {
  const originalSupport = claimEvidenceScores(original).support;
  const correctionSupport = claimEvidenceScores(correction).support;
  if (
    correctionSupport >= CLAIM_SUPERSESSION_MIN_STRENGTH &&
    correctionSupport - originalSupport >= CLAIM_SUPERSESSION_MARGIN
  ) {
    original.superseded_by = correction.id;
    refreshClaim(original, now);
    return;
  }

  // A weak contradiction must not erase or hide stronger verified knowledge.
  // Keep the original active when the correction is materially weaker, while
  // marking the unsupported correction disputed for explicit historical review.
  if (correctionSupport >= originalSupport - CLAIM_DISPUTE_MARGIN) {
    original.status = "disputed";
  } else {
    original.status = "active";
  }
  correction.status = "disputed";
  correction.updated_at = now;
}

export function applyClaimObservation(
  store: ClaimStore,
  observation: ClaimObservation
): ClaimUpdateReport {
  validateClaimObservation(observation);
  const now = observation.observed_at ?? new Date().toISOString();
  const relation = observation.relation ?? "confirms";
  const normalizedScope = normalizeClaimScope(observation.scope);
  const identityKey = buildClaimIdentityKey(observation.statement, normalizedScope);
  const exact = store.claims.find((claim) => claim.identity_key === identityKey);

  if (!observation.target_claim_id) {
    if (relation !== "confirms") {
      throw new Error(`${relation} observations require target_claim_id`);
    }
    if (exact) {
      addEvidence(exact, createEvidence(observation, "confirms", now));
      refreshClaim(exact, now);
      return { kind: "reinforced", claim: exact, affected_claims: [exact] };
    }
    const created = createClaim(observation, "confirms", now);
    store.claims.push(created);
    return { kind: "created", claim: created, affected_claims: [created] };
  }

  const target = findClaim(store, observation.target_claim_id);
  if (relation === "confirms") {
    if (target.identity_key !== identityKey) {
      throw new Error("A confirming observation must match the target statement and scope");
    }
    addEvidence(target, createEvidence(observation, "confirms", now));
    refreshClaim(target, now);
    return { kind: "reinforced", claim: target, affected_claims: [target] };
  }

  if (relation === "contradicts") {
    addEvidence(target, createEvidence(observation, "contradicts", now));
    refreshClaim(target, now);

    let correction = exact;
    if (!correction || correction.id === target.id) {
      correction = createClaim(observation, "confirms", now);
      store.claims.push(correction);
    } else {
      addEvidence(correction, createEvidence(observation, "confirms", now));
      refreshClaim(correction, now);
    }
    correction.contradicts_claim_ids = uniqueSorted([
      ...correction.contradicts_claim_ids,
      target.id,
    ]);
    maybeSupersede(target, correction, now);
    return {
      kind: "contradicted",
      claim: correction,
      affected_claims: [target, correction],
    };
  }

  if (target.identity_key === identityKey) {
    throw new Error("A refinement must change the statement or scope");
  }
  let refinement = exact;
  if (!refinement) {
    refinement = createClaim(observation, "refines", now, target.id);
    store.claims.push(refinement);
  } else {
    addEvidence(refinement, createEvidence(observation, "refines", now));
    refinement.refined_from = target.id;
    refreshClaim(refinement, now);
  }
  return {
    kind: "refined",
    claim: refinement,
    affected_claims: [target, refinement],
  };
}

function intersects(left: readonly string[] | undefined, right: readonly string[]): boolean {
  if (!left || left.length === 0) return true;
  const expected = new Set(right);
  return left.some((value) => expected.has(value));
}

function claimMatchesScope(
  claim: MemoryClaim,
  request: ClaimRecallRequest
): { matches: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const requestPaths = request.paths?.map(normalizeRecallPath) ?? [];
  const claimPaths = claim.scope.paths ?? [];
  if (requestPaths.length > 0) {
    const pathMatch = claimPaths.length === 0 || claimPaths.some((claimPath) =>
      requestPaths.some(
        (requestPath) =>
          claimPath === requestPath ||
          claimPath.startsWith(`${requestPath}/`) ||
          requestPath.startsWith(`${claimPath}/`)
      )
    );
    if (!pathMatch) return { matches: false, reasons };
    reasons.push(claimPaths.length === 0 ? "global path scope" : "path scope match");
  }

  const platforms = request.platforms?.map((item) => item.toLowerCase()) ?? [];
  if (platforms.length > 0) {
    if (!intersects(claim.scope.platforms, platforms)) return { matches: false, reasons };
    reasons.push(claim.scope.platforms?.length ? "platform scope match" : "global platform scope");
  }

  const versions = request.versions ?? [];
  if (versions.length > 0) {
    if (!intersects(claim.scope.versions, versions)) return { matches: false, reasons };
    reasons.push(claim.scope.versions?.length ? "version scope match" : "global version scope");
  }
  return { matches: true, reasons };
}

export function recallClaims(
  claims: readonly MemoryClaim[],
  request: ClaimRecallRequest
): ClaimRecallResponse {
  const statuses = request.statuses ?? [
    "active",
    ...(request.include_disputed ? ["disputed" as const] : []),
    ...(request.include_superseded ? ["superseded" as const] : []),
  ];
  const queryTokens = tokenizeClaim(request.query ?? "");
  const scored = claims
    .filter((claim) => statuses.includes(claim.status))
    .map((claim) => {
      const scope = claimMatchesScope(claim, request);
      if (!scope.matches) return null;
      const claimTokens = new Set(tokenizeClaim(claim.statement));
      const tokenHits = queryTokens.filter((token) => claimTokens.has(token)).length;
      if (queryTokens.length > 0 && tokenHits === 0) return null;
      const evidence = claimEvidenceScores(claim).support;
      const queryScore = queryTokens.length > 0 ? tokenHits / queryTokens.length : 1;
      const statusRank = claim.status === "active" ? 2 : claim.status === "disputed" ? 1 : 0;
      const reasons = [...scope.reasons];
      if (tokenHits > 0) reasons.push(`${tokenHits} statement token match(es)`);
      reasons.push(`strongest evidence ${evidence.toFixed(2)}`);
      return { claim, evidence, queryScore, statusRank, reasons };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((left, right) =>
      right.statusRank - left.statusRank ||
      right.evidence - left.evidence ||
      right.claim.confidence - left.claim.confidence ||
      right.queryScore - left.queryScore ||
      right.claim.updated_at.localeCompare(left.claim.updated_at)
    );

  const offset = request.offset ?? 0;
  const limit = request.limit ?? 5;
  const page = scored.slice(offset, offset + limit);
  return {
    claims: page.map((item) => item.claim),
    total_matches: scored.length,
    match_details: page.map((item) => ({
      claim_id: item.claim.id,
      confidence: item.claim.confidence,
      evidence_strength: Math.round(item.evidence * 1000) / 1000,
      match_reasons: item.reasons,
    })),
  };
}
