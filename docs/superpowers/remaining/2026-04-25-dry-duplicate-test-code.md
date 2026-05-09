# Remaining Work: 2026 04 25 dry duplicate test code

**Status:** not_implemented
**Generated:** 2026-04-29
**Plan:** `docs/superpowers/plans/2026-04-25-dry-duplicate-test-code.md`

## Completed

- `tests/utils/factories.ts` now includes `createMinimalTaskProviderStub` and `createMockKaneoTaskSearchResponse`.

## Remaining

- Task 1: Extract `ContextSnapshot` fixture to `tests/chat/fixtures/context-snapshot.ts` and update renderer tests.
- Task 2: Finalize `TaskProvider` stub refactor in `tests/utils/factories.ts` (though partially implemented) and update identity tool tests.
- Task 3: Extract YouTrack fetch mock utilities to `tests/providers/youtrack/fetch-mock-utils.ts` and refactor YouTrack operation tests.
- Task 4: Extract Review-Loop config fixture and temp-dir helpers to `tests/review-loop/test-helpers.ts` and update review-loop tests.
- Task 5: (Redundant/Merged) Implement Kakue search response factory in `tests/utils/factories.ts`.
- Task 6: De-duplicate Interaction Router setup in `tests/chat/interaction-router.test.ts`.
- Task 7: Final verification using `bun duplicates` and full test suite.

## Suggested Next Steps

1. Start with Task 1: Create `tests/chat/fixtures/context-snapshot.ts` and update the Telegram, Mattermost, and Discord renderer tests.
2. Proceed to Task 3: Implement `tests/providers/youtrack/fetch-mock-utils.ts` to tackle the high-volume YouTrack operation test clones.
3. Address Task 4: Implement `tests/review-loop/test-helpers.ts` to clean up review-loop test duplication.
