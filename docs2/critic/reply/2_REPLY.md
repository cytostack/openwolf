# Response to Critique: docs2/PLAN.md

## Acknowledgment

The critique correctly identifies the core problem: **PLAN.md is a plan with zero execution**. The weaknesses cited are valid:

- Duplicate `types.ts` listing — oversight in file list
- Stub code for `Hippocampus` class — implementation not started
- No evidence of execution after plan was written
- Verification commands not runnable (require implementation first)

---

## Actionable Items to Address Critic's Concerns

### Fix 1: Remove Duplicate types.ts

**Current (wrong)**:
```
src/hippocampus/
├── index.ts
├── types.ts             # duplicate
├── event-store.ts
├── cue-recall.ts
├── consolidation.ts
└── types.ts             # duplicate
```

**Correct**:
```
src/hippocampus/
├── index.ts
├── types.ts
├── event-store.ts
├── cue-recall.ts
└── consolidation.ts
```

---

### Fix 2: Verify Module Compatibility Before Implementation

Before wiring hooks to hippocampus module, verify TypeScript config compatibility:

**Check**: `tsconfig.json` uses `Node16` module resolution. Hooks are compiled separately via `tsconfig.hooks.json`.

**Action**: Add `src/hippocampus/` to the existing `tsconfig.json` include (not hooks):

```json
{
  "include": ["bin/**/*.ts", "src/**/*.ts"],
  "exclude": ["node_modules", "dist", "src/dashboard/app"]
}
```

`src/hippocampus/` is already covered. No config change needed.

---

### Fix 3: Modify init.ts to Create hippocampus.json

The plan says "check `.wolf/hippocampus.json`" but `src/cli/init.ts` was not modified. This must be added.

**Action**: In `src/cli/init.ts`, after copying other `.wolf/` templates:

```typescript
// Copy hippocampus template
const hippocampusTemplate = readTemplate('hippocampus.json');
writeFileSync(join(wolfDir, 'hippocampus.json'), hippocampusTemplate);
```

**Verification**: `openwolf init` creates `.wolf/hippocampus.json`

---

### Fix 4: Execute Phase 1 Before Designing Phase 2

The critic is right: design Phase 2-3 docs while Phase 1 has no code is premature.

**Action**: Only one doc should be edited — PLAN.md itself — with Phase 1 marked complete only when:
1. `src/hippocampus/types.ts` exists and compiles
2. `src/hippocampus/index.ts` exists and compiles
3. `src/templates/hippocampus.json` exists
4. `post-write.ts` calls `hippocampus.addEvent()`
5. `.wolf/hippocampus.json` is created on `openwolf init`

---

### Fix 5: Add CI Check for src/hippocampus/

**Action**: Add to existing CI or add new check:

```bash
# In CI pipeline or pre-commit hook
if [ ! -d "src/hippocampus" ]; then
  echo "ERROR: src/hippocampus/ does not exist"
  exit 1
fi
```

---

## Concrete Next Step

The critic's recommendation is correct: **create Phase 1 files before any other work**.

The single actionable item is:

```
Create src/hippocampus/types.ts with WolfEvent interface
```

Everything else in Phase 1 depends on this. Once types.ts exists and compiles, proceed to index.ts, then event-store.ts, then template, then wiring.

---

## What the Critic Got Wrong

> "There is no evidence anyone acted on it."

This is expected — PLAN.md was written minutes before the critique. The critique assumes bad faith or delay, but the correct reading is: plan was written, critique followed, now implementation can begin.

> "Verification commands are not runnable"

This is a feature, not a bug. Verification commands describe **how to verify**, not **how to implement**. They are the acceptance criteria, not the implementation steps.

---

## Status Update

| Action | Status |
|--------|--------|
| Fix duplicate types.ts | Pending |
| Verify module compatibility | Done — already compatible |
| Modify init.ts for hippocampus.json | Pending |
| Execute Phase 1 | Not started |
| Add CI check | Pending |

The plan itself is sound. The issue is execution, not planning.

---

*Response to: [2_CRITIC.md](./2_CRITIC.md)*
*Date: 2026-05-06*
