# ADR-0110: Behavior Audit — Legacy Cleanup After Canonical Artifact Migration

## Status

Implemented

## Date

2026-04-23

## Context

ADR-0109 (2026-04-23) migrated the behavior-audit pipeline from a hybrid checkpoint/artifact model to a fully canonical artifact model. That migration removed `candidateFeatureKey`, `extractedBehaviorPath`, `extractedBehaviorsByKey`, `evaluationsByKey`, `timesUsed`, and `recordKeywordUsage` from runtime code. However, the migration left behind residual dead code and type looseness that accumulated over the evolution of the pipeline:

1. **V1/V2/V3 migration schemas** in `progress-schemas.ts` (262 lines) — all three legacy migrations discarded checkpoint data via `createIncompatibleResetProgress()`, so the elaborate Zod schemas served only as shape-detectors before data was thrown away. A simple version check achieved the same result.
2. **Duplicate type** — `ConsolidatedStoryRecord` in `evaluate-reporting.ts` was structurally identical to `ConsolidatedBehavior` in `report-writer.ts`.
3. **Duplicate fingerprint functions** — `buildPhase2Fingerprint` and `buildPhase2aFingerprint` in `fingerprints.ts` had identical input shapes and implementations.
4. **Dead exports** — `isFileCompleted`, `isFeatureKeyCompleted`, `resetPhase2bAndPhase3`, `findExactKeyword` were exported but never imported externally.
5. **Void-parameter anti-pattern** — `markClassificationDone` accepted `classified: ClassifiedBehavior` only to `void` it; `markBehaviorDone` accepted `evaluation: StoryEvaluation` only to `void` it; `writeReports` received `consolidatedManifest` only to `void` it. These forced unnecessary type imports.
6. **Overly nullable `featureKey`** on `ConsolidatedManifestEntry` — consolidation always produced a concrete `featureKey: string`, but the type still allowed `string | null | undefined`.

## Decision Drivers

- **Must delete dead code** — unused exports, duplicate types, and duplicate functions add maintenance burden.
- **Must tighten types** — overly broad types mask actual invariants and force unnecessary null checks.
- **Must simplify migration logic** — shape-validating Zod schemas that only discard data are wasteful.
- **Must preserve test coverage** — 219 behavior-audit tests must continue passing.
- **Must be revertible per-task** — each cleanup is an independent commit.

## Decision

Adopt the cleanup plan as six independent refactoring tasks, each an isolated commit:

1. **Remove dead exports** from `progress.ts` and `keyword-vocabulary.ts`.
2. **Remove void-parameter anti-pattern** from `markClassificationDone`, `markBehaviorDone`, and `writeReports`.
3. **Replace duplicate `ConsolidatedStoryRecord`** with imported `ConsolidatedBehavior`.
4. **Unify duplicate fingerprint functions** `buildPhase2Fingerprint` and `buildPhase2aFingerprint`.
5. **Simplify legacy migration** by deleting `progress-schemas.ts` and replacing elaborate shape-detection with a version-number check.
6. **Narrow `ConsolidatedManifestEntry.featureKey`** to required `string`.

## Considered Options

### Option A: Leave residual code as-is (rejected)

- **Pros**: Zero change; no risk of regression.
- **Cons**: Dead code accumulates; duplicate types/fracture the domain model; void parameters force coupling to unused types; overly nullable types erode type safety.
- **Verdict**: Rejected — the migration is incomplete until residual artifacts are cleaned up.

### Option B: Monolithic single-commit cleanup (rejected)

- **Pros**: Single review point.
- **Cons**: Harder to bisect/revert; cross-task interdependencies increase risk; larger diff discourages careful review.
- **Verdict**: Rejected — plan explicitly designed tasks as independent.

### Option C: Six independent task commits (adopted)

- **Pros**: Easy to revert any single task; smaller diffs; each task passes tests independently.
- **Cons**: More commits.
- **Verdict**: Adopted — aligns with the existing plan architecture.

