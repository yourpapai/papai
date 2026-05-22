<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Dependency Injection Test Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Incrementally eliminate `mock.module()` calls by making dependencies injectable, so tests pass fakes directly without module-level mocking.

**Architecture:** Use three strategies based on module type: (1) existing test-only setters (`_setDrizzleDb`) for singletons, (2) `deps` parameter with defaults for functions needing external services, (3) skip DI for pervasive low-risk modules (logger). Each phase removes one module from `tests/mock-reset.ts` and is independently shippable.

**Tech Stack:** Bun test runner (`bun:test`), TypeScript, drizzle-orm

**Prerequisite:** The global mock reset preload (`docs/plans/2026-04-05-mock-pollution-global-reset-impl.md`) must be implemented first. It acts as the safety net during this incremental migration.

---

## Overview

### Phase Map

| Phase | Module                         | Strategy            | Src files | Test files | Effort |
| ----- | ------------------------------ | ------------------- | --------- | ---------- | ------ |
| 1     | `src/db/drizzle.js`            | Existing setters    | 0 changes | 16         | Low    |
| 2     | `src/db/index.js`              | Remove vestigial    | 0 changes | 4          | Low    |
| 3     | `ai` + `@ai-sdk/openai-compat` | `deps` parameter    | 5 changes | 5          | Medium |
| 4     | `src/logger.js`                | Skip (79 importers) | 0         | 0          | None   |
| 5     | Remaining (6 modules)          | Case-by-case        | 6 changes | 8          | Medium |
| 6     | Cleanup                        | Remove mock-reset   | 0         | 2          | Low    |

### Rules

- One phase per PR. Never mix phases.
- After each phase, remove the migrated module from `tests/mock-reset.ts`.
- Each PR must pass `bun test --randomize`.
- Production callers are unchanged (default parameters).

---

## Phase 1: `src/db/drizzle.js` — Use existing setters

`src/db/drizzle.ts` already exports `_setDrizzleDb()` and `_resetDrizzleDb()`. These set the internal `dbInstance` that `getDrizzleDb()` returns. Tests can call these directly instead of `mock.module()`.

**Why this works:** Every src file calls `getDrizzleDb()` lazily inside functions (never at module load time). Setting `dbInstance` via `_setDrizzleDb(testDb)` makes all callers get the test DB.

### Task 1: Update `mockDrizzle()` helper

**Files:**

- Modify: `tests/utils/test-helpers.ts:156-165`

**Step 1: Read current implementation**

Read `tests/utils/test-helpers.ts:156-165`. Current:

```typescript
export function mockDrizzle(): void {
  void mock.module('../../src/db/drizzle.js', () => ({
    getDrizzleDb: (): ReturnType<typeof drizzle<typeof schema>> => {
      if (testDb === null) {
        throw new Error('Test database not initialized. Call setupTestDb() first.')
      }
      return testDb
    },
  }))
}
```

**Step 2: Replace with setter-based implementation**

```typescript
import { _setDrizzleDb, _resetDrizzleDb } from '../../src/db/drizzle.js'

export function mockDrizzle(): void {
  if (testDb === null) {
    throw new Error('Test database not initialized. Call setupTestDb() first.')
  }
  _setDrizzleDb(testDb)
}
```

Note: `setupTestDb()` already sets `testDb` to the in-memory drizzle instance. `mockDrizzle()` now simply tells drizzle.ts to use it.

Also add a cleanup function:

```typescript
export function restoreDrizzle(): void {
  _resetDrizzleDb()
}
```

**Step 3: Update `setupTestDb()` to auto-set drizzle**

Since `mockDrizzle()` depends on `testDb` being set, and `setupTestDb()` sets `testDb`, combine them: have `setupTestDb()` call `_setDrizzleDb(testDb)` automatically. Then `mockDrizzle()` becomes unnecessary for most callers.

```typescript
export async function setupTestDb(): Promise<ReturnType<typeof drizzle<typeof schema>>> {
  // ... existing code to create in-memory DB and run migrations ...
  _setDrizzleDb(testDb) // <-- add this line
  return testDb
}
```

**Step 4: Run helper tests**

