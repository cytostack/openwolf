// Hippocampus Memory System — Type Definitions

export type Valence = "reward" | "neutral" | "penalty" | "trauma";

export type ActionType =
  | "read"
  | "write"
  | "edit"
  | "delete"
  | "execute"
  | "correct"
  | "approve"
  | "reject"
  | "discover"
  | "fix"
  | "refactor";

export type ConsolidationStage = "short-term" | "consolidating" | "long-term";

export interface EventContext {
  project_root: string;
  files_involved: string[];
  cwd_at_time: string;
  spatial_path: string;
  spatial_depth: number;
  session_start: string;
  turn_in_session: number;
  current_goal?: string;
  recent_errors?: string[];
}

export interface EventAction {
  type: ActionType;
  subtype?: string;
  description: string;
  tokens_spent: number;
  files_modified?: string[];
  files_read?: string[];
  succeeded?: boolean;
  error_message?: string;
}

export interface EventOutcome {
  valence: Valence;
  intensity: number;
  reflection: string;
  user_correction?: string;
}

export interface EventConsolidation {
  stage: ConsolidationStage;
  access_count: number;
  last_accessed: string;
  consolidation_score: number;
  should_consolidate: boolean;
  decay_factor: number;
  last_decay_check: string;
  forgotten?: boolean;
  forgotten_at?: string;
}

export interface WolfEvent extends MemoryEvent {
  consolidation: EventConsolidation;
}

/** Immutable historical evidence. Operational consolidation metadata lives on WolfEvent. */
export interface MemoryEvent {
  id: string;
  version: 1;
  timestamp: string;
  session_id: string;
  context: EventContext;
  action: EventAction;
  outcome: EventOutcome;
  source: "hook" | "daemon" | "manual";
  tags: string[];
}

export type ClaimStatus = "active" | "disputed" | "superseded";

export type ClaimRelation = "confirms" | "contradicts" | "refines";

export type EvidenceQuality =
  | "automated-test"
  | "reproducible-observation"
  | "direct-tool-result"
  | "explicit-user-correction"
  | "verified-code-inspection"
  | "agent-inference"
  | "unverified-assumption";

export type VerificationMethod = EvidenceQuality;

export type ClaimProvenanceSource =
  | "user"
  | "hook"
  | "daemon"
  | "manual"
  | "agent";

export interface ClaimScope {
  paths?: string[];
  platforms?: string[];
  versions?: string[];
  contexts?: string[];
}

export interface ClaimProvenance {
  source: ClaimProvenanceSource;
  authority: number;
  label?: string;
  event_id: string;
}

export interface ClaimEvidence {
  event_id: string;
  relation: ClaimRelation;
  quality: EvidenceQuality;
  verification_method: VerificationMethod;
  provenance: ClaimProvenance;
  recorded_at: string;
  note?: string;
}

export interface MemoryClaim {
  id: string;
  version: 1;
  identity_key: string;
  statement: string;
  status: ClaimStatus;
  confidence: number;
  evidence: ClaimEvidence[];
  evidence_event_ids: string[];
  contradicting_event_ids: string[];
  contradicts_claim_ids: string[];
  refined_from?: string;
  superseded_by?: string;
  scope: ClaimScope;
  provenance: ClaimProvenance;
  created_at: string;
  updated_at: string;
}

export interface ClaimStore {
  version: 1;
  schema_version: 1;
  project_root: string;
  created_at: string;
  last_updated: string;
  claims: MemoryClaim[];
  stats: {
    total_claims: number;
    active_count: number;
    disputed_count: number;
    superseded_count: number;
  };
  size_bytes: number;
}

export interface ClaimIndex {
  version: 1;
  last_updated: string;
  claim_ids: string[];
  identity_index: Record<string, string>;
  token_index: Record<string, string[]>;
  path_index: Record<string, string[]>;
  status_index: Record<ClaimStatus, string[]>;
  evidence_event_index: Record<string, string[]>;
}

export interface ClaimObservation {
  statement: string;
  event_id: string;
  relation?: ClaimRelation;
  target_claim_id?: string;
  quality: EvidenceQuality;
  verification_method: VerificationMethod;
  provenance: Omit<ClaimProvenance, "event_id">;
  scope?: ClaimScope;
  note?: string;
  observed_at?: string;
}

export type ClaimCandidateStatus = "pending" | "approved" | "rejected";

export interface ClaimCandidate {
  id: string;
  version: 1;
  identity_key: string;
  observation: ClaimObservation;
  status: ClaimCandidateStatus;
  created_at: string;
  updated_at: string;
  resolved_at?: string;
  resolution_note?: string;
}

