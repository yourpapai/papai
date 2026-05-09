# Remaining Work: 2026 04 23 hybrid to artifact migration

**Status:** partially_implemented
**Generated:** 2026-04-29
**Plan:** `docs/superpowers/plans/2026-04-23-hybrid-to-artifact-migration.md`

## Completed

- Phase A: Remove legacy manifest aliases (candidateFeatureKey, extractedBehaviorPath)
- Phase B: Remove payload-era fallbacks from Phase Loaders
- Phase D: Normalize Keyword Vocabulary (removed timesUsed, implemented deterministic slug normalization)

## Remaining

- Phase C: Rebuild Reports from Canonical Artifacts Only (ensure scripts/behavior-audit/index.ts uses rebuildReportsFromArtifacts instead of rebuildReportsFromStoredResults)
- Phase E: Fix Phase Reset Behavior for Evaluated Artifacts (verify scripts/behavior-audit/reset.ts covers all required directory removals)
- Phase F: Full Verification (run the complete test suite and verify zero suppressions)

## Suggested Next Steps

1. Refactor scripts/behavior-audit/index.ts to call rebuildReportsFromArtifacts in the report-rebuild-only path as specified in Phase C.
2. Verify that scripts/behavior-audit/reset.ts correctly handles all artifact directory removals for Phase 2 and Phase 3.
3. Run the full behavior-audit test slice and repo-wide checks (bun test, bun typecheck, bun lint) to confirm the migration is complete.
