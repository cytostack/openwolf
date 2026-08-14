# Hippocampus path safety and recall

## The Windows cross-drive problem

A common project-boundary check is:

```ts
const relative = path.relative(projectRoot, filePath);
if (relative.startsWith("..")) reject();
```

That is not sufficient on Windows. If the project is on `D:` and a tool accesses an absolute file on `C:`, `path.relative()` can return a drive-qualified path rather than one beginning with `..`. The old hook could then record a Claude memory file or other external path in the project's anatomy and hippocampus.

The same style of check also needs to distinguish a real child from a similarly prefixed sibling such as:

```text
D:\work\openwolf
D:\work\openwolf-other
```

## Canonical containment check

`resolveProjectPath(projectRoot, filePath)` is now the common boundary for relevant hooks. It returns:

```ts
{
  absolutePath: string;
  relativePath: string;
}
```

or `null` when the path is not inside the project.

The resolver:

1. Detects drive-letter and UNC-style Windows roots.
2. Uses `path.win32` for Windows-style paths even if a test is running on another host platform.
3. Resolves a relative tool path against the project root.
4. Compares filesystem root names, case-insensitively for Windows.
5. Computes the relative path.
6. Rejects an absolute relative result, exact `..`, or a path beginning with a complete `..` segment.
7. Returns a forward-slash project-relative path.

Representative behavior:

| Project root | Tool path | Result |
| --- | --- | --- |
| `D:\work\openwolf` | `src\hooks\shared.ts` | `src/hooks/shared.ts` |
| `D:\work\openwolf` | `C:\Users\dev\memory.md` | rejected |
| `D:\work\openwolf` | `..\outside.ts` | rejected |
| `D:\work\openwolf` | `D:\work\openwolf-other\file.ts` | rejected |

## Hook behavior

### Post-write

Containment is checked before all durable project work. An outside file does not update:

- `anatomy-index.json` or `anatomy.md`;
- `memory.md`;
- the session tracker;
- `buglog.json`; or
- hippocampus events.

Files inside `.wolf/` are also excluded to avoid self-referential memory updates. Secret-bearing basenames and extensions still pass through the existing `isSensitiveFile()` rejection.

### Pre-read

An outside file is not added to read-session tracking, does not affect anatomy hit/miss statistics, and does not trigger project hippocampus trauma recall. In-project paths use one canonical relative representation for exact and related recall.

### Pre-write

The hippocampus warning check ignores an outside path. Cerebrum text checks and bug-pattern checks remain separate policy checks, but the external file cannot be treated as a project hippocampus location.

## Recall path normalization

Cue-index construction and recall use the same canonicalizer and `/` as their internal separator. It accepts both slash styles while preserving root identity:

- `/src/auth/file.ts` stays an absolute Unix-style path.
- `D:\work\file.ts` becomes `D:/work/file.ts`.
- `src\feature\file.ts` becomes `src/feature/file.ts`.
- redundant separators and `.` segments are removed;
- `..` resolves within the parsed path without crossing above its root.

Preserving roots is important for compatibility with older absolute-path events and the historical recall tests.

## Location match modes

### Exact

The normalized cue path is looked up directly in `location_index`.

### Prefix

Every indexed file path is scanned for the normalized prefix.

### Glob

Normalized indexed paths are tested against the requested `*`, `**`, and `?` pattern.

### Sibling

Indexed files whose normalized directory equals the cue directory are candidates.

### Parent

The index contains file keys, not directory keys. Parent recall therefore:

1. Builds the cue's parent directory prefixes.
2. Scans indexed file paths.
3. Selects events whose indexed path starts with any parent prefix.

For `src/feature/new.ts`, an event involving `src/feature/old.ts` is now a candidate. This also works when the cue is written as `src\feature\new.ts`.

## Read-ledger path identity

Pre-read and post-read resolve tool paths through the same containment helper and key session statistics by the same canonical absolute path. Relative paths, dot segments, separator differences, and drive-letter case therefore cannot split one filesystem read across duplicate token-ledger entries.

## State cues

State matching is content-based rather than directly keyed by location or tag. Candidate selection uses the complete `event_ids` watermark (falling back to the event list for compatibility), then calculates actual state matches such as error type and file.

An event receives recency or intensity scoring only after it is considered, but it is excluded from the response unless the state cue itself matched. This prevents recent unrelated events from appearing as state recall results.

## Past-learning output

The post-write hook performs recall before appending the current write event. Therefore all returned events are already past events. Generated event IDs normally begin with `evt-`; the prior code mistakenly discarded precisely those IDs.

The hook now displays up to two returned reward or trauma learnings when the same file has been edited repeatedly. A subprocess regression test seeds a learning for a neighboring file and verifies that the hook prints its reflection.

## Regression coverage

`tests/hook-path-safety.test.ts` covers:

- Windows relative paths and slash normalization;
- cross-drive rejection;
- parent escapes;
- similarly prefixed sibling roots; and
- native absolute path containment.

`tests/hippocampus-hardening.test.ts` additionally executes the compiled post-write hook and verifies that an external absolute path leaves memory, session data, and hippocampus untouched. It also verifies Windows-style parent cues and state-match filtering.
