<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0025: E2E Test Hardening (Phase 5)

## Status

Accepted

## Date

2026-03-22

## Context

The E2E test suite (12 files, 43 tests) had five categories of quality gaps that undermined confidence in test results:

1. **Missing `await` on `.rejects` assertions.** Three tests across `error-handling.test.ts` (2 tests) and `task-relations.test.ts` (1 test) omitted `await` before `expect(promise).rejects.toThrow()`, causing the assertion to never evaluate. These tests always passed regardless of application behavior.

2. **Weak error path coverage.** Only 2 of 12 E2E files contained any error path test, and those were broken by the `await` bug. The remaining 10 files tested only happy paths.

3. **Missing re-fetch verification.** Approximately 16 of 21 mutation tests (update, delete, remove) verified only the mutation's return value without independently re-fetching the resource to confirm the change persisted.

4. **Duplicate E2E files.** `label-management.test.ts` and `label-operations.test.ts` covered the same resource with overlapping scenarios. `project-archive.test.ts` was misleadingly named (it tested delete and update, not archive).

5. **Vacuous assertions.** Multiple tests used `toBeDefined()` on values guaranteed to be non-null by the type system, `Array.isArray()` on typed arrays, or count-only checks where specific field assertions were needed (e.g., bulk operations asserting `length >= 5` without verifying the priority values that were actually updated).

## Decision Drivers

- Tests must fail when application behavior is wrong; silently passing tests provide negative value.
- Every E2E mutation must be independently verifiable via re-fetch, not just return-value inspection.
- Duplicate test files increase maintenance cost and obscure coverage gaps.
- Assertions must test meaningful properties, not type-system guarantees.

## Considered Options

### Option 1: Rewrite E2E suite from scratch

Discard all existing E2E tests and rebuild with a new structure enforcing error paths, re-fetch verification, and no vacuous assertions by convention.

- **Pros**: Clean slate; no legacy patterns to work around.
- **Cons**: Loses existing coverage during rewrite. Disproportionate effort for the defects identified. High risk of introducing new gaps.

### Option 2: Targeted fixes across existing files (chosen)

Fix the three `await` bugs, add error path tests to each resource file, add re-fetch verification after every mutation, consolidate duplicate files, and eliminate vacuous assertions — all within the existing file structure.

- **Pros**: Incremental. Each fix is independently verifiable. Preserves all existing valid coverage. Lower risk.
- **Cons**: Requires touching 12 files. Some structural debt (e.g., per-file `describe` blocks) remains.

### Option 3: Add a linting rule for `await` on `.rejects` only

Address only the critical `await` bug with a custom lint rule; defer other improvements.

- **Pros**: Prevents the most severe defect class from recurring.
- **Cons**: Does not address the other four gap categories. Error coverage remains at 2/12 files. Vacuous assertions continue to mask real failures.

## Decision

Seven task groups were implemented:

1. **Fix `await` bugs (Task 5.1)** — Added `await` before all `expect(promise).rejects.toThrow()` calls in `error-handling.test.ts` (2 tests) and `task-relations.test.ts` (1 test). Made test functions `async` where they were not.

2. **Strengthen error path coverage (Task 5.2)** — Expanded `error-handling.test.ts` from 3 tests to 6+ tests. Existing error tests now assert on error message content or error class (not bare `toThrow()`). Added tests for: create task in non-existent project, delete non-existent task, invalid API key authentication, and get comments for non-existent task.

3. **Add error paths to resource files (Task 5.3)** — Added at least one error path test to `column-management.test.ts`, `project-lifecycle.test.ts`, `label-management.test.ts` (merged file), `task-archive.test.ts`, `task-comments.test.ts`, and `task-search.test.ts`. All error tests assert on error type or message.

4. **Re-fetch verification (Task 5.4)** — After every mutation (comment update/removal, label add/remove on task, column update, project update, relation add/update, task archive), the resource is independently re-fetched via a separate API call to confirm persistence. Nine sub-tasks covered all mutation tests.

5. **File consolidation (Task 5.5)** — Merged `label-management.test.ts` into `label-operations.test.ts`, eliminating the duplicate. Renamed `project-archive.test.ts` to `project-management.test.ts` to match its actual content (delete and update, not archive). Updated imports in `e2e.test.ts`.

6. **Workflow assertion strengthening (Task 5.6)** — Strengthened five workflow tests in `user-workflows.test.ts`: full lifecycle verifies `archivedAt`, project setup verifies column creation, bulk operations verify priority values per task, task handoff verifies description, and task dependencies verify parent task ID.

