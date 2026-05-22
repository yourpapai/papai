<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0022: Fill Critical Module Test Gaps (Phase 2)

## Status

Accepted

## Date

2026-03-22

## Context

Four areas of critical business logic had insufficient or zero test coverage. These modules operate at the core of the application: the scheduler runs autonomously on a timer creating tasks without user oversight, `processMessage` is the entry point for every user interaction, `completionHook` triggers follow-up task creation on status changes, and several exported utility functions (`allOccurrencesBetween`, `appendHistory`, `getKaneoWorkspace`/`setKaneoWorkspace`) were completely untested despite being used on critical paths.

Specifically:

- `scheduler.ts` had 1 test (score 2/10) covering only the in-flight guard. No coverage of `tick()` happy path, error resilience, `createMissedTasks`, label application, user notification, or `startScheduler`/`stopScheduler`.
- `update-task.ts` + `completionHook` integration had zero tests verifying that `makeUpdateTaskTool` correctly invokes the hook when a task is updated. The hook was tested only in isolation.
- `processMessage` error handling had zero tests. The `handleMessageError` routing logic (AppError, KaneoClassifiedError, YouTrackClassifiedError, ProviderClassifiedError, APICallError, unknown errors) and history rollback on failure were entirely untested.
- `allOccurrencesBetween`, `appendHistory`, and `getKaneoWorkspace`/`setKaneoWorkspace` had zero tests each despite being used by the scheduler, conversation pipeline, and provider builder respectively.

Bugs in these paths would be invisible until production.

## Decision Drivers

- The scheduler runs autonomously; failures are silent unless a user notices a missing task.
- `processMessage` is the single entry point for all user messages; an error-handling bug affects every interaction.
- The `completionHook` integration path (tool invokes hook on status change) was undocumented by tests, leaving ambiguity about when the hook fires.
- Exported utility functions on critical paths (`allOccurrencesBetween` for missed task backfill, `appendHistory` for conversation persistence, workspace functions for provider configuration) had zero coverage.
- Phase 1 (Fix False-Confidence Tests) was a prerequisite, ensuring existing test infrastructure was reliable before expanding coverage.

## Considered Options

### Option 1: Defer testing to future phases

Delay all new test coverage to later phases focused on mutation testing or broader coverage expansion.

- **Pros**: No immediate effort; other features could proceed first.
- **Cons**: Critical modules remain untested indefinitely. Bugs in the scheduler, error handling, or history management would reach production undetected. Mutation testing (Phase 6) depends on baseline coverage existing first.

### Option 2: Targeted behavioral tests for the four critical areas (chosen)

Write focused tests for each area: expand `scheduler.test.ts` with happy path, error resilience, labels, notifications, missed tasks, and start/stop tests; add `completionHook` integration tests to `task-tools.test.ts`; create `llm-orchestrator-process.test.ts` for `processMessage` error routing and history rollback; add tests for `allOccurrencesBetween`, `appendHistory`, and workspace functions to their respective existing test files.

- **Pros**: Each critical module gets behavioral coverage. Tests document actual behavior (e.g., that `completionHook` fires on every update, not just status changes). Kill-detection ensures tests catch real regressions. Reuses existing test infrastructure and mock patterns.
- **Cons**: Extensive module mocking for `processMessage` tests creates fragility if imports change. The scheduler test uses manual DDL rather than full migrations (deferred to Phase 6).

### Option 3: Integration tests with real dependencies

Test `processMessage` and the scheduler end-to-end with real database and provider connections.

- **Pros**: Higher confidence in integration correctness.
- **Cons**: Disproportionate infrastructure cost. The scheduler would require a running task tracker. `processMessage` would require an LLM endpoint. E2E tests already cover provider integration; unit-level error routing is the gap.

## Decision

Four groups of tests were implemented:

1. **Scheduler tests (Task 2.1)** -- `tests/scheduler.test.ts` was expanded from 1 test to cover 8 describe blocks: `tick()` happy path (no-due-tasks, task creation, mark executed, occurrence recording), error resilience (provider failure caught, continues processing remaining tasks), label application (applied when supported, skipped when not), user notification (sends message, continues when notification fails), provider build failure (task skipped when config missing), `createMissedTasks` (happy path, partial failure, empty list, non-existent task), and `startScheduler`/`stopScheduler` guard logic.

2. **completionHook integration tests (Task 2.2)** -- 4 tests added to `tests/tools/task-tools.test.ts`: hook called with correct `(taskId, status, provider)` arguments on status change; hook error propagates to caller; hook fires even on title-only changes (documenting that `task.status !== undefined` always holds on the response); backward compatibility when no hook is provided.

