# OpenWolf Benchmark

> Generated 2026-08-29T14:08:27.179Z · Node v22.23.2

## Coverage

- Seams: **61/199** tested (30.7%)
- Automated line coverage: not run (pass --coverage)

### Gaps (138 untested seams)

- `hippocampus.event-store.createEmptyStore`
- `hippocampus.event-store.addEventToStore`
- `hippocampus.event-store.getEventsByLocation`
- `hippocampus.event-store.getTraumaEvents`
- `hippocampus.event-store.getTraumaEventsForPath`
- `hippocampus.event-store.incrementRecurrences`
- `hippocampus.event-store.filterEvents`
- `hippocampus.cue-index.sortTraumaByIntensity`
- `hippocampus.cue-index.getCueIndexPath`
- `hippocampus.cue-index.saveIndex`
- `hippocampus.cue-index.addEventToIndex`
- `hippocampus.cue-index.removeEventFromIndex`
- `hippocampus.cue-index.createEmptyIndex`
- `hippocampus.cue-recall.scoreEvent`
- `hippocampus.cue-recall.scoreLocationMatch`
- `hippocampus.cue-recall.computeRecencyScore`
- `hippocampus.cue-recall.matchGlob`
- `hippocampus.cue-recall.getParentDirectories`
- `hippocampus.cue-recall.getDirectory`
- `hippocampus.cue-recall.parseErrorType`
- `hippocampus.cue-recall.scoreStateMatch`
- `hippocampus.cue-recall.recallEvents`
- `hippocampus.cue-recall.getLocationCandidateIds`
- `hippocampus.cue-recall.getQuestionCandidateIds`
- `hippocampus.cue-recall.getStateCandidateIds`
- `hippocampus.cue-recall.applyFilters`
- `hippocampus.cue-recall.normalizeRecallPath`
- `hippocampus.consolidation.createEmptyNeocortex`
- `hippocampus.consolidation.saveNeocortex`
- `hippocampus.consolidation.enforceNeocortexSize`
- `hippocampus.consolidation.mergeEventsIntoNeocortex`
- `hippocampus.consolidation.calculateDecay`
- `hippocampus.consolidation.calculateConsolidationScore`
- `hippocampus.consolidation.determineConsolidationAction`
- `hippocampus.consolidation.runConsolidation`
- `hippocampus.consolidation.getNeocortexEvents`
- `hippocampus.index.createHippocampus`
- `hippocampus.persistence.backupCorruptFile`
- `hippocampus.persistence.readJsonFile`
- `hippocampus.persistence.writeJsonAtomic`
- `hippocampus.claims.validateClaimObservation`
- `hippocampus.claims.normalizeClaimStatement`
- `hippocampus.claims.normalizeClaimScope`
- `hippocampus.claims.buildClaimIdentityKey`
- `hippocampus.claims.tokenizeClaim`
- `hippocampus.claims.evidenceStrength`
- `hippocampus.claims.calculateClaimConfidence`
- `hippocampus.claims.determineClaimStatus`
- `hippocampus.claims.applyClaimObservation`
- `hippocampus.claim-store.isClaimStore`
- `hippocampus.claim-store.createEmptyClaimStore`
- `hippocampus.claim-store.refreshClaimStoreStats`
- `hippocampus.claim-store.saveClaimStore`
- `hippocampus.claim-index.isClaimIndex`
- `hippocampus.claim-index.saveClaimIndex`
- `hippocampus.claim-candidate-store.isClaimCandidateStore`
- `hippocampus.claim-candidate-store.createEmptyClaimCandidateStore`
- `hippocampus.claim-candidate-store.refreshClaimCandidateStoreStats`
- `hippocampus.claim-candidate-store.saveClaimCandidateStore`
- `hippocampus.claim-candidate-store.createClaimCandidate`
- `hooks.shared.getWolfDir`
- `hooks.shared.ensureWolfDir`
- `hooks.shared.readJSON`
- `hooks.shared.writeJSON`
- `hooks.shared.readMarkdown`
- `hooks.shared.appendMarkdown`
- `hooks.shared.serializeAnatomy`
- `hooks.shared.extractDescription`
- `hooks.shared.estimateTokens`
- `hooks.shared.timeShort`
- `hooks.shared.readStdin`
- `hooks.shared.normalizePath`
- `hooks.post-write.summarizeEdit`
- `buglog.bug-tracker.getBugLogPath`
- `buglog.bug-tracker.readBugLog`
- `buglog.bug-tracker.logBug`
- `buglog.bug-tracker.findSimilarBugs`
- `buglog.bug-tracker.searchBugs`
- `tracker.token-estimator.detectContentType`
- `tracker.token-estimator.estimateTokens`
- `tracker.token-ledger.getLedgerPath`
- `tracker.token-ledger.readLedger`
- `tracker.token-ledger.writeLedger`
- `tracker.token-ledger.incrementSessions`
- `tracker.waste-detector.detectWaste`
- `cli.index.getVersion`
- `cli.index.createProgram`
- `cli.init.initCommand`
- `cli.update.updateCommand`
- `cli.update.restoreCommand`
- `cli.scan.scanCommand`
- `cli.status.statusCommand`
- `cli.recall.recallCommand`
- `cli.recall.createRecallCommand`
- `cli.claim.recordClaimCommand`
- `cli.claim.recallClaimsCommand`
- `cli.report.reportCommand`
- `cli.registry.readRegistry`
- `cli.registry.writeRegistry`
- `cli.registry.registerProject`
- `cli.registry.unregisterProject`
- `cli.registry.getRegisteredProjects`
- `cli.dashboard.dashboardCommand`
- `cli.daemon-cmd.daemonStart`
- `cli.daemon-cmd.daemonStop`
- `cli.daemon-cmd.daemonRestart`
- `cli.daemon-cmd.daemonLogs`
- `cli.cron-cmd.cronList`
- `cli.cron-cmd.cronRun`
- `cli.cron-cmd.cronRetry`
- `cli.bug-cmd.bugSearch`
- `cli.spec-cmd.createSpecCommand`
- `daemon.cron-engine.CronEngine`
- `daemon.file-watcher.startFileWatcher`
- `daemon.wolf-daemon.detectProjectMeta`
- `daemon.wolf-daemon.handleDashboardCommand`
- `daemon.health.getHealth`
- `utils.fs-safe.readJSON`
- `utils.fs-safe.writeJSON`
- `utils.fs-safe.readText`
- `utils.fs-safe.writeText`
- `utils.fs-safe.appendText`
- `utils.paths.normalizePath`
- `utils.paths.getWolfDir`
- `utils.paths.resolveWolfFile`
- `utils.paths.ensureDir`
- `utils.paths.relativeToCwd`
- `utils.platform.isWindows`
- `utils.platform.isMac`
- `utils.platform.isLinux`
- `utils.platform.whichCommand`
- `scanner.anatomy-scanner.scanProject`
- `scanner.anatomy-scanner.buildAnatomy`
- `scanner.anatomy-scanner.updateAnatomyEntry`
- `scanner.description-extractor.extractDescription`
- `scanner.project-root.findProjectRoot`
- `specs.types.isSpecPhase`
- `specs.types.isSpecStatus`

## Performance

| Op | Kind | Iterations | ops/sec | median (ms) | p95 (ms) |
|---|---|---:|---:|---:|---:|
| calculateDecay | pure | 100000 | 1287906 | 0.002 | 0.002 |
| calculateConsolidationScore | pure | 100000 | 1214376 | 0.001 | 0.001 |
| buildIndex | pure | 5000 | 2925 | 0.332 | 0.752 |
| addEventToStore | pure | 10000 | 1581553 | 0 | 0 |
| Hippocampus.addMany | io | 20 | 39 | 26.102 | 31.262 |
| spec.advancePhase | pure | 100000 | 611682 | 0.002 | 0.002 |
| spec.nextTask | pure | 100000 | 164147 | 0.008 | 0.01 |
| spec.buildSpecContext | pure | 100000 | 17284292 | 0 | 0 |

## Outcome

⚠️ **Insufficient data**: no negative writes recorded yet (dogfood dormant), so recurrence_rate is undefined.
- token savings vs bare CLI: 1151042
- repeated reads blocked: 468
- anatomy hits: 471
- recurrences / negative writes: 0 / 0
