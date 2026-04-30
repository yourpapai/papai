# Remaining Work: 2026 04 23 behavior audit artifact model

**Status:** not_implemented
**Generated:** 2026-04-29
**Plan:** `docs/superpowers/plans/2026-04-23-behavior-audit-artifact-model.md`

## Completed

- Phase 1: JSON artifact and Markdown extraction baseline
- Phase 2a: Artifact-driven classification baseline
- Phase 2b: Consolidated artifact generation baseline
- Phase 3: Evaluated artifact and manifest metadata updates baseline
- `scripts/behavior-audit/artifact-paths.ts`, `extracted-store.ts`, `evaluated-store.ts`, and `config.ts` implementation

## Remaining

- Task 1: Remove legacy manifest aliases and rename selection surfaces (e.g., `incremental.ts`, `incremental-selection.ts`, `consolidate.ts`)
- Task 2: Remove payload-era fallbacks from phase loaders (e.g., `classify-phase2a-helpers.ts`)
- Task 3: Implement artifact-driven rebuild-only mode (e.g., `index.ts`, `report-writer.ts`)
- Task 4: Normalize keyword vocabulary and remove `timesUsed` (e.g., `keyword-vocabulary.ts`, `keyword-resolver-agent.ts`)
- Task 5: Update phase reset flows to clean up evaluated artifacts (`reset.ts`)
- Task 6: Full verification and test coupling cleanup

## Suggested Next Steps

1. Write failing tests for feature-key-only manifests (Task 1, Step 1) to establish a baseline in `tests/scripts/behavior-audit/`
2. Remove payload-era aliases from `scripts/behavior-audit/incremental.ts` (Task 1, Step 2)
3. Remove legacy progress fallback from `scripts/behavior-audit/classify-phase2a-helpers.ts` (Task 2, Step 2)
