<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0048: Global Mock Reset via Preload

## Status

Accepted

## Context

Bun's `mock.module()` is process-global and permanent. `mock.restore()` does NOT reset module mocks — only spies. Since Bun runs all test files in a single process, mocks leak between files, causing tests to fail randomly depending on execution order.

The project had 41 test files with 61 `mock.module()` invocations across 14 unique modules. All `afterAll(() => { mock.restore() })` calls were ineffective for module mocks.

## Decision Drivers

- **Must eliminate test flakiness** caused by mock pollution
- **Must support randomized test execution** (`bun test --randomize`)
- **Should minimize changes to source code** (test-only solution preferred)
- **Should be maintainable** by the team
- **Should not significantly slow down tests**

## Considered Options

### Option 1: Global Mock Reset via Preload (Selected)

Create a preload script that captures real module exports at startup and restores them in a global `beforeEach`.

- **Pros**: Non-invasive to source code, centralized management, leverages Bun's preload mechanism, no performance impact
- **Cons**: Requires discipline to call mocks in `beforeEach` not top-level, additional complexity in test infrastructure

### Option 2: Per-Test Database/Process Isolation

Spin up separate Bun processes or use worker threads for each test file.

- **Pros**: Complete isolation, no risk of pollution
- **Cons**: Massive performance hit (would increase test time by 10x+), complex orchestration needed

### Option 3: Dependency Injection Migration (Long-term)

Migrate all modules to use dependency injection instead of `mock.module()`.

- **Pros**: Clean architecture, no mocking needed, easier testing
- **Cons**: Massive refactoring effort, would touch production code, not a short-term fix
- **Note**: This is planned as a long-term refactor (see ADR-0047), but the global reset is needed as an immediate solution

### Option 4: Manual Mock Cleanup

Continue with manual `mock.restore()` calls and careful ordering of imports.

- **Pros**: No new infrastructure needed
- **Cons**: Does not work (`mock.restore()` doesn't reset module mocks), fragile, high maintenance burden

## Decision

We will implement a **global mock reset preload** (`tests/mock-reset.ts`) that:

1. Captures real module exports at startup (before any test file loads)
2. Registers a global `beforeEach` that restores all originals via `mock.module()`
3. Each test file re-applies its mocks in `describe`-level `beforeEach`
4. Global `afterEach` calls `mock.restore()` for spies

## Consequences

### Positive

- All 1,987 tests pass under `bun test --randomize`
- Centralized mock management in one file
- Clear patterns for writing new tests (documented in `tests/CLAUDE.md`)
- No source code changes required
- Test execution time unchanged (~8s for full suite)

### Negative

- Test authors must follow new patterns (mocks in `beforeEach`, not top-level)
- New mocked modules must be added to `mock-reset.ts`
- Slightly more cognitive overhead for test writers

### Risks

- Risk: Module not in `mock-reset.ts` causes pollution
  - Mitigation: Documented requirement in `tests/CLAUDE.md`
  - Mitigation: Can be caught with `bun test --randomize` in CI

## Implementation

### Files Created

- `tests/mock-reset.ts` - Global mock reset preload
- Updated `bunfig.toml` - Added preload to test configuration

### Files Modified

- 70+ test files refactored to move `mock.module()` calls into `describe`-level `beforeEach`
- `tests/utils/logger-mock.ts` - Updated JSDoc
- `tests/utils/test-helpers.ts` - Updated JSDoc
- `tests/CLAUDE.md` - Complete rewrite of Mock Pollution Prevention section

### Modules Captured

| Module                             | Reason                                  |
| ---------------------------------- | --------------------------------------- |
| `ai`                               | AI SDK mocks for LLM orchestrator tests |
| `@ai-sdk/openai-compatible`        | OpenAI-compatible provider mocks        |
| `src/logger.js`                    | Logger mocks to suppress output         |
| `src/db/drizzle.js`                | Database mocks for test isolation       |
| `src/message-cache/cache.js`       | Message cache mocks                     |
| `src/providers/kaneo/provision.js` | Provider mocks                          |
| `src/providers/factory.js`         | Provider factory mocks                  |
| `src/scheduler.js`                 | Scheduler mocks                         |

## Related Decisions

- ADR-0047: Dependency Injection Test Refactor (long-term plan to eliminate `mock.module()`)
- ADR-0044: Rename Mock Pollution to Test Health

## References

- Bun issue #7823: mock.module() not reset by mock.restore()
- Bun issue #12823: mock.module() global behavior
- Implementation plan: `docs/plans/done/2026-04-05-mock-pollution-global-reset-impl.md`
- Design doc: `docs/plans/done/2026-04-05-mock-pollution-global-reset.md`
