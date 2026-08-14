# Testing Conventions

Runtime: **Bun** test runner (`bun:test`). No Jest or Vitest.

## Running the suite

`bun run test` is a wrapper (`scripts/test/run-cli.ts`), not a bare `bun test`. It builds the client bundles
if they are missing, picks parallel or serial from the core count, and writes `reports/test/last-run.{log,junit.xml,json}`
before printing a summary of at most fourteen lines. The exit code is the child's, unchanged.

**Do not re-run a check to see its output differently.** `bun run test:failures`, `test:show <id>`,
`test:log <pattern>`, `test:status` and `test:slowest` all answer from the persisted report without starting
anything; `test:status` tells you whether the tree has moved since that run. `bun run test:affected` narrows
to the tests a change can reach (static imports, depth 2 — it prints what it cannot see). `bun run test:raw`
is the unwrapped escape hatch and leaves no report.

Two Bun behaviours the wrapper works around, both pinned by tests:

- Bun writes the `--reporter-outfile` **only** when at least one file loads, so the wrapper deletes the
  previous JUnit before spawning. Without that, a catastrophic run would be silently described by the
  previous run's index.
- Bun does **not** propagate later `process.env` mutations to child processes the way Node does. Anything a
  test's subprocesses must see (the pinned `GIT_CONFIG_GLOBAL`, for instance) has to be on the child's
  startup environment — `tests/setup.ts` cannot deliver it.

**Known Bun defect — JUnit `file` collides on basename.** Two test files with the same basename in different
directories collapse to one `file=` attribute in the JUnit report; on a full run 53 of 1306 files end up with
no record, all of them green. Run totals and failure diagnostics are unaffected (totals come from the console
log, and a mis-attributed failure trips the join's cross-check and is reported as a `joinWarning` rather than
silently mis-filed). But **do not build a gate on `report.files`** until this is fixed — that is why
`bun run analytics:privacy-contract` exists as a command and is not wired into `check:full`. Reproduce with
`bun test tests/analytics/aggregate-release.test.ts tests/analytics/delivery/aggregate-release.test.ts`:
`Ran 10 tests across 2 files`, one file in the XML.

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
- Scenarios must not leave net `process.env` mutations: the I/O guard fails unrestored changes at teardown. A transient set/restore inside a scenario is technically sanctioned but should be rare — prefer a `given.*` fixture seam when a behavior needs configuration (e.g. `given.publicBaseUrl(url)` sets `SETTINGS_PUBLIC_BASE_URL` and restores it in `fixtures.teardown`).
- `bun test:stories:stress` repeats/randomizes with deterministic seed `41021`. `bun test:stories:manifest` is manifest-only: it removes stale JUnit output and never discovers or spawns stories. `BASE_REF=<sha> bun test:stories:compat --manifest-only` is the preflight-only refactor proof. An explicit `--baseline-ref=<sha>` also activates compatibility; missing or invalid refs and mismatches fail before child spawn.
- Manifest scenario IDs cover literal `scenario(...)` and nested `executeScenario(...)` calls in story files, so logical scenario count can exceed the number of Bun/JUnit test cases. Their callback `then` chains are frozen checkpoint metadata.
- Refactor qualification freezes **every regular file** under `tests/stories/**`; `scripts/story/**`; plus `bunfig.toml`, `tests/setup.ts`, `tests/mock-reset.ts`, `tests/utils/test-helpers.ts`, `tests/utils/logger-mock.ts`, and the `scripts/coverage/` modules the enforcement tree imports (`normalize-lcov.ts`, `ratchet-lib.ts`, `story-coverage-gate.ts`) byte-for-byte. The snapshot must carry every relative import reachable from `scripts/story/**`, or the sandboxed runner cannot load; `tests/scripts/story-enforcement-imports.test.ts` guards that. The runner hashes and executes the same captured bytes from a read-only temporary snapshot while resolving production `src/` and `plugins/` from the live candidate; it verifies snapshot integrity before and after the child and always removes that snapshot after the child exits or setup fails. The candidate may change production/runtime composition only. Establish and commit all frozen files on master, record the manifest `treeHash` and baseline SHA, rebase the refactor onto it, and run compatibility against that SHA. A ref predating frozen inputs is incompatible and reports them as added. Reports are generated under ignored `reports/stories/` as `manifest.json` and `junit.xml`.
- The compatibility proof is a **behavioral + seam-API** proof: the frozen harness bytes consume `createPapaiRuntime`, `createProductionRuntimeDeps`, the `web.route`/`application.setupBot`/`buildModel` DI points, and the capability catalog. A refactor must preserve those TypeScript shapes or land the seam change on master before the baseline is recorded — see `docs/architecture/commands.md`.
- Run E2E with `bun test:e2e`.
- The Docker-backed Kaneo harness is **Tier 1: Provider-Real E2E**. Tier 0 does not replace it; provider-real tests remain responsible for Kaneo/container/API behavior.
- Every catalog record carries a **proving tier** — the lowest tier that can prove the behavior — in `tests/stories/catalog/coverage.ts`. Executable records may only claim a tier in `LIVE_STORY_TIERS`, and their story ids must sit under that tier's `TIER_SUITE_ROOTS` prefix. Seam-pending records name the tier that unblocks them; `blocked:missing-implementation` records name none, because no tier reaches them. The runner prints per-tier totals on every run.
- The 0Q compatibility proof is Tier 0 only. Higher tiers are regression lanes and never gate a refactor qualification. Canonical tier definitions: the Realism Tiers table in `docs/operations/e2e-planning-workflow.md` (the original owning spec is archived in `docs/archive/`).
- Prefer `KaneoTestClient` for new resource-management-heavy suites.
- Track resources created outside the test client with `testClient.trackTask(...)` or the matching tracker helper when the suite uses `KaneoTestClient`.
- The suite is in transition: many files already rely on shared preload/setup, but some older E2E files still use local `beforeAll`/`afterAll` hooks or manual cleanup. Follow the local pattern unless you are intentionally modernizing that suite.
- Before proposing new E2E coverage, `/opsx:propose` a change and plan the coverage in its `openspec/changes/<name>/` artifacts; the e2e planning workflow (`docs/operations/e2e-planning-workflow.md`) and test-plan template (`docs/operations/templates/e2e-test-plan-template.md`) define the expected structure.

