# Remaining Work: 2026 04 20 behavior audit keyword batching implementation

**Status:** not_implemented
**Generated:** 2026-04-29
**Plan:** `docs/superpowers/plans/2026-04-20-behavior-audit-keyword-batching-implementation.md`

## Completed

- `KEYWORD_VOCABULARY_PATH` is already defined in `scripts/behavior-audit/config.ts` (line 67).
- The files `scripts/behavior-audit/extract-agent.ts`, `scripts/behavior-audit/keyword-resolver-agent.ts`, `scripts/behavior-audit/keyword-vocabulary.ts`, `scripts/behavior-audit/consolidate-agent.ts`, `scripts/behavior-audit/consolidate.ts`, `scripts/behavior-audit/extract.ts`, `scripts/behavior-audit/evaluate.ts`, `scripts/behavior-audit/incremental.ts`, and `scripts/behavior-audit/extract-incremental.ts` all exist.

## Remaining

- Task 1: Add integration test scaffolding in `tests/scripts/behavior-audit-integration.test.ts` (Note: This specific file name is missing; test files exist under similar names).
- Task 2: Implement/Verify `extract-agent.ts` and `keyword-resolver-agent.ts` module shapes.
- Task 3: Verify/Implement `keyword-vocabulary.ts` persistence helpers.
- Task 4: Extend `ExtractedBehavior` and `report-writer.ts` to include keywords.
- Task 4: Update `progress-migrate.ts` for schema changes.
- Task 5: Refactor `extract.ts` to orchestrate extractor and resolver agents.
- Task 6: Update `incremental.ts` and `extract-incremental.ts` for keyword-aware fingerprints.
- Task 7: Redesign `consolidate-agent.ts` prompt contract for feature-level quality.
- Task 8: Rewrite `consolidate.ts` to use primary-keyword grouping instead of domain grouping.
- Task 9: Update `evaluate.ts` for Phase 3 traversal via consolidated manifest.
- Task 10: Update `behavior-audit.ts` entrypoint and implement `behavior-audit-reset.ts`.

## Suggested Next Steps

1. 1. Reconcile the plan's test file naming (`behavior-audit-integration.test.ts`) with the actual file structure in `tests/scripts/`.
2. 2. Implement Task 2 (Agent module shapes) and Task 3 (Vocabulary helpers) to establish the foundational Phase 1 pipeline.
3. 3. Proceed to Task 4 and 5 to complete the Phase 1 orchestration and reporting.