export interface ClaimCandidateStore {
  version: 1;
  schema_version: 1;
  project_root: string;
  created_at: string;
  last_updated: string;
  candidates: ClaimCandidate[];
  stats: {
    total_candidates: number;
    pending_count: number;
    approved_count: number;
    rejected_count: number;
  };
  size_bytes: number;
}

export interface ClaimCandidateRequest {
  query?: string;
  paths?: string[];
  statuses?: ClaimCandidateStatus[];
  include_resolved?: boolean;
  limit?: number;
  offset?: number;
}

export type ClaimCandidateUpdateKind = "created" | "reinforced" | "approved" | "rejected";

export interface ClaimCandidateUpdateReport {
  kind: ClaimCandidateUpdateKind;
  candidate: ClaimCandidate;
  claim?: MemoryClaim;
}

export type ClaimUpdateKind =
  | "created"
  | "reinforced"
  | "contradicted"
  | "refined";

export interface ClaimUpdateReport {
  kind: ClaimUpdateKind;
  claim: MemoryClaim;
  affected_claims: MemoryClaim[];
}

export interface ClaimRecallRequest {
  query?: string;
  paths?: string[];
  platforms?: string[];
  versions?: string[];
  statuses?: ClaimStatus[];
  include_disputed?: boolean;
  include_superseded?: boolean;
  limit?: number;
  offset?: number;
}

export interface ClaimMatchDetail {
  claim_id: string;
  confidence: number;
  evidence_strength: number;
  match_reasons: string[];
}

export interface ClaimRecallResponse {
  claims: MemoryClaim[];
  total_matches: number;
  match_details: ClaimMatchDetail[];
}

export interface HippocampusStore {
  version: 1;
  schema_version: 1;
  project_root: string;
  created_at: string;
  last_updated: string;
  buffer: WolfEvent[];
  stats: {
    total_events: number;
    reward_count: number;
    penalty_count: number;
    trauma_count: number;
    neutral_count: number;
    recurrences: number;
    negative_writes: number;
    oldest_event: string | null;
    newest_event: string | null;
  };
  size_bytes: number;
  max_size_bytes: number;
  retention_days: number;
  max_buffer_size: number;
}

export type QuestionType = "how-to" | "why-not" | "what-if" | "what-happened" | "general";

export interface RecallFilters {
  valence?: Valence[];
  min_intensity?: number;
  max_age_days?: number;
  tags?: string[];
  exclude_forgotten?: boolean;
}

export interface ConsolidationResult {
  event_id: string;
  action: "promote" | "merge" | "decay" | "forget" | "keep";
  new_location: string;
  details: string;
}

export interface HippoStats {
  total_events: number;
  buffer_size: number;
  trauma_count: number;
  reward_count: number;
  penalty_count: number;
  neutral_count: number;
  recurrences: number;
  negative_writes: number;
  recurrence_rate: number;
  last_consolidation: string | null;
}

// ============================================================
// Phase 2: Cue and Recall Types
// ============================================================

export type CueType = "location" | "question" | "state";

export type LocationMatchMode = "exact" | "prefix" | "glob" | "parent" | "sibling";

export interface LocationCue {
  type: "location";
  path: string | string[];
  match_mode?: LocationMatchMode; // Default: "exact"
}

export interface QuestionCue {
  type: "question";
  query: string;
  entities?: string[];
  question_type?: QuestionType;
}

export interface StateCue {
  type: "state";
  goal?: string;
  error?: {
    type: string;
    message: string;
    file?: string;
    line?: number;
  };
  turn_count: number;
}

export type Cue = LocationCue | QuestionCue | StateCue;

export interface RecallRequest {
  cue: Cue;
  filters?: RecallFilters;
  limit?: number; // Default: 5
  offset?: number;
}

export interface MatchDetail {
  event_id: string;
  confidence: number;
  match_reasons: string[];
}

export interface RecallResponse {
  events: WolfEvent[];
  total_matches: number;
  confidence: number; // Average confidence of returned events
  match_details: MatchDetail[];
}

// ============================================================
// Phase 2: Cue Index Types
// ============================================================

export interface CueIndex {
  version: 1;
  last_updated: string;
  event_ids?: string[]; // Complete buffer event ID set, recency-sorted
  location_index: Record<string, string[]>; // path -> event IDs (recency-sorted)
  tag_index: Record<string, string[]>;
  trauma_index: {
    all_trauma_ids: string[]; // Sorted by intensity desc
    by_path: Record<string, string[]>; // path -> trauma event IDs
  };
}
