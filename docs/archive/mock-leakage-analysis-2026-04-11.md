<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# E2E Test Isolation Issue: Mock Leakage Analysis

**Archive status:** Historical research note. Parts of this diagnosis no longer
match the current repository. `bunfig.toml` now excludes E2E and client tests
from default discovery, current `bun test` runs are green, and the active risk
is top-level unit-test `mock.module()` regression rather than default E2E
preload breakage. The canonical decision record is
`docs/adr/0054-mock-isolation-guardrails.md`. The pre-ADR design exploration is
archived at `docs/archive/mock-isolation-guardrails-design-2026-04-11.md`.

## Problem Summary

When running all tests together (`bun test`), E2E tests fail due to mock leakage from unit tests. The mocks in `tests/kaneo/*.test.ts` persist and affect E2E test execution.

## Root Cause

### Mock Registration (tests/kaneo/task-resource.test.ts:7)

```typescript
void mock.module('../../src/kaneo/list-columns.js', () => ({
  listColumns: mock(() =>
    Promise.resolve([
      createMockColumn({ id: 'col-1', name: 'To Do' }),
      createMockColumn({ id: 'col-2', name: 'In Progress' }),
      createMockColumn({ id: 'col-3', name: 'Done', isFinal: true }),
    ]),
  ),
}))
```

### Why Mocks Leak

1. **Bun's `mock.module()` mocks are global to the test process**
   - Unlike Jest's `jest.mock()` which can be isolated per test file
   - Bun's mock.module() replaces the module in the module cache globally

2. **E2E tests need `--preload` flag for Docker setup**
   - When running all tests with `bun test`, E2E tests are loaded but preload isn't applied
   - This causes "E2E environment not initialized" errors

## CI Configuration (Already Correct)

The CI is correctly configured to separate unit and E2E tests:

```yaml
# Unit tests job
- name: Test
  run: bun run test # runs: bun test tests/kaneo tests/tools tests/providers...

# E2E tests job
- name: Run E2E tests
  run: bun run test:e2e # runs: bun test --preload ./tests/e2e/bun-test-setup.ts...
```

## When the Issue Occurs

**The issue only occurs locally** when running `bun test` without arguments. This loads ALL test files including E2E tests that require:

1. The `--preload` flag for Docker setup
2. No leaked mocks from unit tests

## Impact

- **594 tests pass, 45 fail** when running `bun test` without arguments
- E2E tests fail with "E2E environment not initialized"
- Unit tests fail due to mock pollution from other test files

## Solutions

### Solution 1: Run Tests Correctly (Recommended for Local Dev)

Always run tests using the proper npm scripts:

```bash
# Run unit tests only
bun run test

# Run E2E tests only
bun run test:e2e
```

### Solution 2: Fix Unit Test Mocks (Long-term)

Refactor unit tests to use dependency injection instead of `mock.module()`:

**Current approach (problematic):**

```typescript
// Module-level mock affects all subsequent imports
void mock.module('../../src/kaneo/list-columns.js', () => ({...}))
```

**Better approach (dependency injection):**

```typescript
// Pass mocks as parameters - no global state
const taskResource = new TaskResource(mockConfig, {
  listColumns: mock(() => Promise.resolve([...])),
})
```

### Solution 3: Configure Bun to Exclude E2E Tests

Add a `bunfig.toml` to exclude E2E tests from default runs:

```toml
[test]
exclude = ["tests/e2e/**"]
```

## Files with mock.module Issues

- `tests/kaneo/task-resource.test.ts:7` - mocks `list-columns.js`
- `tests/kaneo/column-resource.test.ts:4` - mocks `index.js`

## Current Status

**CI is correctly configured** - unit and E2E tests run in separate jobs:

- `bun run test` → unit tests only
- `bun run test:e2e` → E2E tests with Docker preload

**Local issue only** occurs when running `bun test` without arguments.

## Verification

To verify CI is working:

```bash
# Run unit tests (should pass)
bun run test

# Run E2E tests (should pass with Docker)
bun run test:e2e
```

---

_Document updated: 2026-03-18_
