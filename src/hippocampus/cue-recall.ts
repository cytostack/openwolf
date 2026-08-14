// Hippocampus Memory System — Cue Recall Algorithm
// Phase 2: Recall events given a cue

import type {
  WolfEvent,
  Cue,
  LocationCue,
  QuestionCue,
  StateCue,
  RecallRequest,
  RecallResponse,
  MatchDetail,
  CueIndex,
} from "./types.js";

// ============================================================
// Scoring Weights (Phase 2)
// ============================================================

const WEIGHTS = {
  location: 0.55,
  recency: 0.2,
  valence: 0.15,
  intensity: 0.1,
};

// ============================================================
// Scoring Functions
// ============================================================

/**
 * Score a single event against a recall request.
 * Returns a confidence score between 0 and 1.
 */
export function scoreEvent(
  event: WolfEvent,
  cue: Cue,
  request: RecallRequest,
  index: CueIndex
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  // Location match
  if (cue.type === "location") {
    const locScore = scoreLocationMatch(event, cue);
    if (locScore > 0) {
      score += locScore * WEIGHTS.location;
      reasons.push(`${cue.match_mode || "exact"} path match`);
    }
  } else if (cue.type === "state") {
    const stateMatch = scoreStateMatch(event, cue);
    score += stateMatch.score * WEIGHTS.location;
    reasons.push(...stateMatch.reasons);
  }

  // Recency boost
  const recencyScore = computeRecencyScore(event.timestamp);
  score += recencyScore * WEIGHTS.recency;
  if (recencyScore > 0.5) {
    reasons.push("recent event");
  }

  // Valence match
  if (request.filters?.valence) {
    if (request.filters.valence.includes(event.outcome.valence)) {
      score += WEIGHTS.valence;
      reasons.push(`valence: ${event.outcome.valence}`);
    }
  } else {
    // No valence filter - give base valence score
    score += WEIGHTS.valence * 0.5;
  }

  // Intensity boost
  score += event.outcome.intensity * WEIGHTS.intensity;
  if (event.outcome.intensity > 0.7) {
    reasons.push(`high intensity (${event.outcome.intensity})`);
  }

  // Cap at 1.0
  score = Math.min(1.0, score);

  return { score, reasons };
}

/**
 * Score location match between an event and a location cue.
 */
export function scoreLocationMatch(
  event: WolfEvent,
  cue: LocationCue
): number {
  const eventPaths = Array.from(
    new Set(event.context.files_involved.map(normalizeRecallPath))
  );
  const cuePaths = (Array.isArray(cue.path) ? cue.path : [cue.path]).map(
    normalizeRecallPath
  );
  const matchMode = cue.match_mode || "exact";

  switch (matchMode) {
    case "exact":
      return cuePaths.some((p) => eventPaths.includes(p)) ? 1.0 : 0.0;

    case "prefix":
      // Event path starts with cue path prefix
      return cuePaths.some((cp) =>
        eventPaths.some((ep) => ep.startsWith(cp))
      )
        ? 0.8
        : 0.0;

    case "glob":
      return cuePaths.some((pattern) =>
        eventPaths.some((ep) => matchGlob(ep, pattern))
      )
        ? 0.9
        : 0.0;

    case "parent":
      // Event path starts with a parent directory of the cue path
      return cuePaths.some((cp) => {
        const parents = getParentDirectories(cp);
        return eventPaths.some((ep) =>
          parents.some((parent) => ep.startsWith(parent))
        );
      })
        ? 0.7
        : 0.0;

    case "sibling":
      // Event path is in the same directory as cue path
      return cuePaths.some((cp) => {
        const cueDir = getDirectory(cp);
        return eventPaths.some((ep) => getDirectory(ep) === cueDir);
      })
        ? 0.6
        : 0.0;

    default:
      return 0.0;
  }
}

/**
 * Compute recency score using exponential decay (half-life 30 days)
 */
export function computeRecencyScore(timestamp: string): number {
  const daysSince = (Date.now() - new Date(timestamp).getTime()) / (1000 * 60 * 60 * 24);
  return Math.exp(-daysSince / 30);
}

/**
 * Simple glob matching using micromatch-style patterns
 */
