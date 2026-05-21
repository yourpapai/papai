<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Test Improvement Roadmap

**Date:** 2026-03-22
**Status:** Draft
**Goal:** Systematically address test quality gaps identified by full-suite audit of all 74 test files

---

## Context

A comprehensive audit of the entire test suite (74 files, ~760 tests) evaluated every test file for logical correctness, assertion quality, missing common-sense scenarios, test isolation, edge case coverage, error handling, and mock quality. Each file was scored 1–10.

### Headline findings

| Category                              | Count    | Examples                                                                                                   |
| ------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| Tests that pass with broken code      | 5 files  | `bot-auth.test.ts`, `comment-tools.test.ts`, `logger.test.ts`, `label-operations.test.ts`, `bot.test.ts`   |
| Critical modules with ≤1 test         | 2 files  | `scheduler.test.ts` (1 test), `bot.test.ts` (2 tests for wrong module)                                     |
| Untested exported functions           | 3        | `allOccurrencesBetween`, `appendHistory`, `getKaneoWorkspace`/`setKaneoWorkspace`                          |
| Untested behavioral code paths        | 4        | `completionHook` in task-tools, `processMessage` error routing, `handleMessageError`, `provisionUserKaneo` |
| Schema suites with ≤3 tests each      | 7 files  | All `tests/providers/youtrack/schemas/*.test.ts`                                                           |
| E2E files with no error path coverage | 10 of 13 | All except `task-relations.test.ts` and partial `error-handling.test.ts`                                   |

### Scoring distribution

| Score                      | Files | %   |
| -------------------------- | ----- | --- |
| 9–10                       | 8     | 11% |
| 7–8                        | 36    | 49% |
| 5–6                        | 18    | 24% |
| 1–4                        | 5     | 7%  |
| N/A (helpers/orchestrator) | 7     | 9%  |

---

## Guiding Principles

1. **Fix broken tests first** — a test that passes with buggy code is worse than no test (false confidence)
2. **Prioritise by blast radius** — favour modules that affect every request (auth, orchestrator, scheduler) over niche utilities
3. **Mutation score as the quality gate** — use StrykerJS to validate that new tests actually kill mutants, not just increase line count
4. **No busywork** — skip trivial tests that add coverage points without catching real bugs
5. **One phase = one PR-able unit of work** — each phase should be mergeable independently

---

## Phase 1: Fix False-Confidence Tests

**Priority:** Critical
**Estimate:** 8–12h
**Goal:** Every test in these files should fail when the function under test is broken

### Task 1.1 — Rewrite `tests/bot-auth.test.ts`

Current state: 8 tests, score **1/10**. Tests insert DB rows and verify row existence. `checkAuthorizationExtended` is never called.

- [ ] **1.1.1** Remove all existing tests that only check DB row presence
  - Acceptance: no test that passes without calling `checkAuthorizationExtended`
- [ ] **1.1.2** Add tests that call `checkAuthorizationExtended` and assert on `AuthorizationResult` fields:
  - Bot admin in DM → `{ allowed: true, isBotAdmin: true, storageContextId: userId }`
  - Bot admin in group → `{ allowed: true, isBotAdmin: true, storageContextId: groupId }`
  - Group member in group → `{ allowed: true, isBotAdmin: false, isGroupAdmin: false, storageContextId: groupId }`
  - Non-member in group → `{ allowed: false, storageContextId: groupId }`
  - DM user resolved by username → `{ allowed: true }` with placeholder→real ID update
  - Unauthorized DM user → `{ allowed: false }`
  - Platform admin in group → `{ isGroupAdmin: true }`
  - Acceptance: each test calls `checkAuthorizationExtended` and uses `toEqual` or field-level `toBe` on the result
- [ ] **1.1.3** Add group context scenarios
  - Mentioned-but-unauthorized user in group → `auth.allowed = false` AND specific reply text
  - Natural language message in group without mention → silently ignored (no reply, no `processMessage` call)
  - Acceptance: mock `msg.isMentioned` and assert reply or no-reply
- [ ] **1.1.4** Validate with mutation testing: run `stryker run --mutate src/bot.ts` and confirm ≥60% mutation score for `checkAuthorizationExtended`