## Implementation

### Task 1: Remove dead exports

- **Removed** from `scripts/behavior-audit/progress.ts`:
  - `isFileCompleted`
  - `isFeatureKeyCompleted`
  - `resetPhase2bAndPhase3`
- **Removed** from `scripts/behavior-audit/keyword-vocabulary.ts`:
  - `findExactKeyword`
- **Commit**: `99a22fe7`

### Task 2: Remove void-parameter anti-pattern

- **Changed** `markClassificationDone(progress, behaviorId, classified)` → `markClassificationDone(progress, behaviorId)`; removed `ClassifiedBehavior` import.
- **Changed** `markBehaviorDone(progress, key, evaluation)` → `markBehaviorDone(progress, key)`; removed `StoryEvaluation` import.
- **Updated call sites**: `classify.ts:100`, `evaluate.ts` (indirectly via deps), `behavior-audit-storage.test.ts`.
- **Removed** `consolidatedManifest` property from `WriteReportsInput` in `evaluate-reporting.ts`; removed `ConsolidatedManifest` import and `void input.consolidatedManifest`.
- **Updated call sites**: `evaluate.ts`, `behavior-audit-phase3.test.ts`, `behavior-audit-storage.test.ts`.
- **Commit**: `14b59432`

### Task 3: Replace duplicate `ConsolidatedStoryRecord` with `ConsolidatedBehavior`

- **Deleted** the local `ConsolidatedStoryRecord` type definition from `evaluate-reporting.ts`.
- **Added** `ConsolidatedBehavior` to the existing import from `report-writer.js`.
- **Replaced** `ConsolidatedStoryRecord` → `ConsolidatedBehavior` in `WriteReportsInput`.
- **Commit**: `0e780c5a`

### Task 4: Unify duplicate fingerprint functions

- **Deleted** `Phase2aFingerprintInput` interface (merged into `Phase2FingerprintInput`).
- **Deleted** `buildPhase2aFingerprint` function (merged into `buildPhase2Fingerprint`).
- **Updated call sites**: `classify.ts`, `classify-phase2a-helpers.ts`, `behavior-audit-phase2a.test.ts`.
- **Updated re-exports** in `incremental.ts`.
- **Commit**: `67c987b7`

### Task 5: Simplify legacy migration and delete `progress-schemas.ts`

- **Deleted** `scripts/behavior-audit/progress-schemas.ts` (262 lines).
- **Inlined** `ProgressV4Schema` into `progress-migrate.ts` along with its checkpoint sub-schemas.
- **Replaced** the `migrateV1toV2`/`migrateV2toV3`/`migrateV3toV4` cascade with a simple version-number check:
  - If `ProgressV5Schema.safeParse(raw)` succeeds, return as-is.
  - If legacy V5 or V4 shape matches, normalize and return as V5.
  - If `raw` is an object with a `startedAt` string, call `createIncompatibleResetProgress`.
  - Otherwise, return `null`.
- **Removed** legacy V1/V2/V3 migration tests and fixture builders from `behavior-audit-incremental.test.ts` and `behavior-audit-storage.test.ts`.
- **Commit**: `56af3733`

### Task 6: Narrow `ConsolidatedManifestEntry.featureKey` to required `string`

- **Changed** interface: `featureKey?: string | null` → `featureKey: string`.
- **Changed** Zod schema: `featureKey: z.string().nullable().optional()` → `featureKey: z.string()`.
- **Removed** `?? null` fallbacks in `evaluate-phase3-helpers.ts:49` and `report-rebuild-helpers.ts:110` (these read `ConsolidatedManifestEntry`, where `featureKey` is now non-null).
- **Kept** `?? null` fallbacks on `ManifestTestEntry` reads (legitimately nullable):
  - `consolidate.ts:51`, `classify.ts:177`, `incremental-selection.ts:39`.
- **Updated** test fixtures in `behavior-audit-integration.helpers.ts` and `behavior-audit-phase3.test.ts`.
- **Commit**: `e4d76579`

