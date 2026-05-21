<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0114: Behavior Audit Phase 2 Redesign — Per-Behavior Classification Before Feature Consolidation

## Status

Implemented (with divergences)

## Date

2026-04-21

## Context

The behavior-audit pipeline runs a three-phase process over the test suite:

1. **Phase 1** extracts per-test behaviors, context, and canonical keywords.
2. **Phase 2** groups extracted behaviors by keyword batch and asks the LLM to classify, merge, and synthesize user stories within each batch.
3. **Phase 3** scores consolidated user-facing outputs against personas.

Two structural weaknesses drove this redesign:

1. **Grouping quality depends too heavily on keyword quality and batch partitioning heuristics.** The LLM is asked to classify, merge, and write stories all at once inside a keyword bucket. A single batch may contain semantically unrelated behaviors, while a cohesive feature may be split across buckets.

2. **Incremental reruns are unstable.** Because Phase 2 work is derived from `progress.phase1.extractedBehaviors` and partitioned by `primaryKeyword` / `secondaryKeyword`, changing one test can reshuffle unrelated behaviors across batches and trigger unnecessary reconsolidation.

The redesign was specified in `docs/superpowers/specs/2026-04-21-behavior-audit-phase2-redesign-design.md` and implemented via the plan in `docs/superpowers/plans/2026-04-21-behavior-audit-phase2-redesign-implementation.md`.

### Pre-redesign state (verified)

- `scripts/behavior-audit/consolidate.ts` derived Phase 2 work from `progress.phase1.extractedBehaviors` grouped by keyword.
- `scripts/behavior-audit/consolidate-agent.ts` sent a single prompt to classify, merge, and produce user stories.
- There was no persisted intermediate layer between extraction and consolidation.
- Internal behaviors were either dropped or merged into stories without explicit tracking.
- Artifact outputs were scattered under `reports/` without a dedicated behavior-audit root.

## Decision Drivers

1. **Stable incremental reruns** — a changed test should only invalidate its own classification and downstream features it belongs to, not trigger wider reshuffling.
2. **Explicit internal-behavior preservation** — plumbing behaviors should not become user stories, but should remain available as supporting references.
3. **Feature-level consolidation** — grouping authority should come from semantic feature assignment, not keyword bucket membership.
4. **Inspectable pipeline** — each phase should produce readable, standalone artifacts.
5. **Preserve existing architecture** — Phase 1 extraction and Phase 3 scoring objectives remain unchanged.

## Considered Options

### Option A: Two-stage Phase 2 (per-behavior classification → feature consolidation)

- **Pros**: strongest fit for rerun stability; explicit internal-behavior track; easier debugging; maps cleanly onto manifest-based pipeline.
- **Cons**: introduces a new intermediate artifact layer; requires more explicit identity and dirty-set propagation logic.
- **Verdict**: Accepted.

### Option B: Embedding-first clustering

- **Pros**: potentially stronger raw grouping quality; less keyword-dependent.
- **Cons**: weaker rerun stability because cluster boundaries drift when one behavior changes; harder to explain why a behavior moved across runs; harder to attach internal behaviors as supporting references.
- **Verdict**: Rejected.

### Option C: Keep keyword-batch Phase 2 with incremental joins

- **Pros**: minimal code change.
- **Cons**: does not solve the root cause (batch membership instability); internal behaviors still invisible.
- **Verdict**: Rejected.

## Decision

Split Phase 2 into two explicit stages:

- **Phase 2a** (`scripts/behavior-audit/classify.ts`): classifies each extracted behavior independently into a persisted `ClassifiedBehavior` record. The LLM prompt decides `visibility` (`user-facing` / `internal` / `ambiguous`), assigns a stable `featureKey`, and records related/supporting behavior hints.
- **Phase 2b** (`scripts/behavior-audit/consolidate.ts`): reads classified behaviors, groups by `featureKey`, and consolidates each feature into canonical user stories with `supportingInternalRefs` attached.

Move all audit-behavior runtime artifacts under `reports/audit-behavior/`.

## Implementation

### New modules

