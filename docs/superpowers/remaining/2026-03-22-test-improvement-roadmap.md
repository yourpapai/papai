# Remaining Work: 2026 03 22 test improvement roadmap

**Status:** not_implemented
**Generated:** 2026-04-29
**Plan:** `docs/superpowers/plans/2026-03-22-test-improvement-roadmap.md`

## Completed

_None identified._

## Remaining

- Phase 1: Fix False-Confidence Tests (tasks 1.1 - 1.5) including `tests/bot-auth.test.ts` and `tests/logger.test.ts`
- Phase 2: Fill Critical Module Gaps (tasks 2.1 - 2.4) including `tests/scheduler.test.ts` and `completionHook` tests
- Phase 3: Strengthen Schema & Validation (tasks 3.1 - 3.3) including YouTrack schema expansion and Kaneo client verification
- Phase 4: Common-Sense Scenario Gaps (tasks 4.1 - 4.4) covering command DB state, degenerate inputs, and error paths
- Phase 5: E2E Test Hardening (tasks 5.1 - 5.4) focusing on error path coverage and deletion verification
- Phase 6: Infrastructure & Isolation (tasks 6.1 - 6.3) addressing test isolation and StrykerJS expansion

## Suggested Next Steps

1. Execute Task 1.1: Rewrite `tests/bot-auth.test.ts` to assert on `AuthorizationResult` fields rather than just DB row presence
2. Execute Task 1.2: Fix schema mismatch in `tests/tools/comment-tools.test.ts` for `removeComment` and `updateComment` tools
3. Execute Task 1.3: Replace vacuous assertions in `tests/e2e/label-operations.test.ts` with real `getTask` verifications
4. Execute Task 1.4: Rewrite `tests/logger.test.ts` to test the actual `src/logger.ts` instance and `getLogLevel()` logic
