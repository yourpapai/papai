# Remaining Work: 2026 04 21 review loop enhancements

**Status:** not_implemented
**Generated:** 2026-04-29
**Plan:** `docs/superpowers/plans/2026-04-21-review-loop-enhancements.md`

## Completed

- The issue schema in `review-loop/src/issue-schema.ts` already includes expanded severities (`medium`, `low`) and `needsPlanning`.
- The permission policy in `review-loop/src/permission-policy.ts` currently implements a version of the logic that is close to the 'always-allow' goal.
- The loop controller in `review-loop/src/loop-controller.ts` already includes the logic for the `needsPlanning` flow.
- Prompt templates in `review-loop/src/prompt-templates.ts` already include support for `buildPlanningPrompt` and the updated `buildFixPrompt` with plan support.

## Remaining

- Task 1: Update `review-loop/src/config.ts` to use `maxRounds: 10` as default and swap agents/models in `review-loop/config.example.json` per the plan's specifications.
- Task 2: Verify implementation of expanded severity and `needsPlanning` via new test cases in `tests/review-loop/issue-schema.test.ts`.
- Task 3: Refactor `review-loop/src/permission-policy.ts` to the simplified 'always-allow' implementation and update `tests/review-loop/permission-policy.test.ts`.
- Task 4: Validate prompt templates via `tests/review-loop/prompt-templates.test.ts`.
- Task 5: Validate loop controller flow via `tests/review-loop/loop-controller.test.ts`.

## Suggested Next Steps

1. Execute Task 1: Update `review-loop/src/config.ts` and `review-loop/config.example.json` to match the plan's configuration.
2. Run Task 1 tests: `bun test tests/review-loop/run-state.test.ts` to ensure stability.
3. Proceed to Task 3: Implement the simplified permission policy to ensure the 'always-allow' requirement is strictly met.
