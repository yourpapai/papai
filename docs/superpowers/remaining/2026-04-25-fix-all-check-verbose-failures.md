# Remaining Work: 2026 04 25 fix all check verbose failures

**Status:** partially_implemented
**Generated:** 2026-04-29
**Plan:** `docs/superpowers/plans/2026-04-25-fix-all-check-verbose-failures.md`

## Completed

- Removal of dead file `scripts/behavior-audit/repro-test-tools.ts` (confirmed missing)
- Refactoring of `no-conditional-in-test` patterns in `tests/review-loop/loop-controller.test.ts`, `tests/review-loop/issue-ledger.test.ts`, and `tests/review-loop/progress-log.test.ts` (verified by presence of `expect(...).toBeDefined()` and absence of conditional guards)
- Refactoring of `if (!tool.execute)` guards in `tests/tools/recurring-tools.test.ts` (verified via grep)

## Remaining

- Refactoring of `if (runId === undefined)` guards in `tests/review-loop/fake-agent-integration.test.ts` (Pattern A)
- Investigation and resolution of Telegram forum topic test timeouts in `tests/chat/telegram/index.test.ts` (Part 4)
- Final end-to-end verification of `bun check:verbose` to ensure no SIGINT cascade or remaining errors (Phase 5)

## Suggested Next Steps

1. Refactor `tests/review-loop/fake-agent-integration.test.ts` to use `expect(runId).toBeDefined()` instead of the `if` guard (Part 1, Pattern A)
2. Investigate `tests/chat/telegram/index.test.ts` for missing mocks or necessary timeout increases (Part 4)
3. Run `bun check:verbose` to confirm complete resolution of the cascade and all sub-issues (Phase 5)