| Risk                                                                     | Probability | Impact | Mitigation                                                                                              |
| ------------------------------------------------------------------------ | ----------- | ------ | ------------------------------------------------------------------------------------------------------- |
| Mocking `checkAuthorizationExtended` dependencies (DB, cache) is complex | Medium      | Medium | Use existing `setupTestDb()` + `clearUserCache()` pattern from `config.test.ts`                         |
| `bot.ts` has side-effect-heavy imports (grammy)                          | Medium      | High   | Use `mock.module` to stub grammy imports; reference `commands/bot-auth.test.ts` which already does this |

### Task 1.2 — Fix `tests/tools/comment-tools.test.ts`

Current state: score **4/10**. `removeComment` uses wrong parameter names. `updateComment` omits required `taskId`.

- [ ] **1.2.1** Fix `makeRemoveCommentTool` tests: replace `{ activityId: 'comment-1' }` with `{ taskId: 'task-1', commentId: 'comment-1' }`
  - Acceptance: test calls `execute` with correct schema-matching params; add `toHaveBeenCalledWith` assertion on provider mock to verify `taskId` and `commentId` are forwarded
- [ ] **1.2.2** Fix `makeUpdateCommentTool` tests: add `taskId` to all `execute` calls
  - Acceptance: every `execute({...})` call includes `taskId`; add `toHaveBeenCalledWith` for provider verification
- [ ] **1.2.3** Add schema-through-execute test: call `execute` via the tool's own `inputSchema.parse()` first, then pass the parsed result to `execute`
  - Acceptance: schema validation catches the previously-broken parameter shapes
- [ ] **1.2.4** Add missing `addComment` provider argument verification
  - Acceptance: `toHaveBeenCalledWith('task-1', 'Comment text')` or equivalent

### Task 1.3 — Fix `tests/e2e/label-operations.test.ts`

Current state: score **5/10**. Vacuous `expect(true).toBe(true)`.

- [ ] **1.3.1** Replace vacuous assertion in "adds and removes label from task" with real verification:
  - After `addTaskLabel`: `getTask` → assert label ID is in `task.labels`
  - After `removeTaskLabel`: `getTask` → assert label ID is NOT in `task.labels`
  - Acceptance: test fails if `addTaskLabel`/`removeTaskLabel` silently does nothing

### Task 1.4 — Rewrite `tests/logger.test.ts`

Current state: score **1/10**. Tests a new pino instance, not the project's logger.

- [ ] **1.4.1** Delete existing tests that create their own pino instance
- [ ] **1.4.2** Add `getLogLevel()` tests:
  - `LOG_LEVEL=debug` → returns `'debug'`
  - `LOG_LEVEL=DEBUG` → returns `'debug'` (case-insensitive)
  - `LOG_LEVEL=banana` → falls back to `'info'`
  - `LOG_LEVEL=''` → falls back to `'info'`
  - Unset `LOG_LEVEL` → falls back to `'info'`
  - Acceptance: each test sets/unsets `process.env.LOG_LEVEL`, calls `getLogLevel()`, asserts exact return
- [ ] **1.4.3** Add test that the exported `logger` instance uses the level from `getLogLevel()`
  - Acceptance: import `logger` from `src/logger.ts` and assert `logger.level` matches expected value

### Task 1.5 — Rename and fix `tests/bot.test.ts`

Current state: score **2/10**. Tests `formatLlmOutput` from `format.ts`, not `bot.ts`.

- [ ] **1.5.1** Rename `tests/bot.test.ts` → `tests/format.test.ts` (or merge into `tests/utils/format.test.ts`)
- [ ] **1.5.2** Add missing `formatLlmOutput` scenarios:
  - Nested markdown (`**_bold italic_**`)
  - Fenced code block without language annotation
  - Empty string input
  - Multi-level headers (h3–h6)
  - Input with CRLF line endings
  - Acceptance: each new test asserts both `text` and `entities` array

### Phase 1 Definition of Done

- [ ] Zero tests that pass when the function-under-test is replaced with a no-op
- [ ] `bun test` green
- [ ] No `eslint-disable`, `@ts-ignore`, or `@ts-nocheck`

---

## Phase 2: Fill Critical Module Gaps

