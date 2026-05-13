# Remaining Work: 2026 04 29 embedding clustering followups

**Status:** not_implemented
**Generated:** 2026-04-29
**Plan:** `docs/superpowers/plans/2026-04-29-embedding-clustering-followups.md`

## Completed

_None identified._

## Remaining

- Task 1: Persist Phase 1b Embedding Identity (Update Phase1bProgress in scripts/behavior-audit/progress.ts and skip/save logic in scripts/behavior-audit/consolidate-keywords.ts)
- Task 2: Backfill Embedding Identity in Progress Migration (Update Phase1bCheckpointSchema in scripts/behavior-audit/progress-migrate.ts)
- Task 3: Add Condensed Distance Matrix Helpers (Implement private math/active-state helpers in scripts/behavior-audit/consolidate-keywords-advanced-clustering.ts)
- Task 4: Replace Naive Average/Complete Linkage with Nearest-Neighbor-Chain HAC (Implement new HAC logic in scripts/behavior-audit/consolidate-keywords-advanced-clustering.ts)
- Task 5: Tighten Single-Linkage Gap Semantics (Implement pairwise-entry gate via findNextBestPairwiseSimilarity in scripts/behavior-audit/consolidate-keywords-advanced-clustering.ts)
- Task 6: Verify Real-Data Runtime and CLI Behavior (Run full test suite and verify tune-embedding.ts CLI)

## Suggested Next Steps

1. Implement Phase 1b embedding identity persistence (Task 1) to establish the foundation for invalidation.
2. Update migration schemas (Task 2) to ensure legacy records are correctly backfilled with identity fields.
3. Refactor clustering algorithms (Tasks 3 & 4) by implementing the HAC approach and distance matrix helpers in consolidate-keywords-advanced-clustering.ts.
4. Tighten single-linkage gap semantics (Task 5) and perform full verification (Task 6).
