import type { WolfEvent } from "./types.js";

/** Collapse one event to a compact trajectory signature. */
export function eventSignature(event: WolfEvent): string {
  return `${event.action.type}:${event.outcome.valence}`;
}

/**
 * Group events by session and produce each session's ordered signature
 * sequence (oldest first). Order is reconstructed from `timestamp` because
 * `turn_in_session` is not populated yet.
 */
export function buildTrajectoryIndex(events: WolfEvent[]): Map<string, string[]> {
  const bySession = new Map<string, WolfEvent[]>();
  for (const event of events) {
    const list = bySession.get(event.session_id);
    if (list) list.push(event);
    else bySession.set(event.session_id, [event]);
  }

  const index = new Map<string, string[]>();
  for (const [sessionId, list] of bySession) {
    list.sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    index.set(sessionId, list.map(eventSignature));
  }
  return index;
}

export interface TrajectoryPrediction {
  matched: boolean;
  next_signature: string | null;
  distribution: Record<string, number>;
  bad_ratio: number;
  samples: number;
}

const BAD_VALENCES = new Set(["penalty", "trauma"]);

function isBad(signature: string): boolean {
  const valence = signature.slice(signature.lastIndexOf(":") + 1);
  return BAD_VALENCES.has(valence);
}

/**
 * Match the recent suffix against every historical sequence and return the
 * distribution of "what came next". The caller applies the warn threshold
 * (samples and bad_ratio); this function stays a pure prediction.
 */
export function matchTrajectory(
  recentSignatures: string[],
  index: Map<string, string[]>,
  k = 3
): TrajectoryPrediction {
  const suffix = recentSignatures.slice(-k);
  if (suffix.length === 0) {
    return {
      matched: false,
      next_signature: null,
      distribution: {},
      bad_ratio: 0,
      samples: 0,
    };
  }

  const distribution: Record<string, number> = {};
  let samples = 0;

  for (const sequence of index.values()) {
    for (let i = 0; i + suffix.length <= sequence.length; i++) {
      let match = true;
      for (let j = 0; j < suffix.length; j++) {
        if (sequence[i + j] !== suffix[j]) {
          match = false;
          break;
        }
      }
      if (!match) continue;
      const next = sequence[i + suffix.length];
      if (next === undefined) continue;
      distribution[next] = (distribution[next] ?? 0) + 1;
      samples++;
    }
  }

  let bad = 0;
  for (const [signature, count] of Object.entries(distribution)) {
    if (isBad(signature)) bad += count;
  }

  const next =
    samples > 0
      ? Object.entries(distribution).sort((a, b) => b[1] - a[1])[0][0]
      : null;

  return {
    matched: samples > 0,
    next_signature: next,
    distribution,
    bad_ratio: samples > 0 ? bad / samples : 0,
    samples,
  };
}