- `scripts/behavior-audit/classified-store.ts` — `ClassifiedBehavior` type, Zod schema, `readClassifiedFile`, `writeClassifiedFile`. Artifacts stored per test file under `reports/audit-behavior/classified/`.
- `scripts/behavior-audit/classify-agent.ts` — structured LLM call (`generateText` + `Output.object`) that classifies one behavior at a time. Returns `ClassificationResult` with `visibility`, `featureKey`, `featureLabel`, `supportingBehaviorRefs`, `relatedBehaviorHints`, `classificationNotes`.
- `scripts/behavior-audit/classify.ts` — Phase 2a runner. Loads selected extracted behaviors, runs classification, persists classified artifacts, updates progress, returns dirty `featureKey` set.
- `scripts/behavior-audit/consolidate-helpers.ts` — `loadGroupedInputs()` groups classified behaviors by `featureKey` from canonical artifacts + manifest.
- `scripts/behavior-audit/consolidate-reporting.ts` — `reportConsolidationResult()` emits structured progress events for Phase 2b items.
- `scripts/behavior-audit/classify-phase2a-helpers.ts` — `buildBehaviorId()`, `buildPrompt()`, `toClassifiedBehavior()`, `loadSelectedBehaviors()`, `shouldReuseCompletedClassification()`, `addDirtyFeatureKey()`.
- `scripts/behavior-audit/classify-manifest-helpers.ts` — `updateManifestForClassification()` updates manifest entries with `featureKey`, `classifiedArtifactPath`, `lastPhase2aCompletedAt`, and `phase2aFingerprint`.
- `scripts/behavior-audit/classify-reporting.ts` — `reportClassificationResult()` emits structured progress events for Phase 2a items.

### Modified modules

- `scripts/behavior-audit/config.ts` — added `AUDIT_BEHAVIOR_DIR`, `EXTRACTED_DIR`, `CLASSIFIED_DIR`, `CONSOLIDATED_DIR`, `EVALUATED_DIR`, `STORIES_DIR`, and reloadable env overrides.
- `scripts/behavior-audit/progress.ts` — replaced monolithic Phase 2 with explicit `Phase2aProgress` (`completedBehaviors`, `failedBehaviors`) and `Phase2bProgress` (`completedFeatureKeys`, `failedFeatureKeys`, `behaviorsConsolidated`). `Progress` version 5 (includes Phase 1b keyword clustering). Added `markClassificationDone()`, `setClassificationFailedAttempts()`, `markFeatureKeyDone()`, `markFeatureKeyFailed()`.
- `scripts/behavior-audit/progress-migrate.ts` — migrated v4 progress → v5 by injecting `phase1b: emptyPhase1b()` and backfilling legacy v5 missing fields.
- `scripts/behavior-audit/progress-resets.ts` — `resetPhase2AndPhase3()` resets both phases; `invalidatePhase3ForReevaluation()` marks all Phase 3 entries dirty when Phase 2b results change.
- `scripts/behavior-audit/incremental.ts` — added `phase2aFingerprint`, `lastPhase2aCompletedAt`, `featureKey`, `classifiedArtifactPath`, `extractedArtifactPath` to `ManifestTestEntry`. Added `ConsolidatedManifestEntry` with `featureKey`, `sourceBehaviorIds`, `supportingInternalBehaviorIds`, `phase3Fingerprint`, `lastEvaluatedAt`, `consolidatedArtifactPath`, `evaluatedArtifactPath`.
- `scripts/behavior-audit/incremental-selection.ts` — `selectIncrementalWork()` now returns `phase1SelectedTestKeys`, `phase2aSelectedTestKeys`, `phase2bSelectedFeatureKeys`, `phase3SelectedConsolidatedIds`, `reportRebuildOnly`. Changed tests → feature keys → consolidated IDs via manifest chain.
- `scripts/behavior-audit/consolidate-agent.ts` — changed input from raw extracted behaviors to `ConsolidateBehaviorInput` (includes `visibility`, `featureKey`, `featureLabel`, `behaviorId`, `confidence`, `trustFlags`). Result schema now carries `sourceBehaviorIds` and `supportingInternalRefs`.
- `scripts/behavior-audit/consolidate.ts` — `runPhase2b()` consumes classified artifacts grouped by `featureKey` via `loadGroupedInputs()`. Writes `reports/audit-behavior/consolidated/${featureKey}.json`. Updates consolidated manifest.
- `scripts/behavior-audit/evaluate.ts` / `evaluate-phase3-helpers.ts` — `parseBehaviors()` filters to `isUserFacing && userStory !== null`. Reads consolidated/evaluated artifacts by `featureKey`.
- `scripts/behavior-audit/report-writer.ts` — `ConsolidatedBehavior` extended with `sourceBehaviorIds` and `supportingInternalRefs`. `rebuildReportsFromStoredResults()` loads from canonical artifacts only.
- `scripts/behavior-audit/reset.ts` — phase2 reset clears `CLASSIFIED_DIR`, `CONSOLIDATED_DIR`, `EVALUATED_DIR`, `STORIES_DIR`, and `CONSOLIDATED_MANIFEST_PATH`. Preserves `KEYWORD_VOCABULARY_PATH`.
- `scripts/behavior-audit/index.ts` (entrypoint) — pipeline order: `phase1 → phase1b → phase2a → phase2b → phase3`. Dirty feature keys from phase2a forwarded into phase2b selection.

### Tests added / extended