### Tier 3 — platform-adapter lane (`tests/platform/`, nightly)

Real adapter code (Mattermost) exercised in-container against fake platform
servers (HTTP/WS), reusing the T2 harness (`tests/smoke/harness/`). Scenario
files use the non-discovered `.platform.ts` suffix, so the default `bun test`
never boots Docker. Run locally with `bun run test:platform`. The lane is
**nightly only** (`.github/workflows/nightly.yml`), never a PR gate. Live
scenarios: `SCN-fetch-chat-link` (permalink resolver) and
`SCN-http-mattermost-action` (signed action-callback route). The Discord and
Telegram interaction pends remain `needs-seam@3`, deferred until fake
discord.js / grammY servers exist. The action-callback scenario relies on the
`PAPAI_MATTERMOST_ACTION_SIGNING_SECRET` env seam so the container verifies
against a test-known secret.

### Coverage floor

The in-process suite's production-code coverage (`src/` + `plugins/`) is gated in
CI. The floor lives in `scripts/coverage/floor.json` and is enforced by
`bun coverage:ratchet`, which the CI-serial `test` run inside `scripts/check.sh`
executes after `bun test --coverage` passes. The metric is the **unweighted
per-file mean** of the lcov records — the same number bun's text reporter prints
on its `All files` row — not a line-weighted total.

The floor is deliberately _not_ bunfig's `coverageThreshold`: that key is a
per-file rule (every file must individually clear the bar), so it cannot express
an aggregate floor, and it fails with no output naming coverage as the cause.
`bun test --coverage` therefore never fails on coverage by itself; only the
ratchet gates.

Local `check:full` (`--parallel`) does not collect coverage. To check the floor
locally, run `bun test:coverage` and then `bun coverage:ratchet`, which prints
`measured` vs `floor`. Do this on a full run only: bun's coverage denominator
spans every discovered production file, not just the subset's imports, so a
subset run measures far below the floor regardless of that file's own coverage.
When coverage improves, raise the floor from a green full run with
`bun coverage:ratchet --update` and commit the `floor.json` change; the script
never lowers the floor.

### T0 story-lane line coverage

`bun test:stories:coverage` runs the hermetic story lane with `--coverage`,
copies the sandbox child's lcov to `reports/stories/coverage/lcov.info`, and
fails the run if production-code (`src/` + `plugins/`) line/function coverage
drops below the committed floor in `scripts/story/coverage-floor.json` (starts
at `0.50/0.50`, unmeasured). This is the refactor-resilient tier's own
reachability number, separate from the in-process floor in `bunfig.toml` (see
the Coverage floor section above). Raise it from a green run with
`bun coverage:ratchet:stories`, then commit the JSON change. CI runs the
coverage variant in the `stories` job and never writes the floor.

## Mutation testing

For accurate mutation scores that bypass the runner's static-bucket artifact,
use `bun test:mutate:file <path>` for focused work, `bun test:mutate:changed`
for changed files, and `bun test:mutate` for the configured full mutate scope
(see `scripts/mutation/README.md`). `test:mutate:changed` reuses scores recorded
by an earlier run for files whose source, tests and toolchain all hash the same,
so a repeat run is near-instant; `--no-score-cache` re-measures everything.
