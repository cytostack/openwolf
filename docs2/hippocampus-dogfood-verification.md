# Hippocampus dogfood verification

## Purpose

This repository is used as its own active OpenWolf installation. The verification goal is not only to compile the TypeScript source, but to confirm that the generated `.wolf` runtime contains the same hardening code and behaves correctly when invoked as real hook processes.

Verification date: **2026-08-11**

Branch: **`feat/hippocampus-hardening`**

## Automated validation

### Production build

Command:

```bash
pnpm build
```

Result: **passed**.

This completed:

- main TypeScript compilation;
- standalone hook and hippocampus runtime compilation; and
- Vite dashboard production build.

### Main test suite

Command:

```bash
pnpm test
```

Final result:

```text
tests 51
suites 15
pass 51
fail 0
cancelled 0
skipped 0
todo 0
```

The hardening and project-path suites now contribute 25 tests. In addition to concurrency, drift, recovery, recall, and hook cases, the final audit added coverage for malformed nested cue-index maps, shared dot-segment canonicalization, bounded consolidation promotions, replay and validation of interrupted long-term transfers, transfers beyond the 100-result presentation cap, no-transfer consolidation metadata, current-pass neocortex size enforcement, canonical pre/post-read ledger keys, atomic anatomy replacement, the OpenCode directory-lock template, and safe timeout on abandoned lock directories.

- eight concurrent hippocampus writer processes with no lost event;
- matching store and cue-index event-ID sets;
- missing, extra, partial, and legacy index drift;
- recall-driven persisted index repair;
- corrupt store and index backups;
- max-buffer eviction without stale cue IDs;
- safe timeout when a lock directory is abandoned;
- actual consolidation transfer into neocortex;
- Windows-style parent recall;
- state recall excluding unrelated events;
- post-write ignoring an external absolute path; and
- post-write displaying a seeded past learning.

During full-suite validation, the existing anatomy concurrent-writer test exposed a stale-file reclamation race. Both anatomy and hippocampus now use atomically created, non-empty lock directories, avoiding check-then-delete of a replaceable lock pathname.

### Historical hippocampus tests

The phase 1 and phase 2 historical TypeScript tests were run against the compiled `dist/src/hippocampus` modules because their source-relative `.js` imports are not directly executable from the TypeScript source tree.

Results:

| Suite | Result |
| --- | ---: |
| Phase 1 event store (`T3`) | 41 passed |
| Phase 1 hippocampus (`T4`) | 29 passed |
| Phase 2 recall (`T10`) | 59 passed |
| Phase 2 cue index (`T9`) | 37 passed |

The phase 3 historical tests use dynamic Windows paths that need conversion to `file://` URLs. They were run from temporary copies with only that test-harness conversion:

| Suite | Result |
| --- | ---: |
| Consolidation (`T13`) | 6 passed |
| Decay (`T14`) | 10 passed |
| Neocortex (`T15`) | 9 passed |

No temporary test copies were retained.

### Documentation build and whitespace

Commands:

```bash
pnpm docs:build
git diff --check
```

Results: **both passed**. Git printed only the repository's Windows line-ending warnings for `src/hippocampus/index.ts` and `src/hooks/anatomy-lock.ts`; no whitespace error was reported.

## Runtime refresh

The source repository is intentionally excluded from normal `openwolf update` registration. The refresh procedure is therefore:

```bash
pnpm build
node dist/bin/openwolf.js init --agent claude
```

Re-initialization preserves user data files while replacing hook scripts, the generated hippocampus runtime, protocol files, and Claude hook settings.

The installed runtime must include:

```text
.wolf/hooks/post-write.js
.wolf/hooks/pre-read.js
.wolf/hooks/pre-write.js
.wolf/hooks/shared.js
.wolf/hippocampus/index.js
.wolf/hippocampus/persistence.js
.wolf/hippocampus/cue-index.js
.wolf/hippocampus/cue-recall.js
```

## Runtime checks

After refresh, verification should confirm all of the following:

1. `.wolf/hippocampus/persistence.js` exists.
2. Installed hook and hippocampus files match the freshly built `dist/src` copies used by `init`.
3. An external absolute file is ignored by post-write.
4. An in-project write creates one new event.
5. `hippocampus.json` buffer IDs equal `cue-index.json` `event_ids`.
6. A Windows-style parent cue recalls a seeded neighboring-file event.
7. A repeated edit prints a seeded past reward or trauma reflection.

The automated subprocess tests already establish checks 3, 6, and 7 against compiled hook artifacts. The final dogfood refresh section below records the live repository installation result.

## Live installation result

The repository was refreshed with:

```bash
node dist/bin/openwolf.js init --agent claude
```

Result: **passed**. OpenWolf reported an upgrade to v2.0.2, preserved 14 user-data files, updated all seven hooks, and installed the hippocampus module. PM2 was not installed, so no daemon was started; this does not affect hook dogfooding.

The global `openwolf` command was also checked. Its active NVM package path resolves through a symbolic link to `D:\GitRepo-AI\openwolf`, so CLI use is executing this checkout rather than a separate registry copy.

Installed-file comparison: **passed**. The relevant `.wolf/hooks/` and `.wolf/hippocampus/` JavaScript files are byte-identical to the `dist/src/` artifacts selected by the init command, including `persistence.js`.

The pre-existing live cue index had no complete `event_ids` watermark while the store contained 91 events. Calling recall through the installed runtime detected this legacy drift and rebuilt the index. The resulting event-ID sets matched exactly at 91 entries.

An installed-runtime write then added a tagged dogfood verification event. The rebuilt store and index matched at 92 entries, and a Windows-style parent cue recalled that event from a neighboring path. This confirms that the active repository installation is exercising the new lock, atomic persistence, complete cue index, drift repair, and path-normalized recall.

External-file rejection, canonical read-ledger keys, and past-learning output were verified by compiled hook subprocess tests in the final 51/51 suite. Those tests execute the same compiled source installed by init without mutating this repository's live memory files.

## Maintenance workflow

While dogfooding future hippocampus changes:

1. Edit `src/`.
2. Run `pnpm build:hooks` for a quick compiled-hook cycle.
3. Run targeted tests.
4. Run `pnpm build` and `pnpm test` before considering the change complete.
5. Refresh with `node dist/bin/openwolf.js init --agent claude`.
6. Verify `.wolf/hippocampus/` contains every newly compiled runtime module.

Do not use the installed `.wolf` JavaScript as the source of truth. It is a generated runtime copy and is ignored by Git; source changes belong in `src/` and tests belong in `tests/`.
