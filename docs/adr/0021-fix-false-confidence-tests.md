<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0021: Fix False-Confidence Tests (Phase 1)

## Status

Accepted

## Date

2026-03-22

## Context

A test audit scored 5 test files at 4/10 or below because they passed even when the functions they claimed to test were replaced with no-ops. These tests created false confidence: the suite reported green while bugs could lurk undetected.

The specific failures were:

1. **`tests/bot-auth.test.ts`** (score 1/10) -- 8 tests verified DB row insertion via `addUser`/`addGroupMember` but never called `checkAuthorizationExtended`. Deleting the authorization function would not break a single test.
2. **`tests/tools/comment-tools.test.ts`** (score 4/10) -- `updateComment` tests omitted the required `taskId` parameter; `removeComment` tests used the wrong field name (`activityId` instead of `commentId`) and also omitted `taskId`. Mock providers auto-resolved regardless of input, masking the bugs.
3. **`tests/e2e/label-operations.test.ts`** (score 5/10) -- the "adds and removes label from task" test ended with `expect(true).toBe(true)`, making it vacuous.
4. **`tests/logger.test.ts`** (score 1/10) -- tests instantiated a fresh `pino()` instance and verified it had standard methods, testing the pino library rather than the project's `getLogLevel()` logic.
5. **`tests/bot.test.ts`** (score 2/10) -- tested `formatLlmOutput` from `src/chat/telegram/format.ts` with loose assertions, despite the file being named after `bot.ts`. Comprehensive coverage of the same function already existed in `tests/utils/format.test.ts` (27+ tests).

## Decision Drivers

- Every test must fail when the function it covers is replaced with a no-op (mutation resilience).
- Tests must call the actual function under test and assert on its return value or side effects using exact matchers (`toEqual`, `toHaveBeenCalledWith`).
- No vacuous assertions (`expect(true).toBe(true)`).
- No test file should be named after a source module it does not actually test.
- No new lint suppressions (`eslint-disable`, `@ts-ignore`, `@ts-nocheck`).
- Existing test infrastructure (`setupTestDb`, `mockLogger`, `mockDrizzle`, `createMockProvider`) must be reused.

## Considered Options

### Option 1: Incremental assertion patches (minimal diff)

Add missing assertions to the existing tests without restructuring them.

- **Pros**: Small diff, fast to implement.
- **Cons**: Does not fix the fundamental problem in `bot-auth.test.ts` (tests never call `checkAuthorizationExtended`). Does not address the misnamed `bot.test.ts`. Leaves structural issues that will regress.

### Option 2: Full rewrite of broken tests, delete redundant files (chosen)

Rewrite `bot-auth.test.ts` to call `checkAuthorizationExtended` directly and assert on `AuthorizationResult` fields. Fix parameter names and add `toHaveBeenCalledWith` assertions in `comment-tools.test.ts`. Replace vacuous E2E assertions with return-value checks. Rewrite `logger.test.ts` to test the project's `getLogLevel()` function (adding an `export` to `src/logger.ts`). Delete `bot.test.ts` and add missing edge-case tests to `tests/utils/format.test.ts`.

- **Pros**: Every test becomes mutation-resilient. Root causes are fixed, not papered over. File naming matches source modules. Net improvement in coverage quality despite removing tests.
- **Cons**: Larger diff. Requires a minor source change (exporting `getLogLevel`). Requires re-auditing after implementation.

## Decision

Five tasks were implemented:

1. **Task 1.1 -- Rewrite `tests/bot-auth.test.ts`**: All tests now call `checkAuthorizationExtended` directly and assert on the full `AuthorizationResult` object using `toEqual`. Covers bot admin in DM and group contexts, group member authorization, DM user resolution by username, unauthorized access, and priority ordering (bot admin wins over group member check). Test count increased from 8 to 9+.

2. **Task 1.2 -- Fix `tests/tools/comment-tools.test.ts`**: Added `taskId` to all `updateComment` execute calls. Changed `removeComment` tests from `{ activityId }` to `{ taskId, commentId }`. Added `toHaveBeenCalledWith` assertions to every happy-path test to verify correct parameter forwarding to the provider. Added schema validation tests covering all required fields for each tool. Added schema-through-execute roundtrip tests.

3. **Task 1.3 -- Fix `tests/e2e/label-operations.test.ts`**: Replaced `expect(true).toBe(true)` with assertions on the return values of `addTaskLabel` and `removeTaskLabel`, verifying that both return the expected `{ taskId, labelId }` shape.

