# Critique: docs2/PLAN.md

**Date**: 2026-05-06
**Document**: `docs2/PLAN.md`
**Status**: Needs update — several items are stale or incomplete

---

## Issues Summary

| # | Location | Issue | Severity |
|---|----------|-------|----------|
| 1 | Phase 2 status | "Tests pending" but 109 tests pass | High |
| 2 | Phase 2.7 | T9-T12 checkboxes unchecked, not marked ✅ | Medium |
| 3 | Phase 2.3 | Entity extraction deferred to Phase 3 — not implemented | Medium |
| 4 | Phase 2.4 | Recent valence sequence deferred to Phase 3 — not implemented | Medium |
| 5 | Phase 3 test count | "36 assertions" but 37 tests pass | Low |
| 6 | File structure | neocortex.json missing from templates list | Low |
| 7 | Templates list | Doesn't match actual `src/templates/` directory | Low |

---

## Detailed Issues

### 1. Phase 2 Status — Tests Already Passing

**Line 53-57**:
```markdown
**Status**: Implementation complete | Tests pending
```

**Reality**: Phase 2 tests ARE passing — 109 assertions across T9-T12.

**Fix**: Update to:
```markdown
**Status**: Implementation complete | Tests passing (109 assertions)
```

---

### 2. Phase 2.7 — Tests Not Checked Off

**Lines 88-92**:
```markdown
### Phase 2.7 — Tests ⏳
- [ ] T9_cue-index.test.ts
- [ ] T10_recall.test.ts
- [ ] T11_recall-cli.test.sh
- [ ] T12_integration.sh
```

**Reality**: All four test files exist and pass.

**Fix**: Change to:
```markdown
### Phase 2.7 — Tests ✅
- [x] T9_cue-index.test.ts (37 assertions)
- [x] T10_recall.test.ts (57 assertions)
- [x] T11_recall-cli.test.sh (9 assertions)
- [x] T12_integration.sh (6 assertions)
```

---

### 3. Phase 2.3 — Entity Extraction Never Implemented

**Line 73**:
```markdown
- [ ] Entity extraction from question cues (Phase 3)
```

**Reality**: `QuestionCue.entities` exists as an optional field in types.ts, but:
- No code extracts entities from natural language queries
- The CLI doesn't populate `entities` when creating a question cue
- The recall algorithm can USE entities if provided, but nothing generates them

This was deferred to Phase 3, but Phase 3 doesn't implement it either.

**Recommendation**: Either:
1. Mark as "Not implemented — deferred to future phase"
2. Or implement simple keyword extraction from query string

---

### 4. Phase 2.4 — Recent Valence Sequence Not Implemented

**Line 77**:
```markdown
- [ ] Recent valence sequence detection (Phase 3)
```

**Reality**: `StateCue` in types.ts does NOT have a `recent_valence` field:
```typescript
export interface StateCue {
  type: "state";
  goal?: string;
  error?: { type, message, file?, line? };
  turn_count: number;
}
```

Phase 3 completed without implementing this. The State cue works via error matching only.

**Recommendation**: Mark as "Not implemented — deferred to future phase" or remove from plan.

---

### 5. Phase 3 Test Count Mismatch

**Line 100**:
```markdown
**Status**: Implementation complete | Tests passing (36 assertions)
```

**Reality**: 37 tests pass (T13: 6, T14: 10, T15: 9, T16: 12).

**Fix**: Update to "37 tests passing".

---

### 6. File Structure — Missing neocortex.json

**Lines 137-139**:
```markdown
src/templates/
├── hippocampus.json      # Template for openwolf init
└── cue-index.json       # Template for cue-index (Phase 2)
```

**Missing**: `neocortex.json` (Phase 3 template)

**Fix**: Add:
```markdown
src/templates/
├── hippocampus.json      # Template for openwolf init
├── cue-index.json       # Template for cue-index (Phase 2)
└── neocortex.json       # Template for neocortex (Phase 3)
```

---

### 7. Phase 3 Status Says "Implementation Complete" but Deferred Items Remain

**Lines 53-57 and 73-77** defer items to Phase 3, but Phase 3 doesn't implement them.

The plan structure implies Phase 3 completes all deferred items, but entity extraction and recent valence sequence were never built.

**Fix**: Either implement them or explicitly mark them as "Deferred to future phase".

---

## Recommended Updates to PLAN.md

1. **Line 53**: Change "Tests pending" → "Tests passing (109 assertions)"
2. **Lines 88-92**: Change "⏳" and "[]" → "✅" and "[x]" for all T9-T12
3. **Line 100**: Change "36 assertions" → "37 tests passing"
4. **Lines 137-139**: Add `neocortex.json` to templates list
5. **Line 73**: Add note "Not auto-implemented; caller must populate `entities` manually"
6. **Line 77**: Either implement or mark as "Deferred — StateCue uses error matching only"

---

## What's Working Correctly

- Phase 1 checkboxes: all ✅
- Phase 3 checkboxes: all ✅ (T13-T16)
- Phase 3 status: correctly marked ✅
- Core type definitions: accurate
- File structure for `src/hippocampus/`: correct

---

*Generated: 2026-05-06*
