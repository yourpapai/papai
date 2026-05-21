<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0003: E2E Test Harness with Docker Compose

## Status

Accepted

## Date

2026-03-13

## Context

The papai project integrates with the Kaneo task tracker REST API via a provider abstraction layer. Unit tests mock the HTTP layer, but this leaves a gap: no tests verified that the actual Kaneo API contract matched the tool implementations. Bugs in endpoint paths, request/response shapes, or error handling could only be caught at runtime.

A dedicated E2E test harness was needed to run tests against a real Kaneo instance so that the integration could be validated end-to-end.

## Decision Drivers

- Kaneo is a multi-service application (API server, PostgreSQL, optional web UI) that is already containerised via `docker-compose.yml`
- The project already had `docker-compose.test.yml` that exposes the API on a fixed port (11337) for local testing
- The Bun test runner supports `preload` scripts, enabling global setup to run before any test file
- Test isolation was required: each test must not be polluted by resources created in another test
- Docker container start/stop overhead should be minimised (one start per full test run, not per file)

## Considered Options

### Option 1: Mock-only testing

- **Pros**: Fast, no external dependencies, deterministic
- **Cons**: Does not exercise real HTTP, misses API contract bugs, gives false confidence

### Option 2: Per-file Docker lifecycle (original plan)

- **Pros**: Simple mental model, each file manages its own environment
- **Cons**: Container startup cost multiplied across every test file; Docker state conflicts between parallel files

### Option 3: Global singleton Docker lifecycle with per-test resource isolation (implemented)

- **Pros**: Single Docker start/stop per run; per-test `beforeEach` cleanup prevents cross-contamination; preload script ensures containers are ready before any test file loads
- **Cons**: More complex infrastructure; tests are not fully self-contained

## Decision

Implement a global singleton Docker lifecycle managed by a `bun-test-setup.ts` preload script, combined with per-test resource cleanup via a `KaneoTestClient` helper class.

## Rationale

A single Docker start per test run avoids the prohibitive overhead of per-file container management. The `--preload` mechanism in the Bun test runner is the correct integration point for global setup. Per-test `beforeEach` cleanup via `KaneoTestClient` provides test isolation without restarting containers.

## Consequences

### Positive

- Real API integration is verified on every CI run
- API contract bugs (endpoint paths, response shapes, error codes) are caught before release
- Tests run against the same Docker images used in production
- Single container startup minimises total test duration

### Negative

- E2E tests require Docker, so they cannot run in environments without Docker
- E2E tests must be invoked separately (`bun run test:e2e`), not via bare `bun test`
- Container startup adds baseline latency (~10-60 seconds depending on image pull status)
- Any test that fails to clean up its resources will pollute subsequent tests

## Implementation Status

**Status**: Implemented (with deviations from original plan)

The original plan (`docs/plans/done/e2e-test-harness.md`) proposed:

- A `tests/e2e/setup.ts` with `setupE2EEnvironment()` / `teardownE2EEnvironment()` called in per-file `beforeAll`/`afterAll`
- A `KaneoTestClient` importing from `src/kaneo/` paths

The actual implementation diverged in the following ways:

- **Global singleton pattern**: `tests/e2e/global-setup.ts` exports `getE2EConfig()` (returns a singleton `Promise<E2EConfig>`), eliminating duplicate provisioning across files. There is no `setup.ts`; individual test files call `getE2EConfigSync()` instead.
- **Preload-based setup**: `tests/e2e/bun-test-setup.ts` is loaded via `--preload` flag (configured in `package.json` `test:e2e` script), ensuring Docker starts before any test file is evaluated.
- **Docker lifecycle extracted**: `tests/e2e/docker-lifecycle.ts` wraps `docker compose up/down` via `child_process.spawn`, guarded by a `dockerStarted` flag to prevent double-start.
- **Provider path migration**: `KaneoTestClient` imports from `src/providers/kaneo/` (the refactored provider abstraction path), not `src/kaneo/` as planned.
- **Label cleanup added**: `KaneoTestClient` tracks labels (`createdLabelIds`) in addition to projects and tasks, using `removeLabel` for cleanup.
- **Test orchestrator**: `tests/e2e/e2e.test.ts` imports all test suites and provides a single entry point; `package.json` runs `tests/e2e/e2e.test.ts` rather than the whole directory.
- **`test-helpers.ts`**: Added `generateUniqueSuffix()` and async `getSharedKaneoConfig()` / `getSharedWorkspaceId()` helpers used by some test files alongside `KaneoTestClient`.
- **Timeout**: Tests call `setDefaultTimeout(10000)` (task tests) and up to `setDefaultTimeout(30000)` (comment tests), rather than configuring timeout in the setup module.

Key files:

- `/Users/ki/Projects/experiments/papai/tests/e2e/bun-test-setup.ts`
- `/Users/ki/Projects/experiments/papai/tests/e2e/global-setup.ts`
- `/Users/ki/Projects/experiments/papai/tests/e2e/docker-lifecycle.ts`
- `/Users/ki/Projects/experiments/papai/tests/e2e/kaneo-test-client.ts`
- `/Users/ki/Projects/experiments/papai/tests/e2e/test-helpers.ts`
- `/Users/ki/Projects/experiments/papai/tests/e2e/e2e.test.ts`
- `/Users/ki/Projects/experiments/papai/tests/e2e/.env.e2e.example`

## Related Plans

- `docs/plans/done/e2e-test-harness.md`
