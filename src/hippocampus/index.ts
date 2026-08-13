// Hippocampus Memory System — Main Module

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type {
  WolfEvent,
  HippocampusStore,
  HippoStats,
  RecallFilters,
  RecallRequest,
  RecallResponse,
  CueIndex,
  ClaimIndex,
  ClaimObservation,
  ClaimRecallRequest,
  ClaimRecallResponse,
  ClaimStatus,
  ClaimStore,
  ClaimUpdateReport,
  MemoryClaim,
} from "./types.js";
import {
  createEmptyStore,
  loadStore,
  saveStore,
  addEventToStore,
  getTraumaEventsForPath,
  filterEvents,
} from "./event-store.js";
import { buildIndex, loadIndex, saveIndex, indexNeedsRebuild } from "./cue-index.js";
import { recallEvents } from "./cue-recall.js";
import {
  buildClaimIndex,
  claimIndexNeedsRebuild,
  loadClaimIndex,
  saveClaimIndex,
} from "./claim-index.js";
import {
  createEmptyClaimStore,
  loadClaimStore,
  saveClaimStore,
} from "./claim-store.js";
import {
  applyClaimObservation,
  recallClaims as recallMemoryClaims,
} from "./claims.js";
import {
  createEmptyNeocortex,
  loadNeocortex,
  saveNeocortex,
  runConsolidation,
  mergeEventsIntoNeocortex,
  enforceNeocortexSize,
  getNeocortexEvents,
  type NeocortexStore,
  type ConsolidationReport,
  type PendingLongTermTransfer,
} from "./consolidation.js";
import {
  HIPPOCAMPUS_HOOK_LOCK_BUDGET_MS,
  readJsonFile,
  writeJsonAtomic,
  withHippocampusLock,
} from "./persistence.js";

export type { NeocortexStore, ConsolidationReport };
export type {
  WolfEvent,
  HippocampusStore,
  HippoStats,
  RecallFilters,
  RecallRequest,
  RecallResponse,
  CueIndex,
  ClaimIndex,
  ClaimObservation,
  ClaimRecallRequest,
  ClaimRecallResponse,
  ClaimStatus,
  ClaimStore,
  ClaimUpdateReport,
  MemoryClaim,
};

interface StoreIndexSnapshot {
  store: HippocampusStore;
  index: CueIndex;
}

interface ClaimSnapshot {
  store: ClaimStore;
  index: ClaimIndex;
}