**Priority:** High
**Estimate:** 12–16h
**Goal:** Modules that affect every request or run autonomously have meaningful behavioral coverage

### Task 2.1 — Expand `tests/scheduler.test.ts`

Current state: score **2/10**, 1 test. The scheduler runs autonomously creating tasks; failures are invisible.

- [ ] **2.1.1** `tick()` with no due tasks → no provider calls, no errors
- [ ] **2.1.2** `tick()` with one due cron task → `executeRecurringTask` called → provider `createTask` called → `markExecuted` updates DB → `recordOccurrence` records link
- [ ] **2.1.3** `tick()` provider `createTask` throws → error is caught, scheduler continues, task is NOT marked executed
- [ ] **2.1.4** `createMissedTasks` with 3 missed dates → 3 provider `createTask` calls, all recorded
- [ ] **2.1.5** `createMissedTasks` where one creation fails → continues with remaining, partial success
- [ ] **2.1.6** `applyLabels` when provider supports `labels.assign` → assigns labels to created task
- [ ] **2.1.7** `applyLabels` when provider lacks `labels.assign` capability → skipped silently
- [ ] **2.1.8** `buildProviderForUser` with missing config → returns null, task skipped with warning
- [ ] **2.1.9** `notifyUser` sends message to user; `notifyUser` throws → error caught, does not crash scheduler
- [ ] **2.1.10** `startScheduler` double-call → second call is no-op
- [ ] **2.1.11** `stopScheduler` → clears interval
- [ ] **2.1.12** Validate with mutation testing on `src/scheduler.ts`

| Risk                                                         | Probability | Impact | Mitigation                                                                                                         |
| ------------------------------------------------------------ | ----------- | ------ | ------------------------------------------------------------------------------------------------------------------ |
| `scheduler.ts` has deep dependency tree (provider, DB, chat) | High        | Medium | Mock `buildProviderForUser` at module level; mock chat provider; use real DB for `markExecuted`/`recordOccurrence` |
| `setInterval`/`clearInterval` timing in tests                | Medium      | Low    | Don't test timing — test `tick()` directly as a unit; test `startScheduler`/`stopScheduler` only for guard logic   |

### Task 2.2 — Add `completionHook` tests to `tests/tools/task-tools.test.ts`

Current state: `makeUpdateTaskTool` accepts a `completionHook` callback fired on every status update. Zero test coverage.

- [ ] **2.2.1** `updateTask` with status change + `completionHook` provided → hook is called with (provider, taskId, newStatus)
- [ ] **2.2.2** `updateTask` with status change + `completionHook` throws → error propagates (not swallowed)
- [ ] **2.2.3** `updateTask` without status field → `completionHook` NOT called
- [ ] **2.2.4** `updateTask` with no `completionHook` provided → no error, normal update

### Task 2.3 — Add `processMessage` error-handling tests

Current state: `llm-orchestrator-errors.test.ts` tests error classification (pure functions) but never exercises the `processMessage` catch block or `handleMessageError` routing.

- [ ] **2.3.1** `processMessage` when `checkRequiredConfig` returns missing keys → reply contains missing key names
- [ ] **2.3.2** `processMessage` when LLM throws `APICallError` → reply is user-friendly "An unexpected error occurred"
- [ ] **2.3.3** `processMessage` when provider throws classified error → `handleMessageError` routes to `getUserMessage`
- [ ] **2.3.4** `processMessage` on error → history is rolled back to `baseHistory` (not the appended version)
- [ ] **2.3.5** `processMessage` when `generateText` returns normally → history is saved with new messages

### Task 2.4 — Add untested exported function tests

- [ ] **2.4.1** `allOccurrencesBetween` in `cron.ts` — Happy path: 5 occurrences between two dates. Empty: no matches. Boundary: start === end.
- [ ] **2.4.2** `appendHistory` in `history.ts` — Append to empty, append to existing, verify cache AND DB update.
- [ ] **2.4.3** `getKaneoWorkspace` / `setKaneoWorkspace` in `users.ts` — Set, get, unset, user isolation.

### Phase 2 Definition of Done

