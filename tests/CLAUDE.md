# Testing Conventions

Runtime: **Bun** test runner (`bun:test`). No Jest or Vitest.

## Parallel Execution & Isolation

The default local server-side run (`bun run test`) is `bun test --parallel`: each test
file runs in its own worker process (implies `--isolate`). CI (`scripts/check.sh` with
`CI=true`) runs the suite serially to keep the 4-vCPU runner stable, but tests **must**
still be isolation-clean:

- No reliance on cross-file shared module/global state or test ordering.
- No fixed-wall-clock timing assertions (e.g. `await wait(100); expect(count).toBeGreaterThanOrEqual(1)`).
  Under worker CPU contention the event loop starves and these flake. Poll for the
  condition instead (`waitFor(() => count >= 1)`), which still fails if the behavior
  never happens but tolerates scheduling jitter. For upper-bound "didn't hang" checks,
  keep the bound generous.
- Real HTTP servers must bind a unique port per file (avoid cross-worker collisions).

`setupTestDb()` deserializes a once-migrated in-memory snapshot rather than replaying
all migrations per test (~190x cheaper per call); the snapshot is cached by migration
set in `tests/utils/test-helpers.ts`. Use `bun test:serial` to debug isolation-sensitive
failures.

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

- `bun test:stories` is **Tier 0: Hermetic Full-Stack Stories**. It exercises real in-process application composition from chat input through the scripted LLM/tool loop, task operations, settings, context scopes, and plugin integrations. Fake transports and strict declared HTTP routes replace live providers; use it as the fast architecture-refactor regression gate.
- Default `bun run test` excludes all of `tests/stories/**`. Run `bun test:stories:contracts` explicitly for every harness unit/contract test, then `bun test:stories` for user stories; CI runs both commands so harness coverage is not lost.
- The story child starts with `--no-env-file` and inherits only `PATH`, `HOME`, `TMPDIR`, and `CI`, plus `TZ=UTC` and its launcher marker. Live network/process access, undeclared HTTP, active timer/listener leaks, and writes outside the scenario temp root fail immediately. Do not weaken these guards or add retries. Failures should be diagnosed from the recent sanitized event trace.
- `bun test:stories:stress` repeats/randomizes with deterministic seed `41021`. `bun test:stories:manifest` is manifest-only: it removes stale JUnit output and never discovers or spawns stories. `BASE_REF=<sha> bun test:stories:compat --manifest-only` is the preflight-only refactor proof. An explicit `--baseline-ref=<sha>` also activates compatibility; missing or invalid refs and mismatches fail before child spawn.
- Manifest scenario IDs cover literal `scenario(...)` and nested `executeScenario(...)` calls in story files, so logical scenario count can exceed the number of Bun/JUnit test cases. Their callback `then` chains are frozen checkpoint metadata.
- Refactor qualification freezes **every regular file** under `tests/stories/**` plus `scripts/test-stories.ts`, `scripts/story-manifest*.ts`, `scripts/story-runner*.ts`, and `scripts/story-reports.ts` byte-for-byte. The candidate may change production/runtime composition only. Establish and commit the harness and enforcement files on master, record the manifest `treeHash` and baseline SHA, rebase the refactor onto it, and run compatibility against that SHA. A ref predating the enforcement files is incompatible and reports them as added. Reports are generated under ignored `reports/stories/` as `manifest.json` and `junit.xml`.
- Run E2E with `bun test:e2e`.
- The Docker-backed Kaneo harness is **Tier 1: Provider-Real E2E**. Tier 0 does not replace it; provider-real tests remain responsible for Kaneo/container/API behavior.
- Prefer `KaneoTestClient` for new resource-management-heavy suites.
- Track resources created outside the test client with `testClient.trackTask(...)` or the matching tracker helper when the suite uses `KaneoTestClient`.
- The suite is in transition: many files already rely on shared preload/setup, but some older E2E files still use local `beforeAll`/`afterAll` hooks or manual cleanup. Follow the local pattern unless you are intentionally modernizing that suite.
- Before proposing new E2E coverage, read `docs/superpowers/e2e-planning-workflow.md` and start from `docs/superpowers/templates/e2e-test-plan-template.md`.

## Mutation testing

For accurate mutation scores that bypass the runner's static-bucket artifact,
use `bun test:mutate:file <path>` for focused work, `bun test:mutate:changed`
for changed files, and `bun test:mutate` for the configured full mutate scope
(see `scripts/mutation/README.md`).
