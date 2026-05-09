# Remaining Work: 2026 04 25 behavior audit progress ux

**Status:** not_implemented
**Generated:** 2026-04-29
**Plan:** `docs/superpowers/plans/2026-04-25-behavior-audit-progress-ux.md`

## Completed

- Creation of `scripts/behavior-audit/phase-stats.ts` with all required types and utility functions.

## Remaining

- Task 1: Create `tests/scripts/behavior-audit-phase-stats.test.ts`.
- Task 2: Update `scripts/behavior-audit/extract-agent.ts` to return `AgentResult`.
- Task 3: Update `scripts/behavior-audit/keyword-resolver-agent.ts` to return `AgentResult`.
- Task 4: Update `scripts/behavior-audit/extract-phase1-helpers.ts` to return usage.
- Task 5: Update `scripts/behavior-audit/extract.ts` to unwrap results and render stats.
- Task 6: Update `scripts/behavior-audit/classify-agent.ts` to return `AgentResult`.
- Task 7: Update `scripts/behavior-audit/classify.ts` to unwrap results and render stats.
- Task 8: Update `scripts/behavior-audit/consolidate-agent.ts`, `consolidate-helpers.ts`, and `consolidate.ts` to use `AgentResult`.
- Task 9: Update `scripts/behavior-audit/evaluate-agent.ts` and `evaluate.ts` to return `AgentResult` and render stats.
- Task 10: Update `scripts/behavior-audit.ts` (orchestrator) and its entrypoint tests.
- All associated test file updates (missing files in `tests/scripts/` for most tasks).

## Suggested Next Steps

1. 1. Implement the missing test file `tests/scripts/behavior-audit-phase-stats.test.ts` to verify the existing `phase-stats.ts`.
2. 2. Begin Task 2 by updating `scripts/behavior-audit/extract-agent.ts` to return the `AgentResult` wrapper.
3. 3. Continue through the tasks sequentially, ensuring tests are updated or created alongside every implementation change.