4. **Task 1.4 -- Rewrite `tests/logger.test.ts`**: Exported `getLogLevel` from `src/logger.ts` (one-word change). Rewrote tests to cover valid levels (trace, debug, info, warn, error, fatal, silent), case insensitivity, invalid values, empty string, and unset environment variable. Each test saves and restores `process.env['LOG_LEVEL']`.

5. **Task 1.5 -- Delete `tests/bot.test.ts`**: Confirmed zero unique coverage vs. `tests/utils/format.test.ts`. Deleted the file. Added new tests to `format.test.ts` for nested bold-italic, fenced code blocks without language annotation, h3/h4 headers, and CRLF line endings.

## Rationale

Patching assertions onto tests that never call the function under test does not produce mutation-resilient tests. The `bot-auth.test.ts` tests were structurally incapable of detecting bugs in `checkAuthorizationExtended` because they tested `addUser` (already covered in `users.test.ts`). Similarly, `logger.test.ts` tested the pino library rather than the project's log-level resolution logic. A full rewrite was the only way to achieve mutation resilience for these files.

For `comment-tools.test.ts`, the existing test structure was sound; the failures were caused by incorrect parameter names and missing `toHaveBeenCalledWith` assertions. Fixing the parameters and adding provider-call verification was sufficient.

Deleting `bot.test.ts` rather than renaming it was chosen because `tests/utils/format.test.ts` already provided strictly superior coverage of the same function with exact assertions.

## Consequences

### Positive

- All 5 test files now fail when their function under test is replaced with a no-op (verified via manual mutation check).
- `checkAuthorizationExtended` has dedicated tests that exercise all authorization paths (bot admin, group member, username resolution, unauthorized, priority ordering).
- Comment tool tests verify the full parameter forwarding chain from tool input to provider call, catching schema/execute contract mismatches.
- Zero vacuous assertions remain in the E2E label test.
- Logger tests cover the project's actual log-level resolution logic rather than pino internals.
- Test file naming accurately reflects the source modules under test.

### Negative

- Net test file count decreased by one (`bot.test.ts` deleted), which may cause confusion in aggregate test count reports.
- `getLogLevel` was exported from `src/logger.ts`, adding a public API surface for a previously private function. This is a minor coupling increase but is justified by the testing benefit.
- The rewritten `bot-auth.test.ts` requires `setupTestDb` + `mockDrizzle` infrastructure, adding test setup complexity compared to the original (non-functional) tests.

## Implementation Status

**Status**: Implemented

### Task 1.1 -- Bot Auth Tests

- `tests/bot-auth.test.ts` rewritten to call `checkAuthorizationExtended` and assert on `AuthorizationResult` with `toEqual`.
- 9+ tests covering: bot admin DM, bot admin group, bot admin + platform admin, group member, group member + platform admin, non-member denied, username resolution, unmatched username denied, bot admin priority over group member.

### Task 1.2 -- Comment Tools Tests

- `tests/tools/comment-tools.test.ts` fixed: all `updateComment` calls include `taskId`, all `removeComment` calls use `commentId` (not `activityId`) and include `taskId`.
- `toHaveBeenCalledWith` assertions added to happy-path tests for `addComment`, `updateComment`, and `removeComment`.
- Schema validation tests added for all required fields per tool.

### Task 1.3 -- E2E Label Operations

- `tests/e2e/label-operations.test.ts`: `expect(true).toBe(true)` replaced with `toEqual` assertions on `addTaskLabel` and `removeTaskLabel` return values.

### Task 1.4 -- Logger Tests

- `src/logger.ts`: `getLogLevel` exported.
- `tests/logger.test.ts` rewritten with 6-8 tests covering valid levels, case insensitivity, invalid values, empty string, and unset env var. Environment variable cleanup in `afterEach`.

### Task 1.5 -- Bot Test Deletion and Format Test Expansion

- `tests/bot.test.ts` deleted (zero unique coverage).
- `tests/utils/format.test.ts` expanded with tests for nested bold-italic, fenced code block without language, h3/h4 headers, and CRLF line endings.

## Related Decisions

- [ADR-0017: Mutation Testing with StrykerJS](0017-mutation-testing-strykerjs.md) -- established the mutation resilience standard that this ADR enforces.

## Related Plans

- `docs/plans/done/2026-03-22-phase1-detailed-test-plan.md`