- [ ] `scheduler.test.ts` has ≥10 tests covering tick, error resilience, missed tasks, start/stop
- [ ] `completionHook` reaches ≥80% mutation score
- [ ] `processMessage` error routing has ≥5 tests
- [ ] All exported functions have at least one test
- [ ] `bun test` green, no lint suppressions

---

## Phase 3: Strengthen Schema & Validation Suites

**Priority:** High
**Estimate:** 8–10h
**Goal:** Schema tests catch API response changes before they reach production logic

### Task 3.1 — Expand YouTrack schema tests

Current state: score **4/10**. Each of the 7 schema files (`comment`, `common`, `issue-link`, `issue`, `project`, `tag`, `user`) has only 1–3 tests.

For each schema file, add:

- [ ] **3.1.1** Missing required field → parse fails (one test per required field)
- [ ] **3.1.2** Wrong type for each field → parse fails (e.g., number where string expected)
- [ ] **3.1.3** Extra unknown fields → stripped or passed through (document which behavior is expected)
- [ ] **3.1.4** `null` vs `undefined` for optional fields → both accepted
- [ ] **3.1.5** Empty string for required string fields → accepted or rejected (document expectation)

Target: each schema file goes from 1–3 tests to 8–15 tests.

### Task 3.2 — Add Kaneo client header verification

Current state: `client.test.ts` checks headers "exist" but never verifies values.

- [ ] **3.2.1** GET with API key → `Authorization: Bearer <key>` header value matches
- [ ] **3.2.2** GET with session cookie → `Cookie: session=<cookie>` header value matches
- [ ] **3.2.3** POST → `Content-Type: application/json` header present
- [ ] **3.2.4** Add PUT and PATCH method tests

### Task 3.3 — Add `await` to `expect().rejects` in Kaneo tests

Audit and fix all instances of `expect(promise).rejects.toBeInstanceOf(...)` that are missing `await`.

- [ ] **3.3.1** Grep for `expect(` + `.rejects.` without leading `await` across `tests/providers/kaneo/`
- [ ] **3.3.2** Add `await` to each instance
  - Acceptance: remove companion `await promise.catch(() => {})` lines that are no longer needed

### Phase 3 Definition of Done

- [ ] Each YouTrack schema file has ≥8 tests
- [ ] Kaneo client tests verify exact header values
- [ ] Zero `expect().rejects` without `await` in the codebase
- [ ] `bun test` green

---

## Phase 4: Common-Sense Scenario Gaps

**Priority:** Medium
**Estimate:** 10–14h
**Goal:** Add the "obvious" scenarios that a careful manual review would expect

### Task 4.1 — Command tests: DB state verification

- [ ] **4.1.1** `group.test.ts` `adduser`: after reply, call `listGroupMembers` to verify the user was actually persisted
- [ ] **4.1.2** `group.test.ts` `deluser`: after reply, call `isGroupMember` to verify removal
- [ ] **4.1.3** `admin.test.ts`: add test for invalid identifier format (`/user add some@invalid!id`)
- [ ] **4.1.4** `admin.test.ts`: add test for `provisionAndConfigure` returning `'provisioned'` (success path with credentials reply)
- [ ] **4.1.5** `admin.test.ts`: add test for `provisionAndConfigure` returning `'failed'` (failure note reply)
- [ ] **4.1.6** `set.test.ts`: add test for values with spaces (`/set llm_baseurl https://example.com/v1 extra`)
- [ ] **4.1.7** `set.test.ts`: add test for overwriting existing config value

### Task 4.2 — Tool tests: degenerate inputs and self-referential operations

- [ ] **4.2.1** `task-relation-tools.test.ts`: self-relation (`taskId === relatedTaskId`) — document expected behavior
- [ ] **4.2.2** `task-relation-tools.test.ts`: duplicate relation add (same pair + same type) — idempotent or error?
- [ ] **4.2.3** `task-label-tools.test.ts`: adding a label already on the task
- [ ] **4.2.4** `status-tools.test.ts`: `reorderStatuses` with empty `statuses` array
- [ ] **4.2.5** `recurring-tools.test.ts`: `on_complete` task created with `cronExpression` also provided — verify cron ignored

### Task 4.3 — Provider tests: error path coverage

