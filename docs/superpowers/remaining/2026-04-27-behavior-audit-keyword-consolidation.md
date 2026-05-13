# Remaining Work: 2026 04 27 behavior audit keyword consolidation

**Status:** not_implemented
**Generated:** 2026-04-29
**Plan:** `docs/superpowers/plans/2026-04-27-behavior-audit-keyword-consolidation.md`

## Completed

- Progress v5 schema and core interfaces (Phase1bProgress, Progress v5) in `scripts/behavior-audit/progress.ts`
- `emptyPhase1b` and `createEmptyProgress` functions in `scripts/behavior-audit/progress.ts`
- `resetPhase1bAndBelow` function in `scripts/behavior-audit/progress.ts` (exported via `progress-resets.js`)
- Pure clustering helpers (`cosineSimilarity`, `buildUnionFind`, `find`, `union`, `buildClusters`, `electCanonical`, `buildMergeMap`, `remapKeywords`, `buildConsolidatedVocabulary`) in `scripts/behavior-audit/consolidate-keywords-helpers.ts`
- `embedSlugBatch` agent implementation in `scripts/behavior-audit/consolidate-keywords-agent.ts`
- `runPhase1b` orchestrator implementation in `scripts/behavior-audit/consolidate-keywords.ts`
- `remapKeywordsInExtractedFile` function in `scripts/behavior-audit/extracted-store.ts`
- Phase 1b unit tests for `progress.ts` and `progress-migrate.ts`
- Phase 1b unit tests for `consolidate-keywords-helpers.ts`
- Phase 1b unit tests for `consolidate-keywords-agent.ts`
- Phase 1b unit tests for `extracted-store-remap.ts`
- Phase 1b integration tests for `runPhase1b` in `tests/scripts/behavior-audit-phase1b.test.ts`

## Remaining

- Task 2: Complete configuration for 6 new embedding/consolidation env vars in `scripts/behavior-audit/config.ts` and corresponding integration helpers
- Task 8: Wire `runPhase1bIfNeeded` into the main runner in `scripts/behavior-audit.ts` between Phase 1 and Phase 2a

## Suggested Next Steps

1. Complete the configuration step by adding all 6 new embedding/consolidation exports to `scripts/behavior-audit/config.ts` and updating `tests/scripts/behavior-audit-integration.*` helpers
2. Wire the Phase 1b orchestrator into the main behavior audit loop in `scripts/behavior-audit.ts`