export function matchGlob(filePath: string, pattern: string): boolean {
  // Convert glob pattern to regex
  // ** matches any number of directories
  // * matches anything except /
  // ? matches single character except /
  let regex = pattern
    .replace(/\./g, "\\.") // Escape dots
    .replace(/\*\*/g, "{{DOUBLESTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\{\{DOUBLESTAR\}\}/g, ".*")
    .replace(/\?/g, "[^/]");

  // Anchor the pattern
  if (!regex.startsWith(".*")) {
    regex = "^" + regex;
  }
  if (!regex.endsWith(".*")) {
    regex = regex + "$";
  }

  try {
    return new RegExp(regex).test(filePath);
  } catch {
    return false;
  }
}

/** Normalize stored and requested paths independently of the host platform. */
export function normalizeRecallPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/").replace(/\/+/g, "/");
  const driveMatch = normalized.match(/^([A-Za-z]:)(?:\/|$)/);
  const isAbsolute = normalized.startsWith("/");
  const prefix = driveMatch ? `${driveMatch[1]}/` : isAbsolute ? "/" : "";
  const body = driveMatch
    ? normalized.slice(driveMatch[0].length)
    : isAbsolute
      ? normalized.slice(1)
      : normalized;
  const parts: string[] = [];
  for (const part of body.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length > 0) parts.pop();
      continue;
    }
    parts.push(part);
  }
  return prefix + parts.join("/");
}

/** Get all parent directory prefixes, nearest and distant. */
export function getParentDirectories(filePath: string): string[] {
  const normalized = normalizeRecallPath(filePath);
  const slash = normalized.lastIndexOf("/");
  if (slash < 0) return [];

  const prefix = normalized.startsWith("/")
    ? "/"
    : /^[A-Za-z]:\//.test(normalized)
      ? normalized.slice(0, 3)
      : "";
  const body = normalized.slice(prefix.length);
  const parts = body.split("/").filter(Boolean);
  const parents: string[] = [];
  for (let i = parts.length - 1; i > 0; i--) {
    parents.push(prefix + parts.slice(0, i).join("/") + "/");
  }
  if (prefix && parts.length > 0) parents.push(prefix);
  return parents;
}

/** Get the directory part of a normalized path. */
export function getDirectory(filePath: string): string {
  const normalized = normalizeRecallPath(filePath);
  const separator = normalized.lastIndexOf("/");
  return separator < 0 ? "." : normalized.slice(0, separator);
}

/**
 * Parse error type from an error message
 */
export function parseErrorType(errorMessage: string): string {
  // "TypeError: Cannot read..." -> "TypeError"
  return errorMessage.split(":")[0] || errorMessage;
}

/**
 * Score a state cue match
 */
export function scoreStateMatch(
  event: WolfEvent,
  cue: StateCue
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  // Error type matching
  if (cue.error && event.action.error_message) {
    const eventErrorType = parseErrorType(event.action.error_message);
    const cueErrorType = parseErrorType(cue.error.message);
    if (eventErrorType === cueErrorType) {
      score += 0.5;
      reasons.push(`error type: ${eventErrorType}`);
    }
  }

  // File matching
  if (cue.error?.file) {
    if (
      event.context.files_involved
        .map(normalizeRecallPath)
        .includes(normalizeRecallPath(cue.error.file))
    ) {
      score += 0.3;
      reasons.push(`same file: ${cue.error.file}`);
    }
  }

  return { score, reasons };
}

// ============================================================
// Recall Function
// ============================================================

/**
 * Main recall function - find events matching a cue
 */
export function recallEvents(
  events: WolfEvent[],
  cue: Cue,
  request: RecallRequest,
  index: CueIndex
): RecallResponse {
  const limit = request.limit || 5;
  const offset = request.offset || 0;

  // Get candidate event IDs from index based on cue type
  let candidateIds: string[] = [];

  if (cue.type === "location") {
    candidateIds = getLocationCandidateIds(cue, index);
  } else if (cue.type === "question") {
    candidateIds = getQuestionCandidateIds(cue, index);
  } else if (cue.type === "state") {
    // State matching is content-based rather than keyed by the cue index.
    candidateIds = index.event_ids ?? events.map((event) => event.id);
  }

  // Load candidate events
  const eventMap = new Map(events.map((e) => [e.id, e]));
  let candidates = candidateIds
    .map((id) => eventMap.get(id))
    .filter((e): e is WolfEvent => e !== undefined);

  // Apply filters
  if (request.filters) {
    candidates = applyFilters(candidates, request.filters);
  }

  // Score and sort
  const scored = candidates
    .map((event) => {
      const cueMatched = cue.type !== "state" || scoreStateMatch(event, cue).score > 0;
      const { score, reasons } = scoreEvent(event, cue, request, index);
      return { event, score, reasons, cueMatched };
    })
    .filter(({ cueMatched }) => cueMatched);

  scored.sort((a, b) => b.score - a.score);

  // Apply offset and limit
  const paged = scored.slice(offset, offset + limit);

  // Build match details
  const matchDetails: MatchDetail[] = paged.map(({ event, score, reasons }) => ({
    event_id: event.id,
    confidence: Math.round(score * 100) / 100,
    match_reasons: reasons,
  }));

  // Calculate average confidence
  const avgConfidence =
    paged.length > 0
      ? paged.reduce((sum, { score }) => sum + score, 0) / paged.length
      : 0;

  return {
    events: paged.map(({ event }) => event),
    total_matches: scored.length,
    confidence: Math.round(avgConfidence * 100) / 100,
    match_details: matchDetails,
  };
}

