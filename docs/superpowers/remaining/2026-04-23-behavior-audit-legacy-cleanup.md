# Remaining Work: 2026 04 23 behavior audit legacy cleanup

**Status:** not_implemented
**Generated:** 2026-04-29
**Plan:** `docs/superpowers/plans/2026-04-23-behavior-audit-legacy-cleanup.md`

## Completed

- Deletion of `scripts/behavior-audit/progress-schemas.ts` (partially fulfills Task 5)

## Remaining

- Task 1: Remove dead exports (`isFileCompleted`, `isFeatureKeyCompleted`, `resetPhase2bAndPhase3`, `findExactKeyword`) from `scripts/behavior-audit/progress.ts` and `keyword-vocabulary.ts`
- Task 2: Remove void-parameter anti-pattern from `markClassificationDone` and `markBehaviorDone` in `scripts/behavior-audit/progress.ts` and `WriteReportsInput` in `evaluate-reporting.ts`
- Task 3: Replace duplicate `ConsolidatedStoryRecord` with canonical `ConsolidatedBehavior` in `scripts/behavior-audit/evaluate-reporting.ts`
- Task 4: Unify duplicate fingerprint functions and interfaces in `scripts/behavior-audit/fingerprints.ts` and update all callers/re-exports
- Task 5: Simplify legacy migration logic in `scripts/behavior-audit/progress-migrate.ts` using a version-number check
- Task 6: Narrow `ConsolidatedManifestEntry.featureKey` from nullable to required `string` in `scripts/behavior-audit/incremental.ts`
- Task 7: Run full behavior-audit test suite and repo-wide typecheck/lint verification

## Suggested Next Steps

1. Implement Task 1: Remove dead exports and verify with failing tests as outlined in the plan
2. Implement Task 2: Remove void parameters to tighten type safety and reduce unnecessary imports
3. Implement Task 5: Simplify the migration logic to reduce code complexity and remove residual schema dependency
