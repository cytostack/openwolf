# Truth Maintenance for Current Knowledge

## Why claims are separate from events

OpenWolf stores two different kinds of information:

- **Historical events** record what happened or what was believed at a particular time. They are immutable evidence. A later correction does not rewrite the event payload, timestamp, action, outcome, or provenance.
- **Memory claims** are a revisable projection of what should currently be treated as true. A claim can be active, disputed, or superseded, and it points back to the events that support or challenge it.

This distinction is intentional. Importance, repetition, access count, emotional intensity, and recency can help retrieval and retention, but none of them proves that a proposition is true.

The terms *hippocampus*, *neocortex*, and *trauma* are implementation metaphors. The concrete system is a cue-indexed episodic event store with salience-weighted retention and consolidation, plus a provenance-aware truth-maintenance projection.

## Claim lifecycle

An explicit observation follows this path:

```text
observation
    -> existing event required as evidence
    -> deterministic statement + scope identity
    -> confirms / contradicts / refines
    -> append evidence without rewriting events
    -> recalculate strength, confidence, and status
    -> atomically save claims.json and derived claim-index.json
```

Normal file-write hooks create historical events only. They do not silently assert that the latest edit is current truth. Use the claim API or CLI when a proposition deserves current-knowledge semantics.

### Confirmation and reinforcement

A confirming observation with no target creates a claim when its normalized statement and scope are new. If the identity already exists, the observation reinforces that claim instead of creating a duplicate.

Identity normalization:

- Unicode is normalized with NFKC.
- Statements are lowercased, punctuation/symbols become spaces, and whitespace is collapsed.
- Scope arrays are canonicalized, deduplicated, and sorted.
- Paths use the same canonical forward-slash form as event recall.

Claim identity does not use timestamps, random IDs, salience, emotional intensity, or access count.

### Contradiction and correction

A contradiction must name a target claim. The new event is attached as contradiction evidence to the target, while a separate correction claim is created or reinforced. The original claim and its evidence remain available for audit.

A correction supersedes the original only when its independent support reaches the configured minimum and exceeds the original's support by the configured margin. Otherwise the evidence remains explicitly disputed. A weak agent inference cannot displace a test-backed claim merely because it is newer.

Supersession is a claim relation, not deletion:

- the original retains `superseded_by` and its historical evidence;
- the correction records `contradicts_claim_ids`;
- both claims remain in `claims.json`;
- default recall excludes superseded claims, while explicit historical recall can include them.

### Refinement

A refinement must name a target and change the statement or scope. It creates a narrower or more contextual claim with `refined_from` pointing to the broader claim. The broad claim is preserved unchanged; callers can choose the scope that matches their current context.

## Evidence and confidence

Evidence has an explicit quality and verification method. The initial deterministic priority is:

1. automated test;
2. reproducible observation;
3. direct tool result;
4. explicit user correction;
5. verified code inspection;
6. agent inference;
7. unverified assumption.

Evidence strength multiplies quality weight by provenance authority. Repeated evidence is deduplicated by event ID for strength calculation. The strongest independent item dominates, and additional independent items add only a capped reinforcement bonus. Unlimited repetition therefore cannot turn weak evidence into stronger evidence than a higher-quality source.

Claim confidence is support divided by support plus contradiction. Status is derived from the evidence state and supersession link:

- `active`: current support is stronger than contradiction;
- `disputed`: support and contradiction are close, or contradiction is stronger without meeting supersession requirements;
- `superseded`: a stronger correction is linked through `superseded_by`.

Updated time is used only as the final tie-breaker after status, evidence strength, confidence, scope, and query match.

## Persistence and recovery

`.wolf/claims.json` is authoritative. `.wolf/claim-index.json` is derived and contains complete claim IDs plus identity, token, path, status, and evidence-event lookup maps.

Claim mutations use the existing hippocampus directory lock and atomic sibling-temp, fsync, and rename persistence protocol. The claim store is saved before the derived index. On recall, malformed, missing, stale, or corrupt indexes are backed up and rebuilt from the authoritative claim store.

A claim observation fails closed when its `event_id` cannot be found in either short-term hippocampus storage or long-term neocortex storage. This prevents unsupported assertions from entering the projection. Corrupt stores are preserved as timestamped backups before an empty replacement is initialized.

Claim scope accepts paths, platforms, versions, and contexts. The CLI rejects sensitive path scopes such as `.env`, private-key files, credential stores, and state files. Existing hook sensitivity boundaries remain unchanged.

## Reviewable claim candidates

A claim candidate is a non-authoritative proposal stored separately in `.wolf/claim-candidates.json`. Candidates use the same observation fields as direct claim updates, including an existing evidence event, relation, explicit target for contradiction/refinement, quality, verification method, scope, and provenance.

Candidate lifecycle:

```text
verified observation
    -> candidate add validates the existing evidence event
    -> pending candidate is reviewable but never recalled as current truth
    -> approve revalidates evidence and runs the existing claim update transaction
    -> reject preserves the candidate decision without mutating claims
```

Equivalent candidates are deduplicated by normalized statement/scope identity, evidence event, relation, and target claim. Approval persists the authoritative claim and derived claim index before marking the candidate approved. If claim persistence fails, the candidate remains pending. Rejection marks it rejected; default candidate listing shows only pending work, while `--all` exposes decision history.

Pre-read and pre-write hooks automatically recall at most three active claims whose path scope matches the canonical project-relative file. Output includes confidence, provenance, and evidence event IDs. Disputed and superseded claims are never auto-injected, and hook errors remain fail-open.

This first trusted-loop slice deliberately exposes candidate creation through an explicit CLI. Automatic producers for test results, user corrections, and reproducible tool results require deterministic event-generation contracts and dogfood measurements before activation. Ordinary file writes remain historical events only.

## CLI

Record an explicit observation:

```bash
openwolf claim record "The retry limit is five" \
  --event evt-... \
  --quality automated-test \
  --verification automated-test \
  --source manual \
  --json
```

Record a correction or refinement by naming the target:

```bash
openwolf claim record "The retry limit is five" \
  --event evt-... \
  --relation contradicts \
  --target clm-... \
  --quality automated-test
```

Recall active current claims:

```bash
openwolf claim recall "retry limit" --json
```

Queue and review a candidate before it becomes current knowledge:

```bash
openwolf claim candidate add "The retry limit is five" \
  --event evt-... \
  --quality automated-test \
  --paths src/retry.ts
openwolf claim candidate list
openwolf claim candidate approve can-... --note "Reviewed test evidence"
openwolf claim candidate reject can-... --note "Too environment-specific"
```

Include disputed or superseded historical claims explicitly with `--disputed` or `--superseded`. Use candidate `list --all` for approved/rejected queue history. JSON output includes claim status, confidence, evidence event IDs, contradiction links, supersession links, scope, provenance, and match details for automation.

## Testing guarantees

The claim regression suite covers:

- deterministic identity reinforcement;
- immutable events and provenance-preserving correction;
- verified supersession and near-equal dispute;
- refinement and scope narrowing;
- quality ordering against newer inference;
- active-only and explicit historical recall;
- evidence/provenance output;
- malformed, corrupt, and stale index/store recovery;
- fail-closed missing evidence;
- concurrent writers;
- candidate deduplication, evidence validation, approval/rejection, and persistence;
- active-only claim surfacing in pre-read/pre-write hooks;
- CLI JSON/text paths and sensitive-scope rejection.

Future semantic classification can be added as an explicit, evidence-producing layer. The initial implementation intentionally does not infer contradiction from similar prose: corrections and refinements must identify their target claim.