const ACTION_TYPES = new Set([
  "read", "write", "edit", "delete", "execute", "correct", "approve",
  "reject", "discover", "fix", "refactor",
]);
const VALENCES = new Set(["reward", "neutral", "penalty", "trauma"]);
const CONSOLIDATION_STAGES = new Set(["short-term", "consolidating", "long-term"]);
const EVENT_SOURCES = new Set(["hook", "daemon", "manual"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isTimestamp(value: unknown): value is string {
  return isString(value) && Number.isFinite(Date.parse(value));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function isWolfEvent(value: unknown): value is WolfEvent {
  if (!isRecord(value)) return false;
  const context = value.context;
  const action = value.action;
  const outcome = value.outcome;
  const consolidation = value.consolidation;
  if (!isRecord(context) || !isRecord(action) || !isRecord(outcome) || !isRecord(consolidation)) {
    return false;
  }

  return (
    isNonEmptyString(value.id) &&
    value.version === 1 &&
    isTimestamp(value.timestamp) &&
    isNonEmptyString(value.session_id) &&
    isString(context.project_root) &&
    isStringArray(context.files_involved) &&
    isString(context.cwd_at_time) &&
    typeof context.spatial_path === "string" &&
    Number.isInteger(context.spatial_depth) &&
    isTimestamp(context.session_start) &&
    Number.isInteger(context.turn_in_session) &&
    isOptionalString(context.current_goal) &&
    (context.recent_errors === undefined || isStringArray(context.recent_errors)) &&
    typeof action.type === "string" && ACTION_TYPES.has(action.type) &&
    isOptionalString(action.subtype) &&
    isString(action.description) &&
    typeof action.tokens_spent === "number" && Number.isFinite(action.tokens_spent) &&
    (action.files_modified === undefined || isStringArray(action.files_modified)) &&
    (action.files_read === undefined || isStringArray(action.files_read)) &&
    isOptionalBoolean(action.succeeded) &&
    isOptionalString(action.error_message) &&
    typeof outcome.valence === "string" && VALENCES.has(outcome.valence) &&
    typeof outcome.intensity === "number" && Number.isFinite(outcome.intensity) &&
    outcome.intensity >= 0 && outcome.intensity <= 1 &&
    isString(outcome.reflection) &&
    isOptionalBoolean(outcome.is_recurring) &&
    isOptionalString(outcome.first_event_id) &&
    isOptionalString(outcome.user_correction) &&
    typeof consolidation.stage === "string" && CONSOLIDATION_STAGES.has(consolidation.stage) &&
    typeof consolidation.access_count === "number" &&
    Number.isInteger(consolidation.access_count) && consolidation.access_count >= 0 &&
    isTimestamp(consolidation.last_accessed) &&
    typeof consolidation.consolidation_score === "number" &&
    Number.isFinite(consolidation.consolidation_score) &&
    typeof consolidation.should_consolidate === "boolean" &&
    typeof consolidation.decay_factor === "number" && Number.isFinite(consolidation.decay_factor) &&
    isTimestamp(consolidation.last_decay_check) &&
    isOptionalBoolean(consolidation.forgotten) &&
    (consolidation.forgotten_at === undefined || isTimestamp(consolidation.forgotten_at)) &&
    typeof value.source === "string" && EVENT_SOURCES.has(value.source) &&
    isStringArray(value.tags)
  );
}

function isPendingLongTermTransfer(value: unknown): value is PendingLongTermTransfer {
  return (
    isRecord(value) &&
    value.version === 1 &&
    isTimestamp(value.created_at) &&
    Array.isArray(value.events) &&
    value.events.length > 0 &&
    value.events.every(
      (event) => isWolfEvent(event) && event.consolidation.stage === "long-term"
    )
  );
}

export class Hippocampus {
  private projectRoot: string;
  private wolfDir: string;
  private hippocampusPath: string;
  private cueIndexPath: string;
  private neocortexPath: string;
  private transferJournalPath: string;
  private claimStorePath: string;
  private claimIndexPath: string;
  private store: HippocampusStore | null = null;
  private cueIndex: CueIndex | null = null;
  private neocortex: NeocortexStore | null = null;
  private claimStore: ClaimStore | null = null;
  private claimIndex: ClaimIndex | null = null;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.wolfDir = path.join(projectRoot, ".wolf");
    this.hippocampusPath = path.join(this.wolfDir, "hippocampus.json");
    this.cueIndexPath = path.join(this.wolfDir, "cue-index.json");
    this.neocortexPath = path.join(this.wolfDir, "neocortex.json");
    this.claimStorePath = path.join(this.wolfDir, "claims.json");
    this.claimIndexPath = path.join(this.wolfDir, "claim-index.json");
    this.transferJournalPath = path.join(
      this.wolfDir,
      "hippocampus-transfer.json"
    );
  }

  private loadStoreOrCreate(): HippocampusStore {
    return loadStore(this.hippocampusPath, true) ?? createEmptyStore(this.projectRoot);
  }

  private recoverPendingTransfer(
    store: HippocampusStore,
    neocortex: NeocortexStore
  ): boolean {
    if (!fs.existsSync(this.transferJournalPath)) return false;
    const pending = readJsonFile<PendingLongTermTransfer>(
      this.transferJournalPath,
      false
    );
    if (!pending || !isPendingLongTermTransfer(pending)) {
      throw new Error("Invalid hippocampus transfer journal");
    }

    mergeEventsIntoNeocortex(neocortex, pending.events);
    enforceNeocortexSize(neocortex);
    saveNeocortex(this.neocortexPath, neocortex);

    const pendingIds = new Set(pending.events.map((event) => event.id));
    store.buffer = store.buffer.filter((event) => !pendingIds.has(event.id));
    const index = buildIndex(store.buffer);
    saveStore(this.hippocampusPath, store);
    saveIndex(this.cueIndexPath, index);
    fs.unlinkSync(this.transferJournalPath);
    return true;
  }

  private loadNeocortexOrCreate(): NeocortexStore {
    return loadNeocortex(this.neocortexPath, true) ?? createEmptyNeocortex(this.projectRoot);
  }

  private loadClaimStoreOrCreate(): ClaimStore {
    return loadClaimStore(this.claimStorePath, true) ?? createEmptyClaimStore(this.projectRoot);
  }

  private findEvidenceEvent(
    store: HippocampusStore,
    neocortex: NeocortexStore,
    eventId: string
  ): WolfEvent | null {
    const shortTerm = store.buffer.find((event) => event.id === eventId);
    if (shortTerm) return shortTerm;
    return neocortex.events.find((event) => event.id === eventId) ?? null;
  }

  private ensureClaimSnapshot(): ClaimSnapshot {
    const diskStore = loadClaimStore(this.claimStorePath);
    const diskIndex = loadClaimIndex(this.claimIndexPath);
    if (diskStore && !claimIndexNeedsRebuild(diskIndex, diskStore.claims)) {
      this.claimStore = diskStore;
      this.claimIndex = diskIndex!;
      return { store: diskStore, index: diskIndex! };
    }

    const repaired = withHippocampusLock(
      this.wolfDir,
      HIPPOCAMPUS_HOOK_LOCK_BUDGET_MS,
      () => {
        const store = this.loadClaimStoreOrCreate();
        const loadedIndex = loadClaimIndex(this.claimIndexPath, true);
        const index = claimIndexNeedsRebuild(loadedIndex, store.claims)
          ? buildClaimIndex(store.claims)
          : loadedIndex!;
        if (!fs.existsSync(this.claimStorePath)) saveClaimStore(this.claimStorePath, store);
        if (index !== loadedIndex) saveClaimIndex(this.claimIndexPath, index);
        return { store, index };
      }
    );
    if (!repaired) throw new Error("Could not repair claim index within lock budget");
    this.claimStore = repaired.store;
    this.claimIndex = repaired.index;
    return repaired;
  }

  private ensureLoaded(): HippocampusStore {
    const existing = loadStore(this.hippocampusPath);
    if (existing) {
      this.store = existing;
      return existing;
    }

    const initialized = withHippocampusLock(
      this.wolfDir,
      HIPPOCAMPUS_HOOK_LOCK_BUDGET_MS,
      () => {
        const store = this.loadStoreOrCreate();
        const loadedIndex = loadIndex(this.cueIndexPath, true);
        const index = indexNeedsRebuild(loadedIndex, store.buffer)
          ? buildIndex(store.buffer)
          : loadedIndex!;
        saveStore(this.hippocampusPath, store);
        if (index !== loadedIndex) saveIndex(this.cueIndexPath, index);
        return { store, index };
      }
    );
    if (!initialized) throw new Error("Could not acquire hippocampus lock");
    this.store = initialized.store;
    this.cueIndex = initialized.index;
    return this.store;
  }

  private ensureConsistentSnapshot(): StoreIndexSnapshot {
    const diskStore = loadStore(this.hippocampusPath);
    const diskIndex = loadIndex(this.cueIndexPath);
    if (diskStore && !indexNeedsRebuild(diskIndex, diskStore.buffer)) {
      this.store = diskStore;
      this.cueIndex = diskIndex!;
      return { store: diskStore, index: diskIndex! };
    }

    const repaired = withHippocampusLock(
      this.wolfDir,
      HIPPOCAMPUS_HOOK_LOCK_BUDGET_MS,
      () => {
        const store = this.loadStoreOrCreate();
        const loadedIndex = loadIndex(this.cueIndexPath, true);
        const index = indexNeedsRebuild(loadedIndex, store.buffer)
          ? buildIndex(store.buffer)
          : loadedIndex!;
        if (index !== loadedIndex) saveIndex(this.cueIndexPath, index);
        if (!fs.existsSync(this.hippocampusPath)) saveStore(this.hippocampusPath, store);
        return { store, index };
      }
    );
    if (!repaired) throw new Error("Could not repair cue index within lock budget");
    this.store = repaired.store;
    this.cueIndex = repaired.index;
    return repaired;
  }

  private ensureNeocortexLoaded(): NeocortexStore {
    const loaded = loadNeocortex(this.neocortexPath);
    if (loaded) {
      this.neocortex = loaded;
      return loaded;
    }

    const initialized = withHippocampusLock(
      this.wolfDir,
      HIPPOCAMPUS_HOOK_LOCK_BUDGET_MS,
      () => {
        const store = this.loadNeocortexOrCreate();
        saveNeocortex(this.neocortexPath, store);
        return store;
      }
    );
    if (!initialized) throw new Error("Could not initialize neocortex within lock budget");
    this.neocortex = initialized;
    return initialized;
  }

  /** Add a new event under the store/index transaction lock. */
  addEvent(eventData: Omit<WolfEvent, "id" | "consolidation">): WolfEvent {
    const event: WolfEvent = {
      ...eventData,
      id: `evt-${crypto.randomUUID()}`,
      consolidation: {
        stage: "short-term",
        access_count: 0,
        last_accessed: eventData.timestamp,
        consolidation_score: 0,
        should_consolidate: false,
        decay_factor: 1.0,
        last_decay_check: eventData.timestamp,
      },
    };

    const updated = withHippocampusLock(
      this.wolfDir,
      HIPPOCAMPUS_HOOK_LOCK_BUDGET_MS,
      () => {
        const store = this.loadStoreOrCreate();
        const neocortex = this.loadNeocortexOrCreate();
        this.recoverPendingTransfer(store, neocortex);
        // Load the existing index so corrupt data is preserved before replacement.
        loadIndex(this.cueIndexPath, true);
        addEventToStore(store, event);
        const index = buildIndex(store.buffer);
        saveStore(this.hippocampusPath, store);
        saveIndex(this.cueIndexPath, index);
        return { store, index };
      }
    );
    if (!updated) throw new Error("Could not add hippocampus event within lock budget");
    this.store = updated.store;
    this.cueIndex = updated.index;
    return event;
  }

  /**
   * Batch-insert many events under a single store/index transaction lock.
   *
   * The lock-and-fsync cost per event is ~16 ms on Windows (writeJsonAtomic
   * renames a temp file). Single-event `addEvent` therefore costs O(N) fsyncs
   * for N events; `addMany` costs O(1) — one lock, one store save, one index
   * rebuild + save, regardless of batch size.
   *
   * Atomicity is preserved: the batch is all-or-nothing from the reader's
   * perspective. Either every event in the batch is visible in the next
   * `recall` call, or none of them are (if the lock budget expires the
   * batch is rejected).
   */
  addMany(
    eventsData: ReadonlyArray<Omit<WolfEvent, "id" | "consolidation">>
  ): WolfEvent[] {
    if (eventsData.length === 0) return [];

    const events: WolfEvent[] = eventsData.map((eventData) => ({
      ...eventData,
      id: `evt-${crypto.randomUUID()}`,
      consolidation: {
        stage: "short-term",
        access_count: 0,
        last_accessed: eventData.timestamp,
        consolidation_score: 0,
        should_consolidate: false,
        decay_factor: 1.0,
        last_decay_check: eventData.timestamp,
      },
    }));

    const updated = withHippocampusLock(
      this.wolfDir,
      HIPPOCAMPUS_HOOK_LOCK_BUDGET_MS,
      () => {
        const store = this.loadStoreOrCreate();
        const neocortex = this.loadNeocortexOrCreate();
        this.recoverPendingTransfer(store, neocortex);
        // Load the existing index so corrupt data is preserved before replacement.
        loadIndex(this.cueIndexPath, true);
        for (const event of events) addEventToStore(store, event);
        const index = buildIndex(store.buffer);
        saveStore(this.hippocampusPath, store);
        saveIndex(this.cueIndexPath, index);
        return { store, index };
      }
    );
    if (!updated) throw new Error("Could not add hippocampus batch within lock budget");
    this.store = updated.store;
    this.cueIndex = updated.index;
    return events;
  }

  getTraumas(filePath?: string): WolfEvent[] {
    const store = this.ensureLoaded();
    if (filePath) return getTraumaEventsForPath(store, filePath.replace(/\\/g, "/"));
    return store.buffer.filter((event) => event.outcome.valence === "trauma");
  }

  getRecentEvents(limit: number = 10): WolfEvent[] {
    const store = this.ensureLoaded();
    return [...store.buffer]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  getEvents(filters?: RecallFilters): WolfEvent[] {
    const store = this.ensureLoaded();
    if (!filters) return store.buffer;
    return filterEvents(store, filters);
  }

  recall(request: RecallRequest): RecallResponse {
    const { store, index } = this.ensureConsistentSnapshot();
    return recallEvents(store.buffer, request.cue, request, index);
  }

  recordClaimObservation(observation: ClaimObservation): ClaimUpdateReport {
    const updated = withHippocampusLock(
      this.wolfDir,
      HIPPOCAMPUS_HOOK_LOCK_BUDGET_MS,
      () => {
        const eventStore = this.loadStoreOrCreate();
        const neocortex = this.loadNeocortexOrCreate();
        this.recoverPendingTransfer(eventStore, neocortex);
        const claimStore = this.loadClaimStoreOrCreate();
        loadClaimIndex(this.claimIndexPath, true);
        if (!this.findEvidenceEvent(eventStore, neocortex, observation.event_id)) {
          throw new Error(`Evidence event not found: ${observation.event_id}`);
        }
        const report = applyClaimObservation(claimStore, observation);
        const index = buildClaimIndex(claimStore.claims);
        saveClaimStore(this.claimStorePath, claimStore);
        saveClaimIndex(this.claimIndexPath, index);
        return { store: claimStore, index, report };
      }
    );
    if (!updated) throw new Error("Could not update claim store within lock budget");
    this.claimStore = updated.store;
    this.claimIndex = updated.index;
    return updated.report;
  }

  getClaims(filters?: { statuses?: ClaimStatus[] }): MemoryClaim[] {
    const { store } = this.ensureClaimSnapshot();
    const statuses = filters?.statuses;
    return store.claims
      .filter((claim) => !statuses || statuses.includes(claim.status))
      .map((claim) => structuredClone(claim));
  }

  recallClaims(request: ClaimRecallRequest): ClaimRecallResponse {
    const { store } = this.ensureClaimSnapshot();
    return recallMemoryClaims(store.claims, request);
  }

  claimsExist(): boolean {
    return fs.existsSync(this.claimStorePath);
  }

  consolidate(options?: { maxToPromote?: number }): ConsolidationReport {
    const updated = withHippocampusLock(
      this.wolfDir,
      HIPPOCAMPUS_HOOK_LOCK_BUDGET_MS,
      () => {
        const store = this.loadStoreOrCreate();
        const neocortex = this.loadNeocortexOrCreate();
        this.recoverPendingTransfer(store, neocortex);
        const beforeEvents = new Map(
          store.buffer.map((event) => [event.id, structuredClone(event)])
        );
        const report = runConsolidation(store, neocortex, {
          maxToPromote: options?.maxToPromote ?? 50,
        });
        const transfers = report.transferred_event_ids
          .map((eventId) => beforeEvents.get(eventId))
          .filter((event): event is WolfEvent => event !== undefined)
          .map((event) => ({
            ...event,
            consolidation: {
              ...event.consolidation,
              stage: "long-term" as const,
            },
          }));
        const index = buildIndex(store.buffer);

        if (transfers.length > 0) {
          const pending: PendingLongTermTransfer = {
            version: 1,
            created_at: new Date().toISOString(),
            events: transfers,
          };
          writeJsonAtomic(this.transferJournalPath, pending);
          mergeEventsIntoNeocortex(neocortex, transfers);
        }

        enforceNeocortexSize(neocortex);
        saveNeocortex(this.neocortexPath, neocortex);
        report.new_neocortex_size = neocortex.size_bytes;
        saveStore(this.hippocampusPath, store);
        saveIndex(this.cueIndexPath, index);
        if (transfers.length > 0) fs.unlinkSync(this.transferJournalPath);
        return { store, index, neocortex, report };
      }
    );
    if (!updated) throw new Error("Could not consolidate within hippocampus lock budget");
    this.store = updated.store;
    this.cueIndex = updated.index;
    this.neocortex = updated.neocortex;
    return updated.report;
  }

  getLongTermMemory(filters?: {
    valence?: string[];
    minIntensity?: number;
    limit?: number;
  }): WolfEvent[] {
    return getNeocortexEvents(this.ensureNeocortexLoaded(), filters);
  }

  getNeocortexStats(): {
    total_consolidated: number;
    by_valence: Record<string, number>;
    last_consolidation: string | null;
  } {
    const neocortex = this.ensureNeocortexLoaded();
    return {
      total_consolidated: neocortex.stats.total_consolidated,
      by_valence: { ...neocortex.stats.by_valence },
      last_consolidation: neocortex.stats.last_consolidation,
    };
  }

  neocortexExists(): boolean {
    return fs.existsSync(this.neocortexPath);
  }

  getStats(): HippoStats {
    const store = this.ensureLoaded();
    const neocortex = this.ensureNeocortexLoaded();
    return {
      total_events: store.stats.total_events,
      buffer_size: store.buffer.length,
      trauma_count: store.stats.trauma_count,
      reward_count: store.stats.reward_count,
      penalty_count: store.stats.penalty_count,
      neutral_count: store.stats.neutral_count,
      last_consolidation: neocortex.stats.last_consolidation,
    };
  }

  exists(): boolean {
    return fs.existsSync(this.hippocampusPath);
  }
}

export function createHippocampus(projectRoot: string): Hippocampus {
  return new Hippocampus(projectRoot);
}