3. **processMessage error-handling tests (Task 2.3)** -- New file `tests/llm-orchestrator-process.test.ts` with 8 tests across 5 describe blocks: missing configuration (single key, multiple keys), LLM API error (`APICallError` produces generic reply), provider classified errors (`KaneoClassifiedError`, `ProviderClassifiedError`, unknown `Error`), history rollback on error (`saveHistory` called with original base history), and success path (history extended with assistant messages).

4. **Untested exported function tests (Task 2.4)** -- `allOccurrencesBetween` (6 tests in `tests/cron.test.ts` covering range enumeration, empty range, exclusive `after`, inclusive `before`, `maxResults` cap, start-equals-end); `appendHistory` (3 tests in `tests/history.test.ts` covering empty history, existing history, mixed message roles); `getKaneoWorkspace`/`setKaneoWorkspace` (4 tests in `tests/users.test.ts` covering null default, set-then-get, overwrite, user isolation).

## Rationale

Targeting these four areas provides behavioral coverage for modules that affect every request or run autonomously. The scheduler, `processMessage`, and `completionHook` are the highest-impact paths in the application -- a bug in any of them either silently drops tasks, returns wrong error messages, or corrupts conversation history. Testing the untested exports fills gaps in foundational utilities that other modules depend on. The chosen approach reuses existing test infrastructure (mock providers, `setupTestDb`, `mockLogger`, `createMockReply`) and follows established mocking patterns (mutable implementation references, `mock.module` before imports, `mock.restore` in `afterAll`).

## Consequences

### Positive

- The scheduler has comprehensive behavioral coverage: happy path, error resilience, label handling, notifications, missed task backfill, and lifecycle management are all verified.
- The `completionHook` integration is documented by tests, explicitly capturing the behavior that the hook fires on every successful update (not just explicit status changes).
- `processMessage` error routing is verified end-to-end: each error type (`AppError`, `KaneoClassifiedError`, `ProviderClassifiedError`, `APICallError`, unknown) produces the correct user-facing reply.
- History rollback on error is tested, preventing a regression where failed messages permanently pollute conversation history.
- Boundary conditions for `allOccurrencesBetween` (exclusive after, inclusive before, maxResults cap) are documented and enforced.
- User isolation for workspace configuration is verified.
- Kill-detection design ensures tests fail when the code under test is replaced with a no-op, confirming tests are not false-positives.

### Negative

- `tests/llm-orchestrator-process.test.ts` requires mocking 10+ modules, making it fragile to import changes in `llm-orchestrator.ts`. Any new dependency added to `processMessage` may require a corresponding mock update.
- `tests/scheduler.test.ts` uses manual DDL for the `recurring_tasks` and `recurring_task_occurrences` tables rather than full migrations, creating a risk of schema drift with production. This is deferred to Phase 6 (Task 6.1.2).
- The extensive module mocking in the `processMessage` test file increases the risk of mock pollution across the full test suite. This is mitigated by `mock.restore()` in `afterAll`.

## Implementation Status

**Status**: Implemented

Evidence:

### Task 2.1 -- Scheduler tests

- `tests/scheduler.test.ts` contains 8 describe blocks: `tick() -- happy path`, `tick() -- error resilience`, `tick() -- label application`, `tick() -- user notification`, `tick() -- provider build failure`, `createMissedTasks`, `startScheduler / stopScheduler`, and the original `scheduler tick in-flight guard`.

### Task 2.2 -- completionHook integration tests

- `tests/tools/task-tools.test.ts` contains 4 completionHook tests: `completionHook is called with correct args on status change`, `completionHook error propagates to caller`, `completionHook fires even when only title is changed`, `no error when completionHook is not provided`.

### Task 2.3 -- processMessage error-handling tests

- `tests/llm-orchestrator-process.test.ts` exists with 5 describe blocks and 8 tests covering missing configuration, API errors, classified errors, history rollback, and success path history.

### Task 2.4 -- Untested exported function tests

- `tests/cron.test.ts` contains `describe('allOccurrencesBetween', ...)` with 6 tests.
- `tests/history.test.ts` contains `describe('appendHistory', ...)` with 3 tests.
- `tests/users.test.ts` contains `describe('getKaneoWorkspace / setKaneoWorkspace', ...)` with 4 tests.

## Related Decisions

- [ADR-0017: Mutation Testing with StrykerJS](0017-mutation-testing-strykerjs.md) -- Phase 2 coverage enables mutation testing expansion for `scheduler.ts` and `update-task.ts` in Phase 6.
- [ADR-0020: Error Classification Improvements](0020-error-classification-improvements.md) -- Phase 2 Task 2.3 tests the error routing pipeline that ADR-0020 established.

## Related Plans

- `/docs/plans/done/2026-03-22-phase2-detailed-test-plan.md`
