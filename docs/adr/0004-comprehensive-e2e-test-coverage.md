<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0004: Comprehensive E2E Test Coverage for Kaneo Operations

## Status

Accepted

## Date

2026-03-13

## Context

After the initial E2E harness was established (ADR-0003), only three test files existed covering basic task lifecycle, label management, and project lifecycle. The majority of Kaneo API operations — comments, task relations, column management, project archiving, error handling, and multi-step user workflows — had no integration test coverage. Regressions in these areas could go undetected until runtime.

## Decision Drivers

- All Kaneo provider operations must be covered by at least one E2E test
- Tests must be organised by domain to keep files focused and maintainable
- Error conditions (404, 400, validation) must be explicitly verified
- User-facing workflows (full task lifecycle, sprint planning, task dependencies) must have end-to-end smoke tests
- Each test file must be self-contained with `beforeEach` cleanup so it can be run independently for debugging

## Considered Options

### Option 1: Expand existing test files

- **Pros**: Fewer files to maintain
- **Cons**: Files become large and hard to navigate; a failure in one area pollutes the output for the entire file

### Option 2: One test file per domain (implemented)

- **Pros**: Clear ownership; failures are easy to triage by file name; files stay focused
- **Cons**: More files; orchestrator (`e2e.test.ts`) must import all of them

### Option 3: Generated tests from OpenAPI spec

- **Pros**: Always in sync with API spec
- **Cons**: No Kaneo OpenAPI spec available; generated tests lack meaningful assertions

## Decision

Create one test file per domain, imported by a central `e2e.test.ts` orchestrator. Cover all Kaneo API operations, error conditions, and representative user workflows.

## Rationale

Domain-organised test files provide the best tradeoff between discoverability and maintainability. The orchestrator pattern (`e2e.test.ts` importing all suites) allows Bun's preload-based global setup to apply uniformly while still enabling individual file execution for debugging.

## Consequences

### Positive

- Every Kaneo provider operation has at least one E2E test
- Test failures are immediately attributable to a specific domain
- CI coverage reports accurately reflect integration health
- User workflows (multi-step scenarios) surface interaction bugs between operations

### Negative

- Larger test suite increases total E2E run time
- Each new Kaneo operation must be accompanied by a new E2E test (process overhead)
- Tests share the same provisioned workspace, so label/status namespace pollution is possible if cleanup is incomplete

## Implementation Status

**Status**: Implemented

All test files specified in the plan exist in the codebase. The following domain files are present and imported by `tests/e2e/e2e.test.ts`:

| File                                  | Domain                                                   |
| ------------------------------------- | -------------------------------------------------------- |
| `tests/e2e/task-lifecycle.test.ts`    | Task CRUD, list, search                                  |
| `tests/e2e/task-archive.test.ts`      | Task archiving                                           |
| `tests/e2e/task-comments.test.ts`     | Comment add/list/update/remove                           |
| `tests/e2e/task-relations.test.ts`    | blocks, blocked_by, duplicate, related, parent relations |
| `tests/e2e/task-search.test.ts`       | Search by keyword, status, priority                      |
| `tests/e2e/project-lifecycle.test.ts` | Project create/list/update/column list                   |
| `tests/e2e/project-archive.test.ts`   | Project archiving (delete)                               |
| `tests/e2e/label-management.test.ts`  | Label CRUD and task-label associations                   |
| `tests/e2e/label-operations.test.ts`  | Extended label operations                                |
| `tests/e2e/column-management.test.ts` | Column create/update/delete/reorder                      |
| `tests/e2e/error-handling.test.ts`    | 404/400/validation error responses                       |
| `tests/e2e/user-workflows.test.ts`    | Full lifecycle, dependencies, bulk operations            |

Notable implementation differences from the plan:

- `task-comments.test.ts` uses `getSharedKaneoConfig()` / `getSharedWorkspaceId()` from `test-helpers.ts` with its own `beforeAll`/`afterAll` lifecycle rather than `KaneoTestClient`, due to the comment API workaround requiring careful per-suite setup.
- All test files call `setDefaultTimeout()` locally (10000–30000ms) rather than relying on a global setting.
- The `task-relations.test.ts` verifies relation storage in task description frontmatter (the chosen implementation approach for Kaneo, which has no native relation API).

## Related Plans

- `docs/plans/done/2026-03-13-comprehensive-e2e-test-plan.md`