// ============================================================
// Candidate ID Retrieval
// ============================================================

function getLocationCandidateIds(
  cue: LocationCue,
  index: CueIndex
): string[] {
  const cuePaths = (Array.isArray(cue.path) ? cue.path : [cue.path]).map(
    normalizeRecallPath
  );
  const matchMode = cue.match_mode || "exact";
  const ids = new Set<string>();

  switch (matchMode) {
    case "exact":
      for (const p of cuePaths) {
        const pathIds = index.location_index[p] || [];
        pathIds.forEach((id) => ids.add(id));
      }
      break;

    case "prefix":
      for (const p of cuePaths) {
        for (const [indexedPath, pathIds] of Object.entries(index.location_index)) {
          if (normalizeRecallPath(indexedPath).startsWith(p)) {
            pathIds.forEach((id) => ids.add(id));
          }
        }
      }
      break;

    case "glob":
      for (const pattern of cuePaths) {
        for (const [indexedPath, pathIds] of Object.entries(index.location_index)) {
          if (matchGlob(normalizeRecallPath(indexedPath), pattern)) {
            pathIds.forEach((id) => ids.add(id));
          }
        }
      }
      break;

    case "parent":
      for (const p of cuePaths) {
        const parents = getParentDirectories(p);
        for (const [indexedPath, pathIds] of Object.entries(index.location_index)) {
          const normalizedPath = normalizeRecallPath(indexedPath);
          if (parents.some((parent) => normalizedPath.startsWith(parent))) {
            pathIds.forEach((id) => ids.add(id));
          }
        }
      }
      break;

    case "sibling":
      for (const p of cuePaths) {
        const dir = getDirectory(p);
        for (const [indexedPath, pathIds] of Object.entries(index.location_index)) {
          if (getDirectory(indexedPath) === dir) {
            pathIds.forEach((id) => ids.add(id));
          }
        }
      }
      break;
  }

  return Array.from(ids);
}

function getQuestionCandidateIds(
  cue: QuestionCue,
  index: CueIndex
): string[] {
  const ids = new Set<string>();

  // Search by entities in tags
  if (cue.entities) {
    for (const entity of cue.entities) {
      const tagIds = index.tag_index[entity] || [];
      tagIds.forEach((id) => ids.add(id));
    }
  }

  // Search by question type in tags
  if (cue.question_type) {
    const typeIds = index.tag_index[cue.question_type] || [];
    typeIds.forEach((id) => ids.add(id));
  }

  return Array.from(ids);
}

// ============================================================
// Filters
// ============================================================

function applyFilters(
  events: WolfEvent[],
  filters: RecallRequest["filters"]
): WolfEvent[] {
  if (!filters) {
    return events;
  }

  return events.filter((event) => {
    // Valence filter
    if (filters.valence && filters.valence.length > 0) {
      if (!filters.valence.includes(event.outcome.valence)) {
        return false;
      }
    }

    // Min intensity filter
    if (
      filters.min_intensity !== undefined &&
      event.outcome.intensity < filters.min_intensity
    ) {
      return false;
    }

    // Max age filter
    if (filters.max_age_days !== undefined) {
      const eventAge = (Date.now() - new Date(event.timestamp).getTime()) / (1000 * 60 * 60 * 24);
      if (eventAge > filters.max_age_days) {
        return false;
      }
    }

    // Tags filter
    if (filters.tags && filters.tags.length > 0) {
      if (!filters.tags.some((tag) => event.tags.includes(tag))) {
        return false;
      }
    }

    // Exclude forgotten
    if (filters.exclude_forgotten !== false) {
      if (event.consolidation.forgotten) {
        return false;
      }
    }

    return true;
  });
}
