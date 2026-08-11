import type { ClaimIndex, ClaimStatus, MemoryClaim } from "./types.js";
import { backupCorruptFile, readJsonFile, writeJsonAtomic } from "./persistence.js";
import { normalizeRecallPath } from "./cue-recall.js";
import { tokenizeClaim } from "./claims.js";

const STATUSES: ClaimStatus[] = ["active", "disputed", "superseded"];

function appendUnique(map: Record<string, string[]>, key: string, id: string): void {
  if (!map[key]) map[key] = [];
  if (!map[key].includes(id)) map[key].push(id);
}

export function buildClaimIndex(claims: readonly MemoryClaim[]): ClaimIndex {
  const sorted = [...claims].sort((left, right) =>
    right.updated_at.localeCompare(left.updated_at)
  );
  const index: ClaimIndex = {
    version: 1,
    last_updated: new Date().toISOString(),
    claim_ids: sorted.map((claim) => claim.id),
    identity_index: {},
    token_index: {},
    path_index: {},
    status_index: {
      active: [],
      disputed: [],
      superseded: [],
    },
    evidence_event_index: {},
  };

  for (const claim of sorted) {
    index.identity_index[claim.identity_key] = claim.id;
    for (const token of tokenizeClaim(claim.statement)) {
      appendUnique(index.token_index, token, claim.id);
    }
    for (const filePath of claim.scope.paths ?? []) {
      appendUnique(index.path_index, normalizeRecallPath(filePath), claim.id);
    }
    index.status_index[claim.status].push(claim.id);
    for (const evidence of claim.evidence) {
      appendUnique(index.evidence_event_index, evidence.event_id, claim.id);
    }
  }
  return index;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isStringMap(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function isStringArrayMap(value: unknown): value is Record<string, string[]> {
  return isRecord(value) && Object.values(value).every(isStringArray);
}

function isStatusIndex(value: unknown): value is Record<ClaimStatus, string[]> {
  return (
    isRecord(value) &&
    STATUSES.every((status) => isStringArray(value[status]))
  );
}

export function isClaimIndex(value: unknown): value is ClaimIndex {
  return (
    isRecord(value) &&
    value.version === 1 &&
    typeof value.last_updated === "string" &&
    Number.isFinite(Date.parse(value.last_updated)) &&
    isStringArray(value.claim_ids) &&
    isStringMap(value.identity_index) &&
    isStringArrayMap(value.token_index) &&
    isStringArrayMap(value.path_index) &&
    isStatusIndex(value.status_index) &&
    isStringArrayMap(value.evidence_event_index)
  );
}

export function loadClaimIndex(
  indexPath: string,
  recoverCorrupt: boolean = false
): ClaimIndex | null {
  const parsed = readJsonFile<unknown>(indexPath, false);
  if (parsed === null) {
    if (recoverCorrupt) {
      try { backupCorruptFile(indexPath); } catch {}
    }
    return null;
  }
  if (!isClaimIndex(parsed)) {
    if (recoverCorrupt) backupCorruptFile(indexPath);
    return null;
  }
  return parsed;
}

export function saveClaimIndex(indexPath: string, index: ClaimIndex): void {
  index.last_updated = new Date().toISOString();
  writeJsonAtomic(indexPath, index);
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const expected = new Set(right);
  return new Set(left).size === expected.size && left.every((id) => expected.has(id));
}

function sameStringMap(
  left: Record<string, string>,
  right: Record<string, string>
): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.join("\0") === rightKeys.join("\0") &&
    leftKeys.every((key) => left[key] === right[key])
  );
}

function sameArrayMap(
  left: Record<string, string[]>,
  right: Record<string, string[]>
): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.join("\0") === rightKeys.join("\0") &&
    leftKeys.every((key) => sameIds(left[key], right[key]))
  );
}

export function claimIndexNeedsRebuild(
  index: ClaimIndex | null,
  claims: readonly MemoryClaim[]
): boolean {
  if (!index) return true;
  const expected = buildClaimIndex(claims);
  return !(
    sameIds(index.claim_ids, expected.claim_ids) &&
    sameStringMap(index.identity_index, expected.identity_index) &&
    sameArrayMap(index.token_index, expected.token_index) &&
    sameArrayMap(index.path_index, expected.path_index) &&
    sameArrayMap(index.status_index, expected.status_index) &&
    sameArrayMap(index.evidence_event_index, expected.evidence_event_index)
  );
}