- [ ] **4.3.1** `task-resource.test.ts` (Kaneo): add 404 test for `get`, create with invalid project, search with empty query
- [ ] **4.3.2** `task-archive.test.ts` (Kaneo): add un-archive test, idempotent re-archive test
- [ ] **4.3.3** `client.test.ts` (Kaneo): add network failure test (`fetch` itself throws, not HTTP error)
- [ ] **4.3.4** `task-relations.test.ts` (Kaneo): add self-relation test, test all 6 relation types (only 3 tested)

### Task 4.4 — Core module edge cases

- [ ] **4.4.1** `conversation.test.ts`: `shouldTriggerTrim` at exactly 50 messages (boundary)
- [ ] **4.4.2** `conversation.test.ts`: `runTrimInBackground` concurrent calls for same user
- [ ] **4.4.3** `memory.test.ts`: `trimWithMemoryModel` with empty history
- [ ] **4.4.4** `memory.test.ts`: `trimWithMemoryModel` when `generateText` throws
- [ ] **4.4.5** `cron.test.ts`: `parseCron('0 0 31 2 *')` — impossible date
- [ ] **4.4.6** `cron.test.ts`: DST transition edge case (spring-forward: 2:30 AM doesn't exist)
- [ ] **4.4.7** `users.test.ts`: `addUser` with duplicate but different username — verify username does or doesn't get overwritten
- [ ] **4.4.8** `errors.test.ts`: add `getUserMessage` tests for the 5 missing provider error codes (`projectNotFound`, `commentNotFound`, `relationNotFound`, `statusNotFound`, `invalidResponse`)

### Phase 4 Definition of Done

- [ ] All command tests verify DB state after mutations (not just reply text)
- [ ] Self-referential operations have documented, tested behavior
- [ ] Kaneo provider tests cover ≥3 HTTP error codes per resource operation
- [ ] Each missing provider error code has a `getUserMessage` test
- [ ] `bun test` green

---

## Phase 5: E2E Test Hardening

**Priority:** Medium
**Estimate:** 8–12h
**Goal:** E2E tests cover at least one error path per resource and verify deletions

### Task 5.1 — Error paths in E2E

- [ ] **5.1.1** `error-handling.test.ts`: verify error _type/message_ (not just `toThrow()`) for get/update non-existent task
- [ ] **5.1.2** `error-handling.test.ts`: add create task in non-existent project
- [ ] **5.1.3** `error-handling.test.ts`: add invalid API key authentication failure
- [ ] **5.1.4** `error-handling.test.ts`: add delete non-existent task
- [ ] **5.1.5** Add at least one error test to: `column-management`, `project-lifecycle`, `label-management`, `task-archive`

### Task 5.2 — Verify deletions via re-fetch

- [ ] **5.2.1** `task-comments.test.ts`: after `removeComment`, call `getComments` and assert the comment is absent
- [ ] **5.2.2** `label-operations.test.ts`: after `removeLabel`, call `listLabels` and assert absence (in addition to Phase 1 fix)
- [ ] **5.2.3** `task-archive.test.ts`: after archive, call `listTasks` and verify archived task behavior (present or absent depending on API)

### Task 5.3 — Eliminate duplicate/weak E2E files

- [ ] **5.3.1** Merge `label-management.test.ts` and `label-operations.test.ts` into a single file (significant overlap, both score ≤5.5/10)
- [ ] **5.3.2** Rename `project-archive.test.ts` to reflect its actual content (tests delete, not archive)

### Task 5.4 — Fix weak assertions

- [ ] **5.4.1** `user-workflows.test.ts` bulk operations: after updating priorities, fetch each task and verify the new priority value
- [ ] **5.4.2** `project-archive.test.ts`: verify description update was persisted (not just name)

### Phase 5 Definition of Done

- [ ] `error-handling.test.ts` has ≥6 tests that verify error type/message
- [ ] Every E2E delete/remove test verifies absence via re-fetch
- [ ] Zero `expect(true).toBe(true)` in the entire E2E suite
- [ ] No duplicate E2E files covering the same resource
- [ ] `bun test:e2e` green

---

## Phase 6: Test Infrastructure & Isolation

**Priority:** Low
**Estimate:** 4–6h
**Goal:** Prevent future regressions in test quality from infrastructure issues

### Task 6.1 — Fix test isolation risks

- [ ] **6.1.1** `conversation.test.ts`: reset `generateTextImpl` in `beforeEach` to prevent test-ordering dependency
- [ ] **6.1.2** `group-context-isolation.test.ts`: replace manual DDL with `setupTestDb()` + migrations to prevent schema drift
- [ ] **6.1.3** `task-status.test.ts` (Kaneo): make `listColumns` mock configurable per-test instead of file-scoped static

### Task 6.2 — Standardise mock patterns

- [ ] **6.2.1** Audit fetch mock patterns: Kaneo uses `setMockFetch`/`restoreFetch`, YouTrack uses local `installFetchMock`. Document the preferred pattern. Not mandatory to unify — just document.
- [ ] **6.2.2** Ensure all test files using `spyOn` or `mock.module` restore in `afterEach` (not just `beforeEach`)
- [ ] **6.2.3** Remove duplicate `createMockActivity` / `createMockActivityForList` in `test-helpers.ts` — they are identical

### Task 6.3 — Add mutation testing scope expansion

Current StrykerJS `mutate` scope covers `src/providers/`, `src/tools/`, `src/errors.ts`, `src/config.ts`, `src/memory.ts`, `src/users.ts`. After Phases 1–4, expand:

- [ ] **6.3.1** Add `src/cron.ts` to `mutate` array (good coverage after Phase 4)
- [ ] **6.3.2** Add `src/recurring.ts` to `mutate` array (good coverage already at 8.5/10)
- [ ] **6.3.3** Add `src/history.ts` to `mutate` array (good coverage already at 8.5/10)
- [ ] **6.3.4** Add `src/conversation.ts` to `mutate` array (after Phase 4 edge cases added)
- [ ] **6.3.5** Raise StrykerJS `thresholds.break` from 30 → 50 after full suite improvement

### Phase 6 Definition of Done

- [ ] Zero test-ordering dependencies (verified by running tests in random order if supported)
- [ ] No file-scoped mutable mock state without `beforeEach` reset
- [ ] StrykerJS scope expanded to 10+ source files
- [ ] StrykerJS break threshold at ≥50%
- [ ] `bun test` and `bun test:mutate` green

---

## Phasing Summary

| Phase | Focus                      | Files Touched         | Est. Hours | Prerequisite                 |
| ----- | -------------------------- | --------------------- | ---------- | ---------------------------- |
| **1** | Fix false-confidence tests | 5 test files          | 8–12h      | None                         |
| **2** | Fill critical module gaps  | 4 test files + 1 new  | 12–16h     | Phase 1                      |
| **3** | Schema & validation suites | 10 test files         | 8–10h      | None (parallel with Phase 2) |
| **4** | Common-sense scenario gaps | 12 test files         | 10–14h     | Phase 1                      |
| **5** | E2E hardening              | 8 test files          | 8–12h      | None (parallel with Phase 4) |
| **6** | Infrastructure & isolation | 5 test files + config | 4–6h       | Phases 1–4                   |

**Total estimate:** 50–70h

### Dependency graph

```
Phase 1 (fix broken tests)
├── Phase 2 (critical modules)  ←  depends on Phase 1
│   └── Phase 6 (infra)         ←  depends on Phases 1–4
├── Phase 4 (common-sense)      ←  depends on Phase 1
Phase 3 (schemas)               ←  independent, parallel with Phase 2
Phase 5 (E2E)                   ←  independent, parallel with Phase 4
```

### Success Metrics

| Metric                             | Current           | After Phase 2 | After Phase 6 |
| ---------------------------------- | ----------------- | ------------- | ------------- |
| Files scoring ≤4/10                | 5                 | 0             | 0             |
| Files scoring ≥7/10                | 44 (59%)          | 55 (74%)      | 62 (84%)      |
| Exported functions with 0 tests    | 3                 | 0             | 0             |
| Tests that pass with broken code   | 5 files           | 0             | 0             |
| StrykerJS mutation break threshold | 30%               | 30%           | 50%           |
| StrykerJS mutate scope             | 6 source patterns | 6             | 10+           |
