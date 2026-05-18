# Behavior Audit Phase 2 Redesign Design

- Date: 2026-04-21
- Status: Approved
- Scope: redesign the behavior-audit pipeline so extracted behaviors are classified per behavior before story consolidation, with all audit-behavior artifacts stored under `reports/audit-behavior/`

## Background

The current behavior-audit pipeline has three main phases:

1. Phase 1 extracts per-test behaviors, context, and canonical keywords.
2. Phase 2 groups extracted behaviors into keyword-owned batches and asks the LLM to classify, merge, and synthesize user stories inside those batches.
3. Phase 3 scores consolidated user-facing outputs.

Current implementation confirms that:

- `scripts/behavior-audit/extract.ts` persists extracted behaviors per test.
- `scripts/behavior-audit/consolidate.ts` derives Phase 2 work from `progress.phase1.extractedBehaviors`.
- `scripts/behavior-audit/consolidate.ts` partitions work by `primaryKeyword` and optional `secondaryKeyword` chunking before the LLM sees the pool.
- `scripts/behavior-audit/consolidate-agent.ts` then asks a single prompt to classify internal vs user-facing behavior, merge related items, and produce user stories.

This makes Phase 2 responsible for too many decisions at once. The current design has two structural weaknesses:

- grouping quality depends too heavily on Phase 1 keyword quality and batch partitioning heuristics
- incremental reruns can be unstable because behavior regrouping is driven by bucket membership, not by persisted per-behavior classification state

The requested redesign should optimize first for rerun stability, then grouping accuracy, while producing understandable user stories that are well prepared for Phase 3 scoring.

## Goals

- Redesign Phase 2 so classification happens per extracted behavior before feature-level consolidation.
- Preserve internal or supporting behaviors in a separate track instead of dropping them.
- Allow internal behaviors to remain available as supporting references for user-facing features.
- Improve incremental stability so changing one test does not reshuffle unrelated feature groups.
- Produce consolidated user-facing stories that are understandable and ready for persona scoring.
- Keep the resulting artifacts inspectable and debuggable.
- Move all audit-behavior runtime artifacts under `reports/audit-behavior/`.

## Non-goals

- Replacing the overall extraction objective of Phase 1.
- Building a fully unsupervised embedding-clustering pipeline as the primary grouping engine.
- Eliminating keywords entirely; they remain useful hints and retrieval metadata.
- Scoring internal-only behaviors in Phase 3.
- Introducing a human review gate into the default runtime pipeline.

## Priority order

The approved priority order for this redesign is:

1. stable incremental reruns
2. better feature grouping accuracy
3. lower token and runtime cost
4. easier-to-explain consolidated reports

This ordering drives the architectural choice to classify one behavior at a time before story consolidation.

## User stories

1. As an audit pipeline, I want each extracted behavior to receive its own stable classification record so that reruns only recompute affected behaviors.
2. As a consolidation phase, I want user-facing features to be built from classified records rather than keyword buckets so that final user stories are easier to understand and less sensitive to grouping heuristics.
3. As a maintainer, I want internal behaviors preserved as supporting references so that the model can inspect how a user-facing feature works without promoting plumbing into user stories.
4. As a scoring phase, I want to consume only stable consolidated user-facing features so that Phase 3 evaluates the right abstraction level.

## Approved design choices

- Recommended approach: split Phase 2 into a per-behavior classification step and a feature consolidation step.
- Internal behavior handling: keep a separate internal/supporting track, but allow internal behaviors to remain attached as references to user-facing features.
- Grouping authority: per-behavior classification records are the source of truth; keywords are hints only.
- Similarity strategy: if semantic similarity is added later, use it as an advisory retrieval signal rather than the primary grouping engine.
- Artifact root: all behavior-audit artifacts live under `reports/audit-behavior/`.

## Considered approaches

### Approach A: two-stage Phase 2

This approach splits current Phase 2 into:

- Phase 2a: per-behavior classification and linking
- Phase 2b: feature-level consolidation for user stories

Advantages:

- strongest fit for incremental stability
- explicit treatment of internal behaviors
- easier debugging and explainability
- maps well onto the current manifest-based pipeline

Trade-offs:

- introduces a new intermediate artifact layer
- requires more explicit identity and dirty-set propagation logic

### Approach B: embedding-first clustering

This approach would replace keyword batching with similarity clustering over extracted behaviors and then consolidate per cluster.

Advantages:

- potentially stronger raw grouping quality
- less dependent on keyword quality

Trade-offs:

- weaker rerun stability because cluster boundaries can drift when one behavior changes
- harder to explain why a behavior moved across runs
- harder to attach internal behaviors as supporting references without post-processing

### Decision

Approach A is approved.

The deciding factor is rerun stability. A single changed test should affect only its classification record and downstream feature dependencies, not trigger wider cluster reshaping.

## Recommended architecture

