# Hippocampus storage and locking

## Files on disk

A project's episodic memory is stored under `.wolf/`:

| File | Purpose |
| --- | --- |
| `hippocampus.json` | Short-term and consolidating event buffer, statistics, and limits. |
| `cue-index.json` | Derived lookup maps for event locations, tags, trauma, and the complete buffer event-ID watermark. |
| `neocortex.json` | Long-term events moved by consolidation. |
| `hippocampus-transfer.json` | Temporary replay journal while a long-term transfer is committed; normally absent. |
| `hippocampus.lock` | Temporary cross-process ownership record during a mutation or repair. |

The cue index is derived data. The event buffer is authoritative when the two disagree.

## Lock ownership

The lock is acquired by atomically creating the `.wolf/hippocampus.lock` directory. Only one competing process can create it. While held, the directory contains an informational `owner.json` file:

```json
{
  "pid": 12345,
  "acquired_at": 1786406400000,
  "owner_token": "0f1e2d3c4b5a69788796a5b4"
}
```

`acquired_at` is Unix epoch milliseconds. The owner token is a random diagnostic value unique to that acquisition.

Release removes `owner.json` and then removes the now-empty lock directory. The directory name cannot be replaced while it is non-empty, so release cannot remove a later owner's lock generation.

## Abandoned-lock behavior

Hook operations wait for at most five seconds. Lock acquisition then returns failure rather than waiting forever. Mutation APIs report that failure to their caller, while hook integration catches it so memory maintenance cannot break the user's main tool operation.

The runtime deliberately does not auto-delete an abandoned lock directory. Portable Node filesystem APIs do not provide an atomic “delete only if this is still the generation I inspected” operation; a stale-file reclaimer can otherwise delete a replacement lock and admit concurrent writers. A process killed while holding the lock therefore requires explicit removal of `.wolf/hippocampus.lock` after confirming no OpenWolf process is using the project. This favors data integrity over unattended recovery.

## Atomic JSON replacement

Each JSON write uses a unique hidden sibling temporary file:

1. Create the temporary file exclusively.
2. Write formatted JSON and a final newline.
3. Flush the file descriptor with `fsync`.
4. Close the descriptor.
5. Rename the temporary file over the canonical file.
6. Remove a leftover temporary file if any step fails.

The canonical file is never moved away or truncated first. Readers therefore observe the previous complete document or the replacement complete document rather than a deliberate missing-file interval.

This relies on normal local-filesystem rename semantics. It is not a distributed transaction mechanism for network filesystems.

## Logical store/index transactions

An event append is performed under one lock:

```text
lock
  load latest hippocampus.json
  inspect/recover existing cue-index.json
  append event and enforce buffer limits
  rebuild complete cue index from resulting buffer
  atomically save hippocampus.json
  atomically save cue-index.json
unlock
```

Consolidation follows the same lock discipline and uses a small `hippocampus-transfer.json` journal for long-term moves. A qualifying transfer is journaled, merged idempotently into `neocortex.json`, and only then removed from `hippocampus.json`; the journal is deleted after the store and cue index are committed. The journal contains complete events and is fully shape-checked before either store is mutated. Invalid journals remain in place as diagnostic evidence and block the mutation rather than risking source-event loss. If a process stops between valid transfer steps, the next event write or consolidation replays the journal by event ID before continuing.

The human-facing consolidation result list is capped at 100 entries, but transfers are tracked separately through a complete internal event-ID list. A promotion beyond that presentation cap is therefore still journaled and persisted. `neocortex.json` is saved on every consolidation pass so `last_consolidation` remains durable even when no event transfers. Size limits are recalculated and enforced after current-pass transfers merge, and the returned report records the final persisted size.

Each file replacement is atomic, but the set of two or three files is a logical transaction, not one filesystem-level atomic commit. A crash after saving the store but before saving the index can leave the index behind. That failure is expected and repairable because recall compares the entire index with the current store and rebuilds it under the lock. Long-term event transfer uses the separate journal described above so this limitation cannot leave a promoted event absent from both stores.

## Cue-index drift detection

A complete rebuilt index contains:

```json
{
  "version": 1,
  "last_updated": "2026-08-11T12:34:56.789Z",
  "event_ids": ["evt-example"],
  "location_index": { "src/example.ts": ["evt-example"] },
  "tag_index": { "file-write": ["evt-example"] },
  "trauma_index": {
    "all_trauma_ids": [],
    "by_path": {}
  }
}
```

`last_updated` uses an ISO 8601 UTC timestamp. Drift checks compare event-ID sets and every derived map. They detect:

- a missing event;
- an extra or evicted event;
- a partially updated path or tag;
- incorrect trauma entries;
- an old index without `event_ids`;
- a missing, malformed, or corrupt index.

Recall reloads both documents from disk. If drift exists, it acquires the lock, reloads again to avoid repairing an obsolete snapshot, and saves a rebuilt index.

## Corrupt-document recovery

Parsing alone is read-only by default. Destructive recovery occurs only inside an acquired hippocampus transaction. The corrupt canonical file is copied to a uniquely suffixed backup before OpenWolf removes it and creates replacement state.

Examples:

```text
hippocampus.corrupt-2026-08-11T03-00-00-000Z-a1b2c3d4.json
cue-index.corrupt-2026-08-11T03-00-00-000Z-e5f60718.json
```

The timestamp is an ISO UTC time made filename-safe by replacing colons and the decimal point with hyphens. A random suffix prevents collisions. These backups are evidence for diagnosis and are not automatically deleted.

## Buffer eviction and consolidation

After an append, the store enforces `max_buffer_size` by removing the oldest non-trauma entries first. The cue index is built after eviction, so evicted IDs cannot remain searchable.

Consolidation is locked and staged:

- short-term events may advance to `consolidating`;
- an event newly advanced in a pass is not also moved to long-term in that same pass;
- a later pass may move qualifying consolidating events into `neocortex.json`;
- forgotten or moved events are removed before the cue index is rebuilt.

## Anatomy lock follow-up

The full parallel test suite exposed a race in the pre-existing anatomy lock's stale-file reclamation. The anatomy lock now uses the same atomically created, non-empty lock-directory design. Its public API is unchanged. An abandoned anatomy lock also times out safely and requires explicit cleanup after confirming no writer is active.

Both the canonical hook implementation and the separately shipped OpenCode template now use this protocol. Anatomy JSON and rendered Markdown also use exclusive sibling temporary files, `fsync`, close, and rename replacement; they no longer fall back to directly truncating the canonical files when a rename fails.