- `tests/scripts/behavior-audit/phase2a.test.ts` — 8 tests covering classification, retry resume, stale metadata re-runs, failure budget, config reload.
- `tests/scripts/behavior-audit/storage.test.ts` — classified-store round-trip, supporting-internal-refs round-trip, reset behavior for phase2/phase3, progress reset helpers.
- `tests/scripts/behavior-audit/incremental-integration.test.ts` — 27 tests including candidate-feature invalidation, startup flow (phase2a → phase2b), manifest backfill, version migration.
- `tests/scripts/behavior-audit/entrypoint.test.ts` — 11 tests covering phase forwarding, dirty-key propagation, reporter injection, rebuild-only path.
- `tests/scripts/behavior-audit/progress-migrate.test.ts` — 6 tests covering v4→v5, legacy v5 backfill, incompatible reset.

## Consequences

### Positive

- **Incremental stability**: changing one test reclassifies only that behavior and downstream features it belongs to. Unrelated features remain intact.
- **Internal behaviors preserved**: plumbing behaviors stay as `supportingInternalRefs` on user-facing features instead of being dropped or incorrectly promoted.
- **Inspectability**: `reports/audit-behavior/classified/` contains one classification record per behavior, readable and diffable.
- **Clear phase boundaries**: Phase 2a does classification only; Phase 2b does consolidation only. Each phase has a narrow, testable contract.
- **Stable identity**: `behaviorId` derived from `testKey` stays constant across wording-only reruns. `featureKey` reuse preferred over creating new keys.

### Negative

- **New intermediate artifact layer**: adds implementation surface (`classified-store.ts`, `classify-phase2a-helpers.ts`, `classify-manifest-helpers.ts`, `classify-reporting.ts`).
- **Progress version increment**: old progress files pre-v4 are incompatible and reset to empty v5 on load.
- **Dirty-set propagation complexity**: the entrypoint must forward dirty feature keys from phase2a into phase2b selection.

### Risks and Mitigations

| Risk                                            | Mitigation                                                                                                                  |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Under-merging related behaviors                 | Prefer under-merging over over-merging; phase1b keyword clustering (ADR-0103) provides a normalization pass before Phase 2a |
| Feature key churn (new keys invented too often) | LLM instructed to reuse existing keys; tests verify key reuse under wording-only changes                                    |
| Extra pipeline complexity                       | Phase 2a and 2b contracts are narrow; current test coverage is 219 tests across 23 files                                    |

## Divergences from Plan

The implementation followed the spec closely. Notable divergences:

| Plan Spec                                                           | Actual Implementation                                               | Rationale                                                                                        |
| ------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Progress version 3                                                  | Version 5                                                           | Evolved to include `phase1b` (keyword clustering, ADR-0103) between Phase 1 and 2a               |
| `BEHAVIORS_DIR` for markdown                                        | `EXTRACTED_DIR` for structured `.json`                              | Replaced by canonical artifact model in ADR-0109; extracted records are typed JSON per-test-file |
| `candidateFeatureKey` / `candidateFeatureLabel`                     | `featureKey` / `featureLabel`                                       | Shorter naming; semantically equivalent                                                          |
| Progress stores `classifiedBehaviors` / `consolidations` maps       | Progress is checkpoint-only; payloads stored in canonical artifacts | Hybrid-to-artifact migration completed in ADR-0109                                               |
| Separate `buildPhase2aFingerprint` helper                           | Reuses existing `buildPhase2Fingerprint`                            | Same SHA-256 JSON hashing utility; no semantic difference                                        |
| `phase2aFingerprint` modeled in spec as per-classification artifact | Stored in `incremental-manifest.json` per-test                      | Manifest is the canonical index; artifact files are content payloads                             |

## Verification

- `bun test tests/scripts/behavior-audit/` — 219 pass, 0 fail
- `bun typecheck` — clean
- `bun format:check` — clean (1485 files)

## Related Decisions

- [ADR-0073](0073-behavior-audit-incremental-runs.md) — incremental run foundation
- [ADR-0077](0077-behavior-audit-implementation.md) — behavior audit base pipeline
- [ADR-0103](0103-behavior-audit-keyword-consolidation.md) — keyword consolidation (Phase 1b)
- [ADR-0109](0109-behavior-audit-hybrid-to-artifact-migration.md) — canonical artifact model that this redesign builds upon
- [ADR-0110](0110-behavior-audit-legacy-cleanup.md) — legacy cleanup after artifact migration
- [ADR-0111](0111-behavior-audit-mock-module-cleanup.md) — DI-based test refactor for audit scripts

## References

- Spec: `docs/archive/2026-04-21-behavior-audit-phase2-redesign-design.md`
- Implementation Plan: `docs/archive/2026-04-21-behavior-audit-phase2-redesign-implementation.md`
- Superseded plan: `docs/archive/2026-04-20-behavior-audit-keyword-batching-implementation.md`