## Divergences from the Plan

| Plan Item                                   | Expected                                    | Actual                                                                              | Reason                                                                                                                                         |
| ------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `ProgressV4Schema` in `progress-migrate.ts` | Inline four checkpoint schemas + `V4Schema` | Also added `V5Schema` + `LegacyPhase1bCheckpointSchema` + `Phase1bCheckpointSchema` | Migration baseline already evolved to V5 with `phase1b` embedding statistics; cleanup preserved V5 logic while still discarding pre-V4 shapes. |
| `normalizePhase2aFailedAttempts`            | Remains in `progress-migrate.ts`            | Kept in `progress-migrate.ts`                                                       | Still needed for V4→V5 normalization; function was not targeted for removal.                                                                   |

## Consequences

### Positive

- `progress-schemas.ts` deleted — 262 lines of dead code removed.
- Single canonical `ConsolidatedBehavior` type eliminates structural duplication.
- Single `buildPhase2Fingerprint` eliminates function duplication.
- No more void parameters — call sites pass only data that is actually consumed.
- `ConsolidatedManifestEntry.featureKey: string` reflects the actual invariant (consolidation always produces a feature key).
- Fewer unnecessary imports reduce module coupling.
- All 219 behavior-audit tests pass; `bun typecheck`, `bun lint`, `bun format:check` pass.

### Negative

- None. All changes are either deletions or type tightenings with no behavioral change.

## Verification

| Pattern                                                             | Expected | Actual                               |
| ------------------------------------------------------------------- | -------- | ------------------------------------ |
| `rg "ConsolidatedStoryRecord" scripts/behavior-audit`               | 0        | 0                                    |
| `rg "buildPhase2aFingerprint" scripts/behavior-audit tests`         | 0        | 0                                    |
| `rg "timesUsed" scripts/behavior-audit/*.ts`                        | 0        | 0                                    |
| `rg "candidateFeatureKey" scripts/behavior-audit tests`             | 0        | 0                                    |
| `rg "extractedBehaviorPath" scripts/behavior-audit tests`           | 0        | 0                                    |
| `rg "extractedBehaviorsByKey\|evaluationsByKey" scripts/ tests`     | 0        | 0                                    |
| `rg "progress\.phase1\.extractedBehaviors" scripts/ tests`          | 0        | 0                                    |
| `rg "export function isFileCompleted" scripts/behavior-audit`       | 0        | 0                                    |
| `rg "export function isFeatureKeyCompleted" scripts/behavior-audit` | 0        | 0                                    |
| `rg "export function resetPhase2bAndPhase3" scripts/behavior-audit` | 0        | 0                                    |
| `rg "export function findExactKeyword" scripts/behavior-audit`      | 0        | 0                                    |
| `test -f scripts/behavior-audit/progress-schemas.ts`                | DELETED  | DELETED                              |
| `bun test ./tests/scripts/behavior-audit/`                          | PASS     | 219 pass, 0 fail                     |
| `bun typecheck`                                                     | PASS     | exit 0                               |
| `bun lint`                                                          | PASS     | 0 warnings, 0 errors                 |
| `bun format:check`                                                  | PASS     | All matched files use correct format |

## Related Decisions

- [ADR-0109](0109-behavior-audit-hybrid-to-artifact-migration.md) — Parent migration that this cleanup logically follows.
- [ADR-0108](0108-behavior-audit-json-extraction-cleanup.md) — Prior JSON extraction cleanup.
- [ADR-0102](0102-behavior-audit-progress-reporting.md) — Progress reporting with structured events.
- [ADR-0077](0077-behavior-audit-implementation.md) — Base behavior-audit pipeline.

## References

- Implementation plan: `docs/archive/2026-04-23-behavior-audit-legacy-cleanup.md` (moved from `docs/superpowers/plans/`)
- No design spec exists for this cleanup (it is a purely refactoring follow-up).
