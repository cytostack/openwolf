# Hippocampus hardening overview

## Why this work was needed

The hippocampus feature already captured episodic events, indexed cues, recalled related events, and consolidated durable learnings. Dogfooding the repository exposed several reliability gaps around those features:

- A hook running for a project on `D:` could treat an unrelated absolute file on `C:` as project-relative data.
- Hook invocations are separate processes, so a process-local "save the index every ten events" counter rarely reached ten. The event store grew while the cue index stayed behind.
- Two hook processes could read the same store and overwrite one another's updates.
- Direct JSON writes could leave truncated files if a process stopped during a write.
- A stale or legacy cue index could silently omit valid memories.
- Parent-location recall looked up directory keys even though the index contains file-path keys.
- The post-write hook filtered out every normal `evt-*` past learning.

This hardening pass treats the hippocampus store and cue index as durable, concurrent process state rather than in-process caches.

## What changed

### Project boundaries

A shared path resolver now decides whether a tool path belongs to the active project. It uses Windows path semantics for drive-letter and UNC roots, verifies path roots, rejects absolute relative results and parent escapes, and returns a canonical forward-slash relative path.

The pre-read, pre-write hippocampus check, and post-write hooks use this boundary. An external file is ignored before it can enter anatomy, session tracking, memory, buglog, or hippocampus data. Existing sensitive-file filtering remains in place.

### Durable writes and concurrency

Hippocampus mutations use a dedicated `.wolf/hippocampus.lock`. A mutation now follows this sequence:

1. Acquire the cross-process lock.
2. Reload the latest documents from disk.
3. Apply the mutation or consolidation.
4. Build a complete cue index from the resulting buffer.
5. Atomically replace the JSON documents.
6. Release the lock only if this process still owns it.

A unique sibling temporary file is fully written and synced before rename. The canonical file is never deliberately removed first, so readers see either the old complete document or the new complete document.

### Store and index consistency

The cue index now contains a complete `event_ids` watermark. Drift detection compares:

- all event IDs;
- location keys and IDs;
- tag keys and IDs;
- all trauma IDs; and
- trauma IDs by path.

Every event write and consolidation rebuilds the index from the current store. Recall detects and repairs missing, extra, partial, malformed, corrupt, or legacy indexes. Corrupt JSON is preserved with a `.corrupt-<timestamp>-<random>.json` name before a fresh document is installed.

The store and index are separate files, so they cannot form one filesystem-level atomic commit. A crash between their renames can temporarily leave drift. The next recall detects the complete mismatch and repairs the index under the same lock. Transfers from hippocampus to neocortex additionally use an idempotent replay journal, preventing an interrupted consolidation from losing an event between the two stores.

### Recall repairs

Stored and requested paths are normalized independently of the host operating system while preserving Unix roots and Windows drive roots. Parent recall scans indexed file paths beneath the cue's parent directories instead of trying to find directory keys that do not exist. State recall scans the complete event watermark and discards events with no actual state match.

The post-write hook now surfaces returned past events directly. Recall occurs before the new event is stored, so every result is already a past learning; filtering out IDs beginning with `evt-` had removed all real results.

### Consolidation and cache behavior

Consolidation runs under the hippocampus lock and persists a rebuilt cue index after events are moved or forgotten. Newly promoted short-term events remain in the consolidating stage until a later pass rather than traversing both stages in one pass. Long-term transfer IDs are retained separately from the 100-entry presentation report, pending journals receive full event-shape validation before replay, and neocortex metadata is saved even on passes with no transfers.

Public reads reload persisted store data instead of indefinitely trusting a process-local snapshot. This matters for daemons or other longer-lived consumers while preserving the short-lived hook behavior.

## Main implementation files

- `src/hippocampus/persistence.ts` — lock, corrupt-file backup, JSON reads, atomic writes.
- `src/hippocampus/index.ts` — locked event and consolidation transactions plus index repair.
- `src/hippocampus/cue-index.ts` — complete index construction and drift detection.
- `src/hippocampus/cue-recall.ts` — host-independent path and candidate matching.
- `src/hooks/shared.ts` — project containment resolver.
- `src/hooks/pre-read.ts`, `pre-write.ts`, and `post-write.ts` — boundary use and hook integration.
- `tests/hippocampus-hardening.test.ts` and `tests/hook-path-safety.test.ts` — regression coverage.

## Operational result

The normal application API and JSON formats remain version 1. The new optional `event_ids` field lets old cue indexes load for diagnosis, but an index without it is considered legacy and is rebuilt. No migration command is required: normal recall or the next event transaction converges the persisted state.