Run: `bun test tests/utils/`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/utils/test-helpers.ts
git commit -m "test(helpers): replace mockDrizzle mock.module with _setDrizzleDb setter"
```

---

### Task 2: Migrate test files using `mockDrizzle()` helper

**Files (subset that use `mockDrizzle()` without inline drizzle mock):**

These files call `mockDrizzle()` at top-level or in beforeEach (after global reset migration). Since `setupTestDb()` now calls `_setDrizzleDb()` automatically, just remove the `mockDrizzle()` call.

- `tests/commands/admin.test.ts`
- `tests/commands/bot-auth.test.ts`
- `tests/commands/config.test.ts`
- `tests/commands/group.test.ts`
- `tests/commands/restrictions.test.ts`
- `tests/chat/config-editor-integration.test.ts`
- `tests/config-editor/handlers.test.ts`
- `tests/deferred-prompts/alerts.test.ts`
- `tests/deferred-prompts/execution-modes.test.ts`
- `tests/deferred-prompts/poller.test.ts`
- `tests/deferred-prompts/proactive-trigger.test.ts`
- `tests/deferred-prompts/scheduled.test.ts`
- `tests/deferred-prompts/snapshots.test.ts`
- `tests/deferred-prompts/tools.test.ts`
- `tests/group-context-isolation.test.ts`
- `tests/instructions.test.ts`
- `tests/instructions-cache.test.ts`
- `tests/llm-orchestrator-system-prompt.test.ts`
- `tests/llm-orchestrator.test.ts`
- `tests/tools/instructions.test.ts`
- `tests/tools/memo-tools.test.ts`
- `tests/wizard-integration.test.ts`
- `tests/wizard/engine.test.ts`
- `tests/wizard/integration.test.ts`
- `tests/message-cache/cache.test.ts`

**Step 1: For each file, remove `mockDrizzle()` call**

Since `setupTestDb()` now auto-sets drizzle, the `mockDrizzle()` call is redundant.

Before:

```typescript
beforeEach(async () => {
  mockDrizzle()
  testDb = await setupTestDb()
})
```

After:

```typescript
beforeEach(async () => {
  await setupTestDb()
})
```

Also remove `mockDrizzle` from the import statement.

**Step 2: Run full test suite**

Run: `bun test`
Expected: PASS

**Step 3: Commit**

```bash
git add tests/
git commit -m "test: remove mockDrizzle calls (setupTestDb auto-sets drizzle)"
```

---

### Task 3: Migrate test files with inline drizzle mock.module

**Files (these have their own `mock.module('../src/db/drizzle.js', ...)`)**:

- `tests/config.test.ts`
- `tests/users.test.ts`
- `tests/groups.test.ts`
- `tests/bot.test.ts`
- `tests/announcements.test.ts`
- `tests/recurring.test.ts`
- `tests/scheduler.test.ts`
- `tests/index-startup.test.ts`
- `tests/history.test.ts`
- `tests/persistence-ac.test.ts`
- `tests/memos.test.ts`
- `tests/memory.test.ts`
- `tests/message-cache/persistence.test.ts`

**Step 1: For each file, replace inline mock.module with setupTestDb**

Before (e.g., `config.test.ts`):

```typescript
let testDb: Awaited<ReturnType<typeof setupTestDb>>

void mock.module('../src/db/drizzle.js', () => ({
  getDrizzleDb: (): typeof testDb => testDb,
  closeDrizzleDb: (): void => {},
  _resetDrizzleDb: (): void => {},
  _setDrizzleDb: (): void => {},
}))

import { getConfig, setConfig } from '../src/config.js'

