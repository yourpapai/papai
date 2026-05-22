<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Incremental Dependency Injection Refactor

**Status:** Design only (long-term roadmap)
**Goal:** Eliminate all `mock.module()` calls by making dependencies explicit
parameters, so tests pass fakes directly without module-level mocking.
**Predecessor:** `2026-04-01-migrate-mock-module-to-spyon.md` (tasks 1-9
completed, introduced wrapper modules and `_set*`/`_reset*` patterns).

---

## Problem

Even with the global mock reset preload (see
`2026-04-05-mock-pollution-global-reset.md`), `mock.module()` remains a
process-global mechanism that we work around rather than eliminate. The preload
reset requires maintaining a hardcoded registry of mocked modules and relies on
Bun-specific live binding behavior. DI removes the root cause.

## Pattern

Each module that currently imports a dependency at the top level gets a `deps`
parameter with a sensible default that preserves current behavior for production
callers:

```typescript
// Before
import { getDrizzleDb } from './db/drizzle.js'

export function getConfig(userId: string, key: string) {
  const db = getDrizzleDb()
  // ...
}

// After
import { getDrizzleDb, type DbInstance } from './db/drizzle.js'

interface ConfigDeps {
  getDb: () => DbInstance
}

const defaultDeps: ConfigDeps = { getDb: getDrizzleDb }

export function getConfig(userId: string, key: string, deps: ConfigDeps = defaultDeps) {
  const db = deps.getDb()
  // ...
}
```

Tests pass fakes directly:

```typescript
test('getConfig returns value', async () => {
  const testDb = await setupTestDb()
  const result = getConfig('user1', 'key', { getDb: () => testDb })
  expect(result).toBe('expected')
})
```

No `mock.module()`, no spyOn, no cleanup needed.

## Prior work

The `2026-04-01-migrate-mock-module-to-spyon.md` plan completed:

- `src/db/index.ts` -- `_setMigrationDb` / `_resetMigrationDb` setters
- `src/lib/ai-wrapper.ts` -- wrapper for `ai` library with `_set*`/`_reset*`
- `src/lib/ai-sdk-wrapper.ts` -- wrapper for `@ai-sdk/openai-compatible`
- `src/conversation.ts`, `src/llm-orchestrator.ts`, `src/memory.ts` -- updated
  to use wrapper imports
- `tests/memory.test.ts`, `tests/conversation.test.ts` -- migrated to spyOn

These wrappers with `_set*`/`_reset*` are a stepping stone toward full DI. The
DI refactor supersedes them: once a module accepts `deps`, the wrapper and its
test-only setters become unnecessary.

## Migration priority

Ordered by number of `mock.module()` calls (highest pollution risk first):

| Phase | Module                          | Files affected | Effort | Notes                                    |
| ----- | ------------------------------- | -------------- | ------ | ---------------------------------------- |
| 1     | `src/db/drizzle.js`             | 16             | High   | Most callers, highest impact             |
| 2     | `ai` + `@ai-sdk/openai-compat`  | 5              | Medium | Wrappers already exist (prior work)      |
| 3     | `src/db/index.js`               | 4              | Medium | Overlaps with phase 1                    |
| 4     | `src/logger.js`                 | 4              | Low    | Simple interface, object already spyable |
| 5     | Remaining (6 modules, 1-2 each) | ~8             | Low    | Isolated, low risk                       |

## Rules for incremental migration

- One module per PR -- never mix DI refactors.
- After migrating a module, remove it from `tests/mock-reset.ts` originals list.
- Each PR must pass `bun test --randomize`.
- The global mock reset preload acts as safety net during the transition.
- Production callers are unchanged (default `deps` parameter).
- Avoid over-engineering: only inject dependencies that are actually mocked in
  tests. If a dependency is never mocked, keep the direct import.

## End state

- Zero `mock.module()` calls in the test suite.
- `tests/mock-reset.ts` deleted (no modules to reset).
- `src/lib/ai-wrapper.ts` and `src/lib/ai-sdk-wrapper.ts` deleted (replaced by
  direct DI).
- Tests are inherently isolated regardless of runner behavior or execution order.
- `bun test --randomize` passes reliably.
