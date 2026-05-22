<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0024: Common-Sense Scenario Test Gaps (Phase 4)

## Status

Accepted

## Date

2026-03-22

## Context

A systematic review of the test suite identified four categories of missing coverage that allowed subtle production bugs to go undetected:

1. **Command DB state verification.** Command tests for `/user add`, `/user remove`, `/group adduser`, `/group deluser`, and `/set` asserted reply text but never verified that the underlying SQLite mutation persisted. A command could reply "User added" without calling the write function, and the test would pass.

2. **Degenerate tool inputs.** Tools accepted self-referential operations (e.g., `addTaskRelation` where `taskId === relatedTaskId`), duplicate operations, and empty arrays without any test documenting the behavior. Whether these were silently accepted or rejected was undefined from a test perspective.

3. **Provider error paths.** Kaneo provider tests covered happy paths but had minimal error path coverage. HTTP 404, 500, network failures (`fetch` throws), and invalid JSON responses were under-tested, leaving error classification and propagation behavior unverified.

4. **Core module edge cases.** `shouldTriggerTrim` boundary conditions, concurrent `runTrimInBackground` calls, `trimWithMemoryModel` with empty history or LLM failure, impossible cron dates (Feb 31), DST transitions, `addUser` conflict/overwrite behavior, and 5 of 13 `getUserMessage` provider error codes were untested.

## Decision Drivers

- Mutation testing showed surviving mutants in `errors.ts` (95%), `providers/errors.ts` (75%), `users.ts` (42%), `memory.ts` (61%), `kaneo/task-relations.ts` (58%), and `kaneo/client.ts` (32%).
- Tests that only verify reply text create false confidence -- a passing test does not prove the side effect occurred.
- Self-referential and degenerate inputs are common LLM tool-calling patterns that need documented, tested behavior.
- No new libraries or source files were required.

## Considered Options

### Option 1: Add integration tests with real SQLite and provider instances

Run command and tool tests against real SQLite databases and a live Kaneo instance to verify end-to-end persistence.

- **Pros**: High fidelity; catches issues across layer boundaries.
- **Cons**: Disproportionate setup cost for unit-level gaps. E2E tests already cover real Kaneo integration. Slow feedback loop for boundary-condition tests.

### Option 2: Targeted unit tests with existing test infrastructure (chosen)

Add focused unit tests to 12 existing test files using `setupTestDb()`, `createMockProvider()`, `setMockFetch()`/`restoreFetch()`, and `spyOn` -- all patterns already established in the codebase.

- **Pros**: Fast execution. Covers the exact gaps identified by mutation testing. No new infrastructure. Each test documents a specific behavior.
- **Cons**: Mock-based provider tests do not guarantee real API behavior (covered separately by E2E tests). DB assertions use in-memory SQLite, not the production file.

## Decision

Added approximately 41-48 tests across four task groups in 12 existing test files, with zero new source files:

**Task 4.1 -- Command DB State Verification (7 tests):**

- `group.test.ts`: `adduser persists member in DB`, `deluser removes member from DB`
- `admin.test.ts`: `provision success replies with email/password/URL`, `provision failure replies with failure note`, `rejects invalid identifier format`
- `set.test.ts`: `stores value that contains spaces`, `overwrites existing config value`

**Task 4.2 -- Tool Degenerate Inputs (5 tests):**

- `task-relation-tools.test.ts`: self-relation, duplicate relation
- `task-label-tools.test.ts`: adding label already present
- `status-tools.test.ts`: `reorderStatuses` with empty array
- `recurring-tools.test.ts`: `on_complete` with `cronExpression` provided

**Task 4.3 -- Provider Error Path Coverage (12 tests):**

- `task-resource.test.ts`: 404 on get, invalid project on create, empty search query
- `task-archive.test.ts`: idempotent re-archive, 500 on labels endpoint
- `client.test.ts`: network failure (fetch throws), invalid JSON response body
- `task-relations.test.ts`: self-relation at provider level, all 6 relation types (`blocks`, `blocked_by`, `duplicate`, `duplicate_of`, `related`, `parent`), 500 on PUT, `updateTaskRelation` with no frontmatter

**Task 4.4 -- Core Module Edge Cases (11+ tests):**

- `conversation.test.ts`: `shouldTriggerTrim` boundary conditions (3 tests), concurrent `runTrimInBackground` calls
- `memory.test.ts`: empty history, `generateText` failure propagation
- `cron.test.ts`: impossible date (Feb 31), DST spring-forward gap
- `users.test.ts`: `addUser` overwrite username, replace with null
- `errors.test.ts`: `getUserMessage` for `projectNotFound`, `commentNotFound`, `relationNotFound`, `statusNotFound`, `invalidResponse`

## Rationale

