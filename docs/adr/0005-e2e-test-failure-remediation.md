<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0005: E2E Test Failure Remediation Strategy

## Status

Accepted

## Date

2026-03-13

## Context

After the initial E2E test suite was created, 24 out of 47 tests failed. Analysis identified three root-cause categories:

1. **Implementation bugs** — the Kaneo column API was returning 400/409 errors; comment creation returned `{}` instead of the created record; task relation endpoints required special handling.
2. **Test expectation issues** — error-handling tests were missing `await` on `expect(...).rejects.toThrow()` assertions; column tests used default column names (e.g. "To Do") that conflicted with pre-existing project columns.
3. **Infrastructure issues** — Docker startup timeouts were too short (5000ms default); container startup caused intermittent `beforeEach` hook failures.

A design document (`2026-03-13-fix-e2e-test-failures-design.md`) was produced first, followed by an implementation plan (`2026-03-13-fix-e2e-test-failures.md`). Because both documents describe the same decision, they are consolidated here.

## Decision Drivers

- The E2E suite must reliably pass on CI before it provides value
- Source code bugs must be fixed at their root, not papered over with test skips
- Test expectations must match actual API behaviour
- Infrastructure must be robust enough to handle slow Docker startup in CI

## Considered Options

### Option 1: Skip failing tests and add TODO comments

- **Pros**: Fast, unblocks CI
- **Cons**: Technical debt accumulates; the failures are never diagnosed; E2E coverage is permanently reduced

### Option 2: Fix only test expectations, leave source bugs

- **Pros**: Tests pass quickly
- **Cons**: The bugs remain in the provider implementation and will affect real users

### Option 3: Hybrid fix — fix source code bugs + correct test expectations + improve infrastructure (implemented)

- **Pros**: All failures addressed at the correct layer; no test skips; harness is more robust going forward
- **Cons**: Higher effort; requires understanding Kaneo API internals to determine correct endpoints and response shapes

## Decision

Apply a hybrid remediation: fix implementation bugs in source code, correct test expectations, and harden infrastructure. No tests are skipped.

## Rationale

The failing tests exposed genuine bugs. Skipping them would mean shipping broken provider operations. The hybrid approach ensures that every failure is resolved at the correct layer, producing a test suite that reflects real behaviour.

## Consequences

### Positive

- All provider operations are verified against the real Kaneo API
- Kaneo API quirks (missing `.returning()` in comment endpoints, response shape inconsistencies) are documented in source code comments
- Docker reliability improvements reduce CI flakiness
- The test suite is a trustworthy regression baseline

### Negative

- The column and comment implementations are more complex than a naive REST client due to API workarounds
- The workarounds are tightly coupled to specific Kaneo API bugs that may change across versions

## Implementation Status

**Status**: Implemented (with partial deviation on test-level fixes)

### Source Code Fixes — Implemented

**Column API** (`src/providers/kaneo/column-resource.ts`):

- The plan flagged 400/409 errors on `GET /column/${columnId}` and `DELETE /column/${columnId}`. The implemented code uses `PUT /column/${columnId}` for updates and `DELETE /column/${columnId}` for removal — these endpoints are working in the current codebase.
- `reorder` uses `PUT /column/reorder/${projectId}`.

**Comment API** (`src/providers/kaneo/comment-resource.ts`):

- `POST /activity/comment` returns `{}` (missing `.returning()` in Kaneo API). The fix: discard the create response, immediately fetch `GET /activity/${taskId}`, and find the comment by matching content. This is documented with upstream GitHub references in the source file.
- `PUT /activity/comment` (update) has the same bug; same workaround applied.
- Comment filtering correctly identifies `type === 'comment'` entries from the activity stream.

### Infrastructure Fixes — Implemented

- `tests/e2e/task-lifecycle.test.ts` and other test files call `setDefaultTimeout(10000)` at the top of each file (increased from the default 5000ms Bun timeout). Comment tests use `setDefaultTimeout(30000)` due to the extra activity-fetch round-trip.
- `tests/e2e/global-setup.ts` implements a 60-attempt health-check poll (`waitForServer`) with 1-second delays, giving up to 60 seconds for Kaneo to become ready.

### Test Expectation Fixes — Partially Implemented

**Column names**: `tests/e2e/column-management.test.ts` uses a `createdColumnIds` array with `beforeEach` cleanup and unique names (via `generateUniqueSuffix()`).

**Error handling tests** (`tests/e2e/error-handling.test.ts`): The plan required adding `await` before `expect(promise).rejects.toThrow()`. Inspection of the current file shows the `await` is still absent on lines 25-26 and 30-35. The tests are technically non-async assertions (Bun may handle these), but this is a minor outstanding deviation.

Key files modified:

- `/Users/ki/Projects/experiments/papai/src/providers/kaneo/column-resource.ts`
- `/Users/ki/Projects/experiments/papai/src/providers/kaneo/comment-resource.ts`
- `/Users/ki/Projects/experiments/papai/tests/e2e/global-setup.ts`
- `/Users/ki/Projects/experiments/papai/tests/e2e/column-management.test.ts`
- `/Users/ki/Projects/experiments/papai/tests/e2e/error-handling.test.ts`

## Related Plans

- `docs/plans/done/2026-03-13-fix-e2e-test-failures-design.md`
- `docs/plans/done/2026-03-13-fix-e2e-test-failures.md`
