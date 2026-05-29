# Testing Conventions

Runtime: **Bun** test runner (`bun:test`). No Jest or Vitest.

## Test Helpers

Use helpers from `tests/utils/test-helpers.ts` unless a test already follows a local pattern for a specialized reason.

Common helpers include:

- `mockLogger()`
- `setupTestDb()`
- `createMockReply()`
- `createDmMessage()`
- `createGroupMessage()`
- `createAuth()`
- `createMockChat()` and `createMockChatForBot()`
- `mockMessageCache()`
- `expectAppError()`
- `schemaValidates()`
- `getToolExecutor()`
- `setMockFetch()` / `restoreFetch()`
- `createMockTask()` / `createMockProject()` / `createMockLabel()` / `createMockColumn()`

`createMockProvider()` lives in `tests/tools/mock-provider.ts`.

## Mocking Rules

- Prefer dependency injection over module mocking whenever the source module already exposes a `Deps` interface.
- Do not mock `globalThis.fetch` directly; use `setMockFetch()` and `restoreFetch()`.
- Use `mock()` for spy functions.
- When a suite must use `mock.module()`, be precise about why and keep the mocked boundary narrow.

## Mock Reset Model

The preload `tests/mock-reset.ts` restores a known set of commonly mocked modules in a global `beforeEach`, and runs `mock.restore()` in a global `afterEach`.

That means:

- do not add `afterAll(() => { mock.restore() })` just to clean up common mocks
- if you introduce a new long-lived mocked module that should be reset automatically, add it to `tests/mock-reset.ts`
- suite-level `beforeEach` can still apply additional `mock.module()` overrides after the preload reset

## Important Reality Check

The repo currently contains both modern DI-first tests and legacy `mock.module()` plus delayed-import suites.

- Prefer the DI-first pattern for new tests.
- Do not rewrite existing stable tests just to match DI unless the work already touches that area.
- When a test relies on module evaluation order, use the existing delayed-import pattern intentionally and keep it local to that suite.

## New Test File Pattern

For most new tests, use this shape:

```typescript
import { beforeEach, describe, expect, test } from 'bun:test'

import { functionUnderTest } from '../../src/module.js'
import type { SomeDeps } from '../../src/module.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('module', () => {
  let deps: SomeDeps

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()

    deps = {
      dependency: () => value,
    }
  })

  test('does something', async () => {
    const result = await functionUnderTest(input, deps)
    expect(result).toEqual(expected)
  })
})
```

## Legacy Module-Mock Pattern

When DI is not available and module evaluation order matters:

- keep `mock.module()` inside `beforeEach` or another controlled setup path when feasible
- if the suite truly needs top-level snapshot imports or top-level mocks, document that constraint in the file
- use delayed `await import()` in the suite when the module must be loaded after the mock is installed

## Schema and Tool Tests

- Use `schemaValidates()` for input-schema acceptance/rejection checks.
- Use `getToolExecutor()` to invoke tool `execute` safely from tests.
- Tool tests should assert structured outputs, including confirmation-required and failure-result shapes when applicable.

## E2E Testing

- Run E2E with `bun test:e2e`.
- The current Docker-backed Kaneo harness is **Tier 1: Provider-Real E2E**.
- Prefer `KaneoTestClient` for new resource-management-heavy suites.
- Track resources created outside the test client with `testClient.trackTask(...)` or the matching tracker helper when the suite uses `KaneoTestClient`.
- The suite is in transition: many files already rely on shared preload/setup, but some older E2E files still use local `beforeAll`/`afterAll` hooks or manual cleanup. Follow the local pattern unless you are intentionally modernizing that suite.
- Before proposing new E2E coverage, read `docs/superpowers/e2e-planning-workflow.md` and start from `docs/superpowers/templates/e2e-test-plan-template.md`.

## Mutation testing

For accurate per-file mutation scores that bypass the runner's static-bucket
artifact, use `bun test:mutate:file <path>` (see `scripts/mutation/README.md`).
The legacy `bun test:mutate` is whole-repo and intentionally lenient on
measurement; the paired runner is what real quality work should use.