Targeted unit tests using existing infrastructure provide the fastest path to closing identified coverage gaps. The four task groups address distinct failure modes: persistence verification prevents false-positive command tests, degenerate input tests document LLM-facing tool behavior, provider error tests verify the error classification pipeline, and core edge case tests kill surviving mutants. All tests use established patterns (`setupTestDb`, `createMockProvider`, `setMockFetch`) to minimize mock pollution risk and maintain consistency with the existing suite.

## Consequences

### Positive

- Command tests now verify DB state after mutations, preventing regressions where reply text passes but the write is missing.
- Self-referential and duplicate operations have documented, tested behavior at both tool and provider layers.
- Kaneo provider tests cover 3+ HTTP error codes per resource operation.
- All 13 `getUserMessage` provider error codes are tested; `errors.ts` mutation score targets 100%.
- Mutation score improvements expected across 6 files: `errors.ts` (95% to 100%), `providers/errors.ts` (75% to 85%+), `users.ts` (42% to 50%+), `memory.ts` (61% to 65%+), `kaneo/task-relations.ts` (58% to 70%+), `kaneo/client.ts` (32% to 40%+).

### Negative

- `admin.test.ts` provisioning tests require module-level mocking of `provisionAndConfigure`, adding mock pollution risk. Mitigated with `afterAll(() => { mock.restore() })`.
- Concurrent `runTrimInBackground` test documents a race condition (last writer wins) but does not fix it. The test is behavior-documenting, not behavior-enforcing.
- DST test behavior may vary across CI environments depending on timezone data. Mitigated by asserting behavior patterns rather than exact UTC timestamps.

## Implementation Status

**Status**: Implemented

Evidence (all tests confirmed present in the codebase):

### Task 4.1 -- Command DB State Verification

- `tests/commands/group.test.ts`: `adduser persists member in DB`, `deluser removes member from DB`
- `tests/commands/admin.test.ts`: `provision success replies with email, password, and URL`, `provision failure replies with failure note`, `rejects invalid identifier format with specific error`
- `tests/commands/set.test.ts`: `stores value that contains spaces`, `overwrites existing config value`

### Task 4.2 -- Tool Degenerate Inputs

- `tests/tools/task-relation-tools.test.ts`: `adding self-relation (taskId === relatedTaskId) -- document behavior`, `adding duplicate relation (same taskId/relatedTaskId/type) -- both calls succeed`
- `tests/tools/task-label-tools.test.ts`: `adding label already present on task -- document behavior`
- `tests/tools/status-tools.test.ts`: `reorderStatuses with empty statuses array`
- `tests/tools/recurring-tools.test.ts`: `on_complete triggerType ignores cronExpression when both provided`

### Task 4.3 -- Provider Error Path Coverage

- `tests/providers/kaneo/task-resource.test.ts`: `throws for 404 (task not found)`, `throws when projectId does not exist on create`, `search returns empty results for empty query string`
- `tests/providers/kaneo/task-archive.test.ts`: `throws when labels endpoint returns 500`, `addArchiveLabel when task already has archive label -- idempotent`
- `tests/providers/kaneo/client.test.ts`: `throws when fetch itself throws (network failure)`, `throws when successful response has invalid JSON body`
- `tests/providers/kaneo/task-relations.test.ts`: `adding self-relation (taskId === relatedTaskId) succeeds -- no guard`, all 6 relation types (`blocked_by`, `duplicate_of`, `parent` confirmed), `throws classified error when description update returns 500`, `throws relationNotFound when task description has no frontmatter`

### Task 4.4 -- Core Module Edge Cases

- `tests/conversation.test.ts`: `returns false for exactly 50 messages with 25 user messages (boundary)`, `returns true for 51 messages with 20 user messages (periodic trigger at boundary)`, `concurrent calls for same user -- both complete without corruption`
- `tests/memory.test.ts`: `trimWithMemoryModel with empty history returns empty`, `trimWithMemoryModel throws when generateText fails`
- `tests/cron.test.ts`: `parses impossible date (Feb 31) without error`, `returns null for impossible date (Feb 31 -- never occurs)`, `handles spring-forward DST gap (2:30 AM does not exist)`
- `tests/users.test.ts`: `addUser with existing ID and new username overwrites username`, `addUser with existing ID replaces username with null when no username provided`
- `tests/errors.test.ts`: `getUserMessage` tests for `projectNotFound`, `commentNotFound`, `relationNotFound`, `statusNotFound`, `invalidResponse`

## Related Decisions

- [ADR-0017: Mutation Testing with StrykerJS](0017-mutation-testing-strykerjs.md) -- mutation testing identified the surviving mutants that drove test prioritization in this phase.
- [ADR-0020: Error Classification Improvements](0020-error-classification-improvements.md) -- introduced `statusNotFound`, `invalidResponse`, and other provider error codes whose `getUserMessage` coverage was completed here.

## Related Plans

- `/docs/plans/done/2026-03-22-phase-4-detailed-test-plan.md`