Keep the three-phase user model, but split Phase 2 internally.

### Phase 1: extract

Responsibility:

- extract per-test behavior
- extract technical context
- resolve canonical keywords

Output:

- extracted behavior records keyed by test identity

### Phase 2a: classify

Responsibility:

- classify each extracted behavior independently
- decide whether it is user-facing, internal, or ambiguous
- link it to a candidate user-facing feature when appropriate
- attach related and supporting references

Output:

- classified behavior records keyed by behavior identity

### Phase 2b: consolidate

Responsibility:

- read classified behaviors
- merge behaviors assigned to the same candidate feature
- produce canonical feature-level user stories
- attach internal behaviors as supporting references

Output:

- consolidated feature records prepared for Phase 3 scoring

### Phase 3: score

Responsibility:

- evaluate persona UX only for consolidated user-facing features

Output:

- persona scoring reports and ranked flaws or improvements

## Artifact layout

All audit-behavior outputs move under a dedicated root:

- `reports/audit-behavior/`

Recommended layout:

- `reports/audit-behavior/behaviors/`
- `reports/audit-behavior/classified/`
- `reports/audit-behavior/consolidated/`
- `reports/audit-behavior/stories/`
- `reports/audit-behavior/progress.json`
- `reports/audit-behavior/incremental-manifest.json`
- `reports/audit-behavior/consolidated-manifest.json`
- `reports/audit-behavior/keyword-vocabulary.json`

This keeps behavior-audit state isolated from other reporting concerns and makes the pipeline easier to inspect as a standalone subsystem.

## Data model

### Extracted behavior

Phase 1 continues to produce per-test extracted behaviors:

```ts
interface ExtractedBehavior {
  readonly testName: string
  readonly fullPath: string
  readonly behavior: string
  readonly context: string
  readonly keywords: readonly string[]
}
```

### Classified behavior

Add a new persisted intermediate record:

```ts
interface ClassifiedBehavior {
  readonly behaviorId: string
  readonly testKey: string
  readonly domain: string

  readonly behavior: string
  readonly context: string
  readonly keywords: readonly string[]

  readonly visibility: 'user-facing' | 'internal' | 'ambiguous'

  readonly candidateFeatureKey: string | null
  readonly candidateFeatureLabel: string | null

  readonly supportingBehaviorRefs: readonly {
    readonly behaviorId: string
    readonly reason: string
  }[]

  readonly relatedBehaviorHints: readonly {
    readonly testKey: string
    readonly relation: 'same-feature' | 'supporting-detail' | 'possibly-related'
    readonly reason: string
  }[]

  readonly classificationNotes: string
}
```

### Consolidated feature

Extend the existing consolidated concept so it can retain supporting internal references:

```ts
interface ConsolidatedBehavior {
  readonly id: string
  readonly domain: string
  readonly featureName: string
  readonly isUserFacing: boolean
  readonly behavior: string
  readonly userStory: string | null
  readonly context: string
  readonly sourceTestKeys: readonly string[]
  readonly sourceBehaviorIds: readonly string[]
  readonly supportingInternalRefs: readonly {
    readonly behaviorId: string
    readonly summary: string
  }[]
}
```

### Identity rules

- `behaviorId` is derived from `testKey` and remains stable unless the test disappears.
- `candidateFeatureKey` is assigned in Phase 2a and acts as the stable merge hint for Phase 2b.
- `consolidatedFeatureId` is assigned in Phase 2b and should be reused when a materially equivalent feature already exists.

The design prefers stable identity reuse over regenerating IDs from slightly different wording.

## Phase 2a prompt design

Unit of work:

- one extracted behavior
- a small retrieved context set of nearby classified behaviors or candidate features in the same domain
- optionally a few internal or supporting behaviors that may explain implementation details

Objective:

- classify, do not consolidate

Expected output:

- `visibility`
- `candidateFeatureKey`
- `candidateFeatureLabel`
- `relatedBehaviorHints`
- `classificationNotes`

Decision rules:

- prefer reusing an existing `candidateFeatureKey` when semantically compatible
- create a new `candidateFeatureKey` only when no existing feature candidate fits
- preserve ambiguity explicitly instead of forcing assignment
- allow internal behaviors to point at user-facing candidates as supporting references
- optimize for stable assignment, not polished prose

## Phase 2b prompt design

Unit of work:

- one `candidateFeatureKey`
- all classified behaviors assigned to it
- any supporting internal behaviors linked to it
- neighboring feature candidates only when collision checking is required

Objective:

- consolidate one candidate feature into a canonical scored feature, or reject it as internal-only

Expected output:

- canonical `featureName`
- `isUserFacing`
- consolidated `behavior`
- feature-level `userStory`
- canonical `context`
- `sourceTestKeys`
- `sourceBehaviorIds`
- `supportingInternalRefs`

Decision rules:

- one candidate feature key should normally yield one consolidated result
- internal-only candidates must not produce scored user stories
- supporting internal behaviors should be attached as references, not merged into the main behavior statement
- Phase 2b should not merge across candidate feature keys unless a future explicit reconciliation step is added

## Incremental rerun design

The incremental model is the main reason for this architecture.

### Dirty-set propagation

When a test changes:

1. rerun Phase 1 extraction for that test
2. rerun Phase 2a classification only for that extracted behavior
3. compare old and new classified records
4. mark affected `candidateFeatureKey` values dirty
5. rerun Phase 2b only for dirty candidate features
6. rerun Phase 3 only for consolidated features whose scoring payload changed

### Stability rule

Incremental invalidation should follow behavior relationships, not keyword bucket membership.

That means a changed extracted behavior should only invalidate:

- its own classified record
- any candidate features it entered, left, or materially changed
- any consolidated features derived from those candidate features

Unrelated features must remain intact.

### Manifest changes

Add explicit classification-layer tracking, for example:

- per-test `lastPhase2aCompletedAt`
- per-test or per-behavior classification fingerprint
- classified behavior entries keyed by `behaviorId`
- consolidated manifest references to `sourceBehaviorIds`, not only `sourceTestKeys`

The exact schema can follow current incremental manifest style, but Phase 2a must become a first-class tracked layer rather than implicit transient work.

## Internal behavior policy

Internal or supporting behaviors are not discarded.

Approved policy:

- keep them in a separate track
- do not send them directly to Phase 3 scoring
- allow them to remain attached to user-facing features as supporting references
- let Phase 2b summarize them so later scoring or inspection can use them as optional implementation context

This preserves useful detail about how a feature works without allowing low-level plumbing to dominate feature-level stories.

## Failure handling

### Phase 2a failure

- preserve the extracted behavior
- mark only that `behaviorId` as classification-failed
- do not block unrelated behaviors
- surface failures in reports for operator visibility

### Phase 2a ambiguity

- persist `visibility: ambiguous`
- do not force story generation
- allow later reruns or future reconciliation logic to revisit the record

### Phase 2b failure

- preserve prior consolidated output when inputs have not materially changed
- if inputs changed and consolidation fails, mark only the affected candidate feature as failed or dirty
- do not invalidate unrelated consolidated features

### Phase 3 behavior

- score only consolidated user-facing outputs
- if a feature loses user-facing status after reclassification, it should fall out of Phase 3 inputs on the next rerun

## Testing strategy

The most important tests for this redesign are incremental-stability tests.

### Unit tests

- Phase 2a prompt builder and schema parsing
- candidate-feature reuse rules
- dirty-set propagation logic
- manifest update logic for classification artifacts
- supporting-reference attachment rules

### Integration tests

- changing one test reclassifies only its own behavior
- wording-only changes preserve candidate feature identity when meaning does not change
- internal behaviors remain attached as references and do not become user stories
- ambiguous behaviors do not reach Phase 3
- changed classification dirties only affected consolidated features

### Regression fixtures

- small corpora of representative extracted behaviors from this repo
- expected classified records
- expected consolidated user stories
- expected stable IDs across reruns

## Migration strategy

Recommended rollout order:

1. move artifact roots to `reports/audit-behavior/`
2. introduce Phase 2a data structures and persistence
3. update Phase 2b to consume classified behaviors instead of raw extracted behaviors
4. adapt manifests and progress tracking
5. update Phase 3 to consume the revised consolidated output shape
6. add focused incremental-stability tests before broader refactors

This keeps the migration staged and reduces the risk of breaking the entire audit pipeline at once.

## Risks and mitigations

### Risk: under-merging related behaviors

Because Phase 2a optimizes for stable assignment, it may initially split behaviors that should later be one feature.

Mitigation:

- prefer under-merging over over-merging
- allow future reconciliation logic if needed
- use related behavior hints and optional similarity retrieval as advisory signals

### Risk: candidate feature key churn

If Phase 2a invents new feature keys too often, the downstream stability benefit is reduced.

Mitigation:

- instruct the classifier to reuse existing keys whenever semantically appropriate
- add tests that verify key reuse under wording-only changes

### Risk: extra pipeline complexity

Adding a new layer increases implementation surface area.

Mitigation:

- keep responsibilities narrow
- preserve the existing three-phase mental model for operators
- align artifacts and manifests with the current progress-tracking style

## Summary

The approved redesign replaces current keyword-batch-driven Phase 2 behavior with a two-step model:

- Phase 2a classifies each extracted behavior into stable, persisted classification records
- Phase 2b consolidates those classified records into scoring-ready user-facing features while preserving internal behaviors as supporting references

This design is chosen because it best satisfies the priority order of:

1. stable incremental reruns
2. better grouping accuracy
3. lower cost
4. clearer reports

All runtime artifacts for this subsystem move under `reports/audit-behavior/`.