describe('Feature', () => {
  beforeEach(async () => {
    testDb = await setupTestDb()
  })
```

After:

```typescript
import { getConfig, setConfig } from '../src/config.js'

describe('Feature', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })
```

Changes:

1. Remove the `let testDb` declaration and the `mock.module('../src/db/drizzle.js', ...)` block
2. Move imports to top of file
3. Use `await setupTestDb()` in beforeEach (it auto-sets drizzle)
4. If the test needs the `testDb` reference directly (e.g., for raw SQL): `const testDb = await setupTestDb()`

**Step 2: Run each file individually**

Run each to verify:

```bash
bun test tests/config.test.ts
bun test tests/users.test.ts
# ... etc
```

Expected: Each PASS

**Step 3: Run full suite**

Run: `bun test`
Expected: PASS

**Step 4: Commit**

```bash
git add tests/
git commit -m "test: replace drizzle mock.module with _setDrizzleDb in all test files"
```

---

### Task 4: Remove drizzle from mock-reset.ts and validate

**Files:**

- Modify: `tests/mock-reset.ts`

**Step 1: Remove drizzle entries**

Remove the `_drizzle` import and the `['../src/db/drizzle.js', ...]` entry from the `originals` array.

**Step 2: Run randomized**

Run: `bun test --randomize && bun test --randomize && bun test --randomize`
Expected: ALL PASS

**Step 3: Commit**

```bash
git add tests/mock-reset.ts
git commit -m "test: remove drizzle from mock-reset (DI migration complete for drizzle)"
```

---

## Phase 2: `src/db/index.js` — Remove vestigial mocks

`src/db/index.ts` only exports `initDb` and `closeMigrationDbInstance`. No src file imports `getDb` or `DB_PATH` from it — those exports don't exist. Test files mock `getDb` and `DB_PATH` from this module, but these are vestigial from a prior refactor.

### Task 5: Verify mocks are unnecessary

**Files to check:**

- `tests/llm-orchestrator.test.ts`
- `tests/memory.test.ts`
- `tests/history.test.ts`
- `tests/persistence-ac.test.ts`
- `tests/memos.test.ts`

**Step 1: Read each file's db/index mock**

Each mocks:

```typescript
void mock.module('../src/db/index.js', () => ({
  getDb: (): import('bun:sqlite').Database => testSqlite,
  DB_PATH: ':memory:',
  initDb: (): void => {},
}))
```

**Step 2: Verify `getDb` is not exported from `src/db/index.ts`**

Run: `grep "export.*getDb\|export.*DB_PATH" src/db/index.ts`
Expected: No matches

**Step 3: Remove the mock.module for db/index.js from each file**

The mock was providing fake exports that don't exist on the real module. Remove the entire `mock.module('../src/db/index.js', ...)` block from each file.

If any file also creates a `testSqlite` variable solely for this mock, check if it's used elsewhere. If not, remove it too.

For `llm-orchestrator.test.ts`, the `testSqlite` variable IS used (passed to `cache.ts` tests). Keep `testSqlite` but create it in `beforeEach` without the mock.module:

```typescript
const { Database } = await import('bun:sqlite')
testSqlite = new Database(':memory:')
```

**Step 4: Run each file**

Run: `bun test tests/llm-orchestrator.test.ts tests/memory.test.ts tests/history.test.ts tests/persistence-ac.test.ts tests/memos.test.ts`
Expected: PASS

If any fail, the `db/index.js` mock WAS needed — investigate which transitive import pulls it in and add `_set*` setters as needed.

**Step 5: Remove db/index from mock-reset.ts**

Remove the `_dbIndex` import and entry from `originals` array.

**Step 6: Commit**

```bash
git add tests/ tests/mock-reset.ts
git commit -m "test: remove vestigial db/index mock.module (exports don't exist)"
```

---

## Phase 3: `ai` + `@ai-sdk/openai-compatible` — deps parameter

5 source files use `generateText`, `embed`, `createOpenAICompatible`, or `stepCountIs` from these packages. Add a `deps` parameter to the functions that call them.

### Task 6: Add deps to `src/llm-orchestrator.ts`

**Files:**

- Modify: `src/llm-orchestrator.ts:1-26,50+`
- Test: `tests/llm-orchestrator.test.ts`

**Step 1: Define the deps interface**

Add near the top of `src/llm-orchestrator.ts`:

```typescript
import type { generateText as generateTextFn, stepCountIs as stepCountIsFn, ToolSet } from 'ai'

export interface LlmOrchestratorDeps {
  generateText: typeof generateTextFn
  stepCountIs: typeof stepCountIsFn
  buildOpenAI: (apiKey: string, baseURL: string) => ReturnType<typeof createOpenAICompatible>
}

const defaultDeps: LlmOrchestratorDeps = {
  generateText,
  stepCountIs,
  buildOpenAI: (apiKey: string, baseURL: string) =>
    createOpenAICompatible({ name: 'openai-compatible', apiKey, baseURL }),
}
```

**Step 2: Add deps parameter to `processMessage`**

The main entry point is `processMessage()`. Add `deps` as the last parameter with a default:

```typescript
export async function processMessage(
  reply: ReplyFn,
  storageContextId: string,
  deps: LlmOrchestratorDeps = defaultDeps,
): Promise<void> {
  // Replace direct calls:
  // generateText(...) -> deps.generateText(...)
  // stepCountIs(...) -> deps.stepCountIs(...)
  // buildOpenAI(...) -> deps.buildOpenAI(...)
}
```

**Step 3: Update test to pass deps directly**

In `tests/llm-orchestrator.test.ts`, replace the `ai` and `@ai-sdk/openai-compatible` mock.module blocks with a `testDeps` object:

```typescript
const testDeps: LlmOrchestratorDeps = {
  generateText: (args) => generateTextImpl(args),
  stepCountIs: () => () => false,
  buildOpenAI: () => ((_model: string) => 'mock-model') as unknown as ReturnType<typeof createOpenAICompatible>,
}

// In test:
await processMessage(reply, contextId, testDeps)
```

Remove the `mock.module('ai', ...)` and `mock.module('@ai-sdk/openai-compatible', ...)` blocks.

**Step 4: Run tests**

Run: `bun test tests/llm-orchestrator.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/llm-orchestrator.ts tests/llm-orchestrator.test.ts
git commit -m "refactor(llm): add deps parameter to processMessage for DI testing"
```

---

### Task 7: Add deps to `src/conversation.ts`

**Files:**

- Modify: `src/conversation.ts`
- Test: `tests/conversation.test.ts`

**Step 1: Define deps interface**

```typescript
export interface ConversationDeps {
  buildModel: (apiKey: string, baseUrl: string, modelName: string) => LanguageModel
}

const defaultConversationDeps: ConversationDeps = {
  buildModel: (apiKey, baseUrl, modelName) =>
    createOpenAICompatible({ name: 'openai-compatible', apiKey, baseURL: baseUrl })(modelName),
}
```

**Step 2: Add deps to functions that use `createOpenAICompatible`**

The function `buildModel` (line 11) is private. It's used by `trimWithMemoryModel` (via `runTrimInBackground`). Add `deps` to `runTrimInBackground`:

```typescript
export function runTrimInBackground(
  userId: string,
  history: readonly ModelMessage[],
  deps: ConversationDeps = defaultConversationDeps,
): void { ... }
```

**Step 3: Update test**

Replace `mock.module('@ai-sdk/openai-compatible', ...)` with deps passed to functions.

**Step 4: Run tests**

Run: `bun test tests/conversation.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/conversation.ts tests/conversation.test.ts
git commit -m "refactor(conversation): add deps parameter for DI testing"
```

---

### Task 8: Add deps to `src/memory.ts`

**Files:**

- Modify: `src/memory.ts`
- Test: `tests/memory.test.ts`

**Step 1: Identify functions using `generateText`**

`memory.ts` uses `generateText` in its trim/summary functions. Add `deps` parameter to those.

```typescript
export interface MemoryDeps {
  generateText: typeof generateTextFn
}

const defaultMemoryDeps: MemoryDeps = { generateText }
```

**Step 2: Add deps to `trimWithMemoryModel` and related functions**

**Step 3: Update test to pass deps**

Replace `mock.module('ai', ...)` with `deps: { generateText: impl }`.

**Step 4: Run tests**

Run: `bun test tests/memory.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/memory.ts tests/memory.test.ts
git commit -m "refactor(memory): add deps parameter for DI testing"
```

---

### Task 9: Add deps to `src/embeddings.ts`

**Files:**

- Modify: `src/embeddings.ts`
- Test: `tests/embeddings.test.ts`

**Step 1: Define deps**

```typescript
export interface EmbeddingsDeps {
  embed: typeof embedFn
  createProvider: typeof createOpenAICompatible
}

const defaultEmbeddingsDeps: EmbeddingsDeps = { embed, createProvider: createOpenAICompatible }
```

**Step 2: Add deps to `getEmbedding` and `tryGetEmbedding`**

**Step 3: Update test**

**Step 4: Run tests**

Run: `bun test tests/embeddings.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/embeddings.ts tests/embeddings.test.ts
git commit -m "refactor(embeddings): add deps parameter for DI testing"
```

---

### Task 10: Add deps to `src/deferred-prompts/proactive-llm.ts`

**Files:**

- Modify: `src/deferred-prompts/proactive-llm.ts`
- Test: `tests/deferred-prompts/execution-modes.test.ts`, `tests/deferred-prompts/poller.test.ts`

Follow same pattern as Tasks 6-9.

**Step 1: Define deps, add to functions**

**Step 2: Update both test files**

**Step 3: Run tests**

Run: `bun test tests/deferred-prompts/execution-modes.test.ts tests/deferred-prompts/poller.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/deferred-prompts/proactive-llm.ts tests/deferred-prompts/
git commit -m "refactor(deferred-prompts): add deps parameter for DI testing"
```

---

### Task 11: Remove ai and openai-compatible from mock-reset.ts

**Files:**

- Modify: `tests/mock-reset.ts`

**Step 1: Remove entries**

Remove `_ai` and `_openaiCompat` imports and their entries from `originals`.

**Step 2: Validate**

Run: `bun test --randomize && bun test --randomize`
Expected: PASS

**Step 3: Commit**

```bash
git add tests/mock-reset.ts
git commit -m "test: remove ai/openai-compatible from mock-reset (DI migration complete)"
```

---

## Phase 4: `src/logger.js` — Skip

79 source files import `logger`. DI would touch nearly every function signature in the codebase. The logger mock is low-risk:

- `LOG_LEVEL=silent` in preload silences the real logger
- Only 4 test files mock it (for assertion purposes)
- The global mock reset handles these 4 files

**Decision:** Keep logger in `tests/mock-reset.ts`. No action needed.

---

## Phase 5: Remaining modules — case-by-case

6 modules with 1-2 test files each. Each gets a task.

### Task 12: `src/recurring.js` — add deps to tool handlers

**Files:**

- Modify: `src/tools/completion-hook.ts` (imports `findTemplateByTaskId` etc.)
- Modify: `src/tools/create-recurring-task.ts` (imports `createRecurringTask`)
- Test: `tests/tools/completion-hook.test.ts`
- Test: `tests/tools/recurring-tools.test.ts`

**Strategy:** The tool `execute` functions receive the recurring module functions via closure. Add a `deps` parameter to the tool factory functions (`makeCreateRecurringTaskTool`, etc.).

Before:

```typescript
import { createRecurringTask } from '../recurring.js'

export function makeCreateRecurringTaskTool() {
  return {
    execute: async (input) => {
      createRecurringTask(input)
    },
  }
}
```

After:

```typescript
import { createRecurringTask as defaultCreate } from '../recurring.js'

interface RecurringDeps {
  createRecurringTask: typeof defaultCreate
}
const defaultDeps: RecurringDeps = { createRecurringTask: defaultCreate }

export function makeCreateRecurringTaskTool(deps: RecurringDeps = defaultDeps) {
  return {
    execute: async (input) => {
      deps.createRecurringTask(input)
    },
  }
}
```

Tests pass fakes:

```typescript
const tool = makeCreateRecurringTaskTool({ createRecurringTask: mockImpl })
```

**Step 1: Update tool factories with deps**
**Step 2: Update tests to pass deps instead of mock.module**
**Step 3: Run tests**

Run: `bun test tests/tools/recurring-tools.test.ts tests/tools/completion-hook.test.ts`
Expected: PASS

**Step 4: Remove recurring/scheduler from mock-reset.ts**
**Step 5: Commit**

```bash
git add src/tools/ tests/tools/ tests/mock-reset.ts
git commit -m "refactor(tools): add deps to recurring tool factories for DI testing"
```

---

### Task 13: `src/providers/kaneo/list-columns.js` — add deps to task operations

**Files:**

- Modify: `src/providers/kaneo/operations/tasks.ts` (imports `listColumns`)
- Test: `tests/providers/kaneo/task-resource.test.ts`
- Test: `tests/providers/kaneo/task-status.test.ts`

**Strategy:** Add `listColumns` as a deps parameter to the task operation functions that use it.

**Step 1-5:** Same pattern as Task 12.

**Step 6: Remove list-columns from mock-reset.ts**
**Step 7: Commit**

```bash
git add src/providers/kaneo/ tests/providers/kaneo/ tests/mock-reset.ts
git commit -m "refactor(kaneo): add deps to task operations for DI testing"
```

---

### Task 14: `src/providers/kaneo/provision.js` — add deps to callers

**Files:**

- Test: `tests/commands/admin.test.ts` (mocks `provisionAndConfigure`)
- Test: `tests/llm-orchestrator.test.ts` (mocks `provisionAndConfigure`, `maybeProvisionKaneo`)

**Strategy:** Already handled by llm-orchestrator deps (Task 6). For admin command, add deps parameter to the admin command handler.

**Step 1-4:** Follow pattern.

**Step 5: Remove provision from mock-reset.ts**
**Step 6: Commit**

---

### Task 15: `src/providers/factory.js` + `src/providers/registry.js` — add deps

**Files:**

- Test: `tests/llm-orchestrator.test.ts` (mocks `buildProviderForUser` from factory)
- Test: `tests/scheduler.test.ts` (mocks `createProvider` from registry)

**Strategy:** Both are already addressed by adding deps to their sole test consumer (llm-orchestrator for factory, scheduler for registry).

**Step 1-4:** Follow pattern.

**Step 5: Remove factory/registry from mock-reset.ts**
**Step 6: Commit**

---

### Task 16: `src/changelog-reader.js` — add deps to announcements

**Files:**

- Modify: `src/announcements.ts` (imports `readChangelogFile`)
- Test: `tests/announcements.test.ts`

**Strategy:** Add `readChangelogFile` as a deps parameter.

**Step 1-4:** Follow pattern.

**Step 5: Remove changelog-reader from mock-reset.ts**
**Step 6: Commit**

---

### Task 17: `src/llm-orchestrator.js` — add deps to bot-auth

**Files:**

- Test: `tests/commands/bot-auth.test.ts` (mocks `processMessage`)

**Strategy:** Add `processMessage` as a deps parameter to the bot auth command handler.

**Step 1-4:** Follow pattern.

**Step 5: Remove llm-orchestrator from mock-reset.ts**
**Step 6: Commit**

---

## Phase 6: Cleanup

### Task 18: Delete mock-reset.ts if empty

**Files:**

- Check: `tests/mock-reset.ts`

**Step 1: Verify originals array is empty**

After all phases, the `originals` array in `tests/mock-reset.ts` should only contain `logger` entries.

If logger is the only remaining entry:

- Keep `mock-reset.ts` with just the logger reset + `mock.restore()` in afterEach
- Document in `tests/CLAUDE.md` that logger is the sole remaining mock.module

If the originals array is completely empty:

- Delete `tests/mock-reset.ts`
- Remove from `bunfig.toml` preload
- Keep the `afterEach(() => { mock.restore() })` in `tests/setup.ts` instead

**Step 2: Update tests/CLAUDE.md**

Remove all mock.module guidance. Replace with DI pattern documentation.

**Step 3: Final validation**

Run: `bun test --randomize && bun test --randomize && bun test --randomize`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add tests/ bunfig.toml
git commit -m "test: complete DI migration, update testing docs"
```

---

### Task 19: Delete prior migration artifacts

**Files to clean up (if they exist):**

- Delete: `src/lib/ai-wrapper.ts` (if created by prior migration)
- Delete: `src/lib/ai-sdk-wrapper.ts` (if created by prior migration)
- Delete: `docs/plans/2026-04-01-migrate-mock-module-to-spyon.md` (superseded)

**Step 1: Check if wrapper files exist**

Run: `ls src/lib/ai-wrapper.ts src/lib/ai-sdk-wrapper.ts 2>/dev/null`

If they exist, delete them and update any imports.

**Step 2: Commit**

```bash
git add -A
git commit -m "chore: remove superseded spyOn migration artifacts"
```
