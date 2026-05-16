# E2E Tests

End-to-end tests for papai that test against a real Kaneo API instance.

## Overview

These tests verify the integration between papai and the Kaneo API by:

1. Starting a Kaneo server via Docker Compose
2. Provisioning a test user and workspace
3. Running tests against the live API
4. Cleaning up resources and stopping the server

## Planning New E2E Coverage

Before drafting a new papai E2E plan, read `docs/superpowers/e2e-planning-workflow.md` and start from `docs/superpowers/templates/e2e-test-plan-template.md`.

Treat the current Docker-backed Kaneo suite as **Tier 1: Provider-Real E2E** in that workflow.

Only promote scenarios to higher tiers when they need full runtime, platform, or operational boundaries that Tier 1 cannot prove.

## Running E2E Tests

### Prerequisites

- Docker and Docker Compose installed
- `.env` file configured with required variables:
  - `KANEO_POSTGRES_PASSWORD`
  - `KANEO_AUTH_SECRET`
  - `KANEO_CLIENT_URL`

### Run Tests

```bash
# Run the full Kaneo E2E suite with the shared preload harness
IMAGE=papai:e2e bun test:e2e

# Run one E2E suite through the aggregated entrypoint to preserve teardown
IMAGE=papai:e2e bun test --preload ./tests/e2e/bun-test-setup.ts --path-ignore-patterns '' tests/e2e/e2e.test.ts --test-name-pattern 'E2E: Task Lifecycle'
```

## How It Works

### Automatic Docker Lifecycle

The E2E setup automatically manages the Kaneo server:

1. **Before tests**: `getE2EConfig()` starts the Docker containers and waits for the server to be healthy
2. **During tests**: Tests run against the live Kaneo API at `localhost:11337`
3. **After tests**: `cleanupE2E()` stops and removes the Docker containers

### Docker Services

The following services are started via `docker-compose.yml` + `docker-compose.test.yml`:

- `kaneo-postgres`: PostgreSQL database (port 5432 internally)
- `kaneo`: Combined Kaneo web/API server (exposed on port 11337)

### Configuration

#### Environment Variables

| Variable             | Description                          | Default                  |
| -------------------- | ------------------------------------ | ------------------------ |
| `E2E_KANEO_URL`      | Base URL for E2E tests to connect to | `http://localhost:11337` |
| `KANEO_INTERNAL_URL` | Internal Kaneo base URL              | Same as `E2E_KANEO_URL`  |
| `KANEO_CLIENT_URL`   | Public URL for auth requests         | Same as base URL         |

## Test Structure

The suite uses a shared preload harness and per-file resource setup:

```typescript
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { createTestClient } from './kaneo-test-client.js'

describe('E2E: Feature Name', () => {
  let testClient

  beforeEach(async () => {
    testClient = createTestClient()
    // ... create project or other test resources
  })

  afterEach(async () => {
    await testClient.cleanup()
  })

  test('specific test case', async () => {
    // Test implementation
  })
})
```

## Test Client

Use `KaneoTestClient` from `kaneo-test-client.ts` for per-test resource management. `createTestProject()` already tracks created projects for cleanup.

```typescript
import { createTestClient } from './kaneo-test-client.js'

const testClient = createTestClient()
const kaneoConfig = testClient.getKaneoConfig()
const workspaceId = testClient.getWorkspaceId()

// Create resources
const project = await testClient.createTestProject('Test Project')

// Track resources created outside KaneoTestClient helpers
testClient.trackTask(task.id)

// Cleanup in afterEach when the file uses explicit teardown
await testClient.cleanup()
```

`bun-test-setup.ts` handles shared Kaneo environment setup before files run, and `e2e.test.ts` owns the final suite teardown.

## Raw API Oracle

`kaneo-api-helpers.ts` is a narrow raw Kaneo API helper for assertions that need a direct provider-level oracle.

Prefer it for small response checks that confirm papai behavior against Kaneo's real API without turning E2E suites into a second client layer.

## Cleanup

The test runner handles cleanup automatically:

1. **Harness-level**: `bun-test-setup.ts` starts the shared Kaneo environment once for the run
2. **Test-level**: resource-heavy files usually create a fresh `KaneoTestClient` in `beforeEach` and clean tracked resources in `afterEach`
3. **Suite-level**: `e2e.test.ts` tears down the shared environment after the aggregated suite finishes
4. **Signal handling**: SIGINT/SIGTERM are caught to ensure cleanup runs even on interruption

## Troubleshooting

### Server not starting

Check Docker logs:

```bash
docker compose -f docker-compose.yml -f docker-compose.test.yml logs kaneo
```

### Port already in use

If port 11337 is already in use, you can change it via `KANEO_API_PORT`:

```bash
KANEO_API_PORT=11338 IMAGE=papai:e2e bun test:e2e
```

### Tests failing with connection refused

The server might not be ready. Check that all services are healthy:

```bash
docker-compose -f docker-compose.yml -f docker-compose.test.yml ps
```

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   E2E Tests     │────▶│  Docker Lifecycle │────▶│  Kaneo Server   │
│  (Bun test)     │     │ (global-setup.ts)│     │  (Docker)       │
└─────────────────┘     └──────────────────┘     └─────────────────┘
         │                       │                        │
         │              ┌────────┴────────┐              │
         │              │  Start: docker-  │              │
         │              │  compose up -d  │              │
         │              └────────┬────────┘              │
         │                       │                        │
         │              ┌────────┴────────┐              │
         │              │  Wait: Health    │              │
         │              │  check loop      │              │
         │              └────────┬────────┘              │
         │                       │                        │
         │              ┌────────┴────────┐              │
         │              │  Stop: docker-  │              │
         │              │  compose down   │              │
         │              └─────────────────┘              │
```

## Files

- `bun-test-setup.ts` - Shared preload harness for E2E setup
- `e2e.test.ts` - Aggregated E2E entry point and final teardown
- `global-setup.ts` - E2E environment setup and teardown
- `docker-lifecycle.ts` - Docker Compose management
- `kaneo-test-client.ts` - Test client for resource management
- `kaneo-api-helpers.ts` - Narrow raw API oracle helpers for direct Kaneo checks
- `task-lifecycle.test.ts` - Task CRUD tests
- `label-operations.test.ts` - Label CRUD tests
- `project-lifecycle.test.ts` - Project CRUD tests