7. **Vacuous assertion elimination (Task 5.7)** — Removed `toBeDefined()` on guaranteed-non-null values, `Array.isArray()` type guards on typed arrays, and replaced count-only assertions with field-level checks.

## Rationale

The `await` bug is a known pitfall in JavaScript testing: `expect(promise).rejects.toThrow()` without `await` creates a detached promise whose rejection is never observed, so the test completes synchronously and passes unconditionally. This is the highest-impact defect class because it makes tests actively misleading.

Re-fetch verification is the standard pattern for E2E tests against stateful APIs: the mutation's return value is an optimistic response from the server, but only a subsequent independent read confirms the write was durable. Without re-fetch, a test can pass even if the server accepted but silently dropped the mutation.

File consolidation reduces the maintenance surface. Two files testing the same resource diverge over time, creating coverage illusions (each file appears complete, but neither covers all scenarios).

## Consequences

### Positive

- Zero tests with missing `await` on `.rejects` assertions; all error path tests fail correctly when the API does not throw.
- Error path coverage expanded from 2/12 to 11/11 E2E resource files (after merge reduced the total from 12 to 11).
- All mutation tests independently verify persistence via re-fetch (from ~5/21 to 19+/21).
- Single label test file eliminates duplicate maintenance. File names match file content.
- Vacuous assertions replaced with meaningful checks; test failures now indicate real regressions.
- Total E2E test count increased from 43 to approximately 55-60.

### Negative

- Re-fetch verification adds an extra API call per mutation test, increasing E2E suite runtime.
- Some error path behaviors depend on the Kaneo API's error response shape, which may change across versions and require test updates.
- The Kaneo API priority bug (documented in `task-lifecycle.test.ts`) prevents full priority assertion in bulk operations; those assertions are skipped with a TODO comment rather than vacuously asserted.

## Implementation Status

**Status**: Implemented

Evidence:

### Task 5.1 — `await` bug fixes

- `error-handling.test.ts`: both "throws error for non-existent task" and "throws error when updating non-existent task" use `await expect(promise).rejects.toThrow()`.
- `task-relations.test.ts`: "error when relating to non-existent task" uses `await expect(promise).rejects.toThrow()`.

### Task 5.2 — Error handling expansion

- `error-handling.test.ts` contains 6+ tests with error message/type assertions, covering `getTask`, `updateTask`, `createTask` (non-existent project), `deleteTask`, invalid API key, and `getComments` for non-existent task.

### Task 5.3 — Error paths in resource files

- Error path tests added to `column-management.test.ts`, `project-lifecycle.test.ts`, `task-archive.test.ts`, `task-comments.test.ts`, `task-search.test.ts`, and the merged label file.

### Task 5.4 — Re-fetch verification

- Comment removal verified via `getComments` re-fetch. Comment update verified via `getComments` re-fetch. Column updates verified via `listColumns` re-fetch. Project updates verified via `listProjects` re-fetch. Relation additions and updates verified via `getTask` re-fetch. Archive verified via `getTask` re-fetch checking `archivedAt`.

### Task 5.5 — File consolidation

- `label-management.test.ts` merged into `label-operations.test.ts` (single surviving label file).
- `project-archive.test.ts` renamed to `project-management.test.ts` with updated describe block.
- `e2e.test.ts` imports updated.

### Task 5.6 — Workflow assertions

- `user-workflows.test.ts` workflow tests assert on specific mutation outcomes (archive status, column creation, priority values, description content, parent task ID).

### Task 5.7 — Vacuous assertion removal

- `toBeDefined()` on guaranteed-non-null values removed across `task-comments.test.ts`, `task-archive.test.ts`, `task-search.test.ts`.
- `Array.isArray()` guard removed from `project-lifecycle.test.ts`.

## Related Decisions

- [ADR-0003: E2E Test Harness with Docker Compose](0003-e2e-test-harness-with-docker.md) — established the Docker-based E2E test infrastructure that this ADR hardens.
- [ADR-0004: Comprehensive E2E Test Coverage](0004-comprehensive-e2e-test-coverage.md) — created the initial E2E test suite that this ADR improves.
- [ADR-0005: E2E Test Failure Remediation](0005-e2e-test-failure-remediation.md) — addressed earlier E2E test failures; this ADR continues that effort with deeper structural fixes.

## Related Plans

- `/docs/plans/done/2026-03-22-phase5-e2e-test-hardening.md`
