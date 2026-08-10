<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Layered Architecture Violations Fix — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Verify and fix all layered architecture violations identified in ADR-0008, then produce a comprehensive architecture verification document.

**Architecture:** The project uses a four-layer architecture: Presentation → Orchestration → Application/Domain → Infrastructure. Violations include direct DB access in the application layer (bypassing cache), duplicate LLM orchestration, scattered infrastructure, cross-layer imports, and provider building duplication. Fixes are organized from highest to lowest severity.

**Tech Stack:** TypeScript, Bun, Drizzle ORM, Vercel AI SDK, SQLite, pino logger

---

## Phase 1: Verification Baseline

### Task 1: Run Verification Commands and Capture Baseline

**Files:**

- Read: `src/deferred-prompts/proactive-llm.ts`, `src/llm-orchestrator.ts`, `src/scheduler.ts`
- Read: `src/cache.ts`, `src/cache-db.ts`
- Read: All files listed in ADR-0008 violation tables

**Step 1: Verify duplicate LLM orchestration**

Run:

```bash
cd /Users/ki/Projects/experiments/papai && grep -rn "createOpenAICompatible" src/ --include="*.ts" | grep -v "node_modules"
```

Expected: `src/llm-orchestrator.ts` AND `src/deferred-prompts/proactive-llm.ts` both show hits — confirms violation.

**Step 2: Verify application layer direct DB access**

Run:

```bash
cd /Users/ki/Projects/experiments/papai && grep -rn "from.*db/drizzle" src/*.ts src/*/*.ts src/deferred-prompts/*.ts 2>/dev/null | grep -v "cache"
```

Expected: 10+ files importing `getDrizzleDb` outside `cache.ts`/`cache-db.ts` — confirms violation.

**Step 3: Verify tools importing DB-accessing modules**

Run:

```bash
cd /Users/ki/Projects/experiments/papai && grep -rn "from '../recurring\|from '../scheduler\|from '../instructions" src/tools/*.ts
```

Expected: 9 tool files importing `recurring.js` or `scheduler.js` — confirms violation.

**Step 4: Verify provider building duplication**

Run:

```bash
cd /Users/ki/Projects/experiments/papai && grep -rn "buildProviderForUser\|createProvider" src/scheduler.ts src/providers/factory.ts
```

Expected: Both files contain provider construction logic — confirms duplication.

**Step 5: Verify infrastructure misplacement**

Run:

```bash
cd /Users/ki/Projects/experiments/papai && grep -rn "setInterval\|setTimeout" src/scheduler.ts src/deferred-prompts/poller.ts src/cache.ts
```

Expected: All three files use `setInterval` — infrastructure concerns at root level.

**Step 6: Verify orchestration platform-specific imports**

Run:

```bash
cd /Users/ki/Projects/experiments/papai && grep -rn "KaneoClassifiedError\|YouTrackClassifiedError\|provisionAndConfigure" src/llm-orchestrator.ts
```

Expected: All three imports present — confirms violation.

**Step 7: Verify commands importing AI SDK**

Run:

```bash
cd /Users/ki/Projects/experiments/papai && grep -rn "from 'ai'" src/commands/*.ts
```

Expected: `src/commands/context.ts` imports `ModelMessage` from `ai`.

**Step 8: Document baseline violation count**

Save a summary: 11 HIGH violations (3 categories), 6 MEDIUM, 3 LOW.

**Step 9: Run full test suite to establish green baseline**

Run: `cd /Users/ki/Projects/experiments/papai && bun test`
Expected: All tests pass. Record the count.

**Step 10: Commit baseline verification (no code changes)**

No code changes in this task — verification only.

---

## Phase 2: Fix Application Layer Direct DB Access in `history.ts` and `memory.ts`

These two files (history, memory) are partially migrated — they use `cache.ts` for reads but bypass it for deletes.

### Task 2: Add `deleteHistory` to `cache-db.ts` and Wire Through `cache.ts`

**Files:**

- Modify: `src/cache-db.ts` (add `deleteHistoryFromDb`)
- Modify: `src/cache.ts` (add `deleteCachedHistory`)
- Modify: `src/history.ts:27-35` (replace direct DB delete with cache call)
- Test: `tests/history.test.ts`

**Step 1: Read existing test file**

Run: Read `tests/history.test.ts` to understand test patterns.

**Step 2: Write the failing test**

Add a test in `tests/history.test.ts` that verifies `clearHistory` no longer directly calls `getDrizzleDb()`. Instead, it should call through the cache layer.

```typescript
test('clearHistory delegates delete to cache layer', () => {
  clearHistory('user-1')
  // Verify cache is cleared (history returns empty)
  const history = loadHistory('user-1')
  expect(history).toEqual([])
})
```

**Step 3: Run test to verify current behavior**

Run: `cd /Users/ki/Projects/experiments/papai && bun test tests/history.test.ts`
Expected: Test passes (current code already clears cache + does direct DB delete).

**Step 4: Add `deleteHistoryFromDb` to `cache-db.ts`**

```typescript
export function deleteHistoryFromDb(userId: string): void {
  queueMicrotask(() => {
    try {
      const db = getDrizzleDb()
      db.delete(conversationHistory).where(eq(conversationHistory.userId, userId)).run()
      log.debug({ userId }, 'History deleted from DB')
    } catch (error) {
      log.error(
        { userId, error: error instanceof Error ? error.message : String(error) },
        'Failed to delete history from DB',
      )
    }
  })
}
```

**Step 5: Add `deleteCachedHistory` to `cache.ts`**

```typescript
export function deleteCachedHistory(userId: string): void {
  const cache = getOrCreateCache(userId)
  cache.history = []
  cache.config.delete('history_loaded')
  deleteHistoryFromDb(userId)
}
```

**Step 6: Update `history.ts` to remove direct DB access**

Replace `clearHistory` in `src/history.ts` — remove `getDrizzleDb` import and direct `db.delete()` call. Use `deleteCachedHistory` instead:

```typescript
import { getCachedHistory, setCachedHistory, appendToCachedHistory, deleteCachedHistory } from './cache.js'
```

Remove these imports from `history.ts`:

- `import { getDrizzleDb } from './db/drizzle.js'`
- `import { conversationHistory } from './db/schema.js'`

Replace `clearHistory` body:

```typescript
export function clearHistory(userId: string): void {
  log.debug({ userId }, 'clearHistory called')
  deleteCachedHistory(userId)
  log.info({ userId }, 'History cleared')
}
```

Also remove `import { eq } from 'drizzle-orm'` since it's no longer needed.

**Step 7: Also remove `ModelMessage` import from history.ts**

The `import { type ModelMessage } from 'ai'` should stay because `loadHistory`, `saveHistory`, and `appendHistory` use it in their signatures. Verify by checking the function signatures.

Actually, looking at the code: `loadHistory` returns `readonly ModelMessage[]`, `saveHistory` takes `readonly ModelMessage[]`, `appendHistory` takes `readonly ModelMessage[]`. These types come from the cache layer. We cannot remove the `ai` import from `history.ts` without also changing the cache layer. This is a separate concern — skip for now.

**Step 8: Run tests**

Run: `cd /Users/ki/Projects/experiments/papai && bun test tests/history.test.ts`
Expected: PASS

**Step 9: Run full test suite**

Run: `cd /Users/ki/Projects/experiments/papai && bun test`
Expected: All tests pass.

**Step 10: Commit**

```bash
git add src/cache-db.ts src/cache.ts src/history.ts
git commit -m "refactor: remove direct DB access from history.ts, delegate to cache layer"
```

---

### Task 3: Add `deleteSummary` and `deleteFacts` to Cache Layer, Fix `memory.ts`

**Files:**

- Modify: `src/cache-db.ts` (add `deleteSummaryFromDb`, `deleteFactsFromDb`)
- Modify: `src/cache.ts` (add `deleteCachedSummary`, `deleteCachedFacts` — note: `clearCachedFacts` already exists but only clears in-memory, doesn't delete from DB)
- Modify: `src/memory.ts:26-34, 49-57` (replace direct DB deletes)
- Test: `tests/memory.test.ts`

**Step 1: Read existing test file**

Run: Read `tests/memory.test.ts` to understand test patterns.

**Step 2: Add `deleteSummaryFromDb` and `deleteFactsFromDb` to `cache-db.ts`**

```typescript
export function deleteSummaryFromDb(userId: string): void {
  queueMicrotask(() => {
    try {
      const db = getDrizzleDb()
      db.delete(memorySummary).where(eq(memorySummary.userId, userId)).run()
      log.debug({ userId }, 'Summary deleted from DB')
    } catch (error) {
      log.error(
        { userId, error: error instanceof Error ? error.message : String(error) },
        'Failed to delete summary from DB',
      )
    }
  })
}

export function deleteFactsFromDb(userId: string): void {
  queueMicrotask(() => {
    try {
      const db = getDrizzleDb()
      db.delete(memoryFacts).where(eq(memoryFacts.userId, userId)).run()
      log.debug({ userId }, 'Facts deleted from DB')
    } catch (error) {
      log.error(
        { userId, error: error instanceof Error ? error.message : String(error) },
        'Failed to delete facts from DB',
      )
    }
  })
}
```

**Step 3: Update `cache.ts` — enhance `clearCachedFacts` to also delete from DB, add `deleteCachedSummary`**

Rename existing `clearCachedFacts` to add DB deletion:

```typescript
export function clearCachedFacts(userId: string): void {
  const cache = userCaches.get(userId)
  if (cache === undefined) {
    log.debug({ userId }, 'No facts cache to clear (cache not initialized)')
    return
  }
  cache.facts = []
  cache.config.delete('facts_loaded')
  deleteFactsFromDb(userId)
  log.debug({ userId }, 'Facts cache cleared and DB delete queued')
}
```

Add new `deleteCachedSummary`:

```typescript
export function deleteCachedSummary(userId: string): void {
  const cache = getOrCreateCache(userId)
  cache.summary = null
  cache.config.delete('summary_loaded')
  deleteSummaryFromDb(userId)
}
```

Import the new functions from `cache-db.ts`:

```typescript
import {
  deleteFactsFromDb,
  deleteHistoryFromDb,
  deleteInstructionFromDb,
  deleteSummaryFromDb,
  syncConfigToDb,
  syncFactToDb,
  syncHistoryToDb,
  syncInstructionToDb,
  syncSummaryToDb,
  syncWorkspaceToDb,
} from './cache-db.js'
```

**Step 4: Update `memory.ts` — remove direct DB access**

Replace `clearSummary`:

```typescript
export function clearSummary(userId: string): void {
  log.debug({ userId }, 'clearSummary called')
  deleteCachedSummary(userId)
  log.info({ userId }, 'Summary cleared')
}
```

Replace `clearFacts`:

```typescript
export function clearFacts(userId: string): void {
  log.debug({ userId }, 'clearFacts called')
  clearCachedFacts(userId)
  log.info({ userId }, 'Facts cleared')
}
```

Remove from `memory.ts` imports:

- `import { eq } from 'drizzle-orm'`
- `import { getDrizzleDb } from './db/drizzle.js'`
- `import { memorySummary, memoryFacts } from './db/schema.js'`

Update cache import:

```typescript
import {
  getCachedFacts,
  getCachedSummary,
  setCachedSummary,
  clearCachedFacts,
  upsertCachedFact,
  deleteCachedSummary,
} from './cache.js'
```

**Step 5: Run tests**

Run: `cd /Users/ki/Projects/experiments/papai && bun test tests/memory.test.ts`
Expected: PASS

**Step 6: Run full test suite**

Run: `cd /Users/ki/Projects/experiments/papai && bun test`
Expected: All tests pass.

**Step 7: Run lint and typecheck**

Run: `cd /Users/ki/Projects/experiments/papai && bun lint && bun typecheck`
Expected: PASS

**Step 8: Commit**

```bash
git add src/cache-db.ts src/cache.ts src/memory.ts
git commit -m "refactor: remove direct DB access from memory.ts, delegate to cache layer"
```

---

## Phase 3: Fix Scheduler Provider Building Duplication

### Task 4: Remove Duplicate `buildProviderForUser` from `scheduler.ts`

**Files:**

- Modify: `src/scheduler.ts:33-76` (remove local `buildProviderForUser`, import from factory)
- Test: `tests/scheduler.test.ts` (if exists)

**Step 1: Read scheduler tests**

Run: Check if `tests/scheduler.test.ts` exists. If not, note that no test changes are needed.

**Step 2: Replace local `buildProviderForUser` with factory import**

In `src/scheduler.ts`, replace:

```typescript
import type { ChatProvider } from './chat/types.js'
import { getConfig } from './config.js'
import { logger } from './logger.js'
import { createProvider } from './providers/registry.js'
import type { TaskProvider } from './providers/types.js'
import type { Task } from './providers/types.js'
import { recordOccurrence } from './recurring-occurrences.js'
import { type RecurringTaskRecord, getDueRecurringTasks, getRecurringTask, markExecuted } from './recurring.js'
import { getKaneoWorkspace } from './users.js'
```

With:

```typescript
import type { ChatProvider } from './chat/types.js'
import { logger } from './logger.js'
import { buildProviderForUser } from './providers/factory.js'
import type { TaskProvider } from './providers/types.js'
import type { Task } from './providers/types.js'
import { recordOccurrence } from './recurring-occurrences.js'
import { type RecurringTaskRecord, getDueRecurringTasks, getRecurringTask, markExecuted } from './recurring.js'
```

Remove these now-unused imports:

- `import { getConfig } from './config.js'`
- `import { createProvider } from './providers/registry.js'`
- `import { getKaneoWorkspace } from './users.js'`

Delete the entire local `buildProviderForUser` function (lines 33-76).

Replace all calls to `buildProviderForUser(userId)` with `buildProviderForUser(userId, false)` (non-strict — returns null on missing config).

Also remove `const TASK_PROVIDER = process.env['TASK_PROVIDER'] ?? 'kaneo'` since it's no longer needed.

**Step 3: Run typecheck**

Run: `cd /Users/ki/Projects/experiments/papai && bun typecheck`
Expected: PASS

**Step 4: Run tests**

Run: `cd /Users/ki/Projects/experiments/papai && bun test`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add src/scheduler.ts
git commit -m "refactor: remove duplicate buildProviderForUser from scheduler, use factory"
```

---

## Phase 4: Fix `resume-recurring-task.ts` Cross-Layer Dependency

### Task 5: Remove `scheduler.ts` Import from `resume-recurring-task.ts`

The tool `resume-recurring-task.ts` imports `createMissedTasks` from `scheduler.ts`. The scheduler imports `ChatProvider` from the presentation layer, creating a transitive violation: **Tools → Infrastructure → Presentation**.

**Files:**

- Modify: `src/tools/resume-recurring-task.ts:8` (remove scheduler import)
- Modify: `src/scheduler.ts` (export `createMissedTasks` signature stays, but the tool shouldn't use it)
- Create: `src/recurring-missed.ts` — extract `createMissedTasks` from scheduler to application layer

**Step 1: Read the `createMissedTasks` function in scheduler**

The function at `src/scheduler.ts:143-186` creates task instances for missed recurring task occurrences. It depends on:

- `getRecurringTask` (from `recurring.ts`)
- `buildProviderForUser` (after Task 4 fix, from `providers/factory.ts`)
- `provider.createTask` (provider interface)
- `applyLabels` (local helper in scheduler)
- `recordOccurrence` (from `recurring-occurrences.ts`)

**Step 2: Extract `createMissedTasks` into `src/recurring-missed.ts`**

Create `src/recurring-missed.ts`:

```typescript
import { logger } from './logger.js'
import { buildProviderForUser } from './providers/factory.js'
import type { TaskProvider } from './providers/types.js'
import { recordOccurrence } from './recurring-occurrences.js'
import { getRecurringTask } from './recurring.js'

const log = logger.child({ scope: 'recurring-missed' })

const applyLabels = async (provider: TaskProvider, taskId: string, labels: readonly string[]): Promise<void> => {
  if (labels.length === 0) return
  if (!provider.capabilities.has('labels.assign') || provider.addTaskLabel === undefined) return

  const results = await Promise.allSettled(labels.map((labelId) => provider.addTaskLabel!(taskId, labelId)))

  for (let i = 0; i < results.length; i++) {
    const result = results[i]!
    if (result.status === 'fulfilled') {
      log.debug({ taskId, labelId: labels[i] }, 'Label applied to missed task instance')
    } else {
      log.warn({ taskId, labelId: labels[i], error: result.reason }, 'Failed to apply label to missed task')
    }
  }
}

/** Create tasks for missed occurrences (called from resume tool). */
export const createMissedTasks = async (recurringTaskId: string, missedDates: readonly string[]): Promise<number> => {
  if (missedDates.length === 0) return 0

  const task = getRecurringTask(recurringTaskId)
  if (task === null) return 0

  const provider = buildProviderForUser(task.userId, false)
  if (provider === null) {
    log.error({ recurringTaskId, userId: task.userId }, 'Cannot build provider for missed tasks')
    return 0
  }

  const createOne = async (dueDate: string): Promise<boolean> => {
    try {
      const newTask = await provider.createTask({
        projectId: task.projectId,
        title: task.title,
        description: task.description ?? undefined,
        priority: task.priority ?? undefined,
        status: task.status ?? undefined,
        assignee: task.assignee ?? undefined,
        dueDate,
      })
      await applyLabels(provider, newTask.id, task.labels)
      recordOccurrence(recurringTaskId, newTask.id)
      log.debug({ recurringTaskId, createdTaskId: newTask.id, dueDate }, 'Missed task created')
      return true
    } catch (error) {
      log.warn(
        { recurringTaskId, dueDate, error: error instanceof Error ? error.message : String(error) },
        'Failed to create missed task',
      )
      return false
    }
  }

  const results = await missedDates.reduce<Promise<number>>(
    (chain, dueDate) => chain.then(async (count) => ((await createOne(dueDate)) ? count + 1 : count)),
    Promise.resolve(0),
  )

  log.info({ recurringTaskId, missedCount: missedDates.length, created: results }, 'Missed tasks creation complete')
  return results
}
```

**Step 3: Update `scheduler.ts` to import from `recurring-missed.ts`**

In `scheduler.ts`, remove the local `createMissedTasks` function and `applyLabels` helper. Re-export `createMissedTasks` from `recurring-missed.ts` if other callers exist, OR just import it where needed.

Check callers of `createMissedTasks`:

```bash
grep -rn "createMissedTasks" src/ --include="*.ts"
```

If only `resume-recurring-task.ts` and `scheduler.ts` use it, update the tool to import from `recurring-missed.ts` instead.

In `scheduler.ts`, keep the `applyLabels` for its own use (it's used in `executeRecurringTask`), or share it. Simplest: keep a copy in scheduler for `executeRecurringTask` and the extracted version in `recurring-missed.ts`.

**Step 4: Update `resume-recurring-task.ts`**

```typescript
import { createMissedTasks } from '../recurring-missed.js'
```

Remove:

```typescript
import { createMissedTasks } from '../scheduler.js'
```

**Step 5: Run typecheck and tests**

Run: `cd /Users/ki/Projects/experiments/papai && bun typecheck && bun test`
Expected: PASS

**Step 6: Run lint**

Run: `cd /Users/ki/Projects/experiments/papai && bun lint`
Expected: PASS

**Step 7: Commit**

```bash
git add src/recurring-missed.ts src/scheduler.ts src/tools/resume-recurring-task.ts
git commit -m "refactor: extract createMissedTasks from scheduler to break cross-layer dependency"
```

---

## Phase 5: Consolidate LLM Orchestration

### Task 6: Extend `llm-orchestrator.ts` with Execution Mode Support for Proactive LLM

**Files:**

- Modify: `src/llm-orchestrator.ts` (add `dispatchProactiveExecution`)
- Modify: `src/deferred-prompts/proactive-llm.ts` (delegate to orchestrator)
- Test: `tests/llm-orchestrator-proactive.test.ts` (or modify existing)

**Step 1: Analyze the three execution modes**

The `proactive-llm.ts` file has three modes: `lightweight`, `context`, `full`. The key differences from `callLlm` in the orchestrator:

- `lightweight`: Uses `small_model`, minimal system prompt, no tools, no fact persistence
- `context`: Uses `main_model`, minimal system prompt, conversation history, no tools, no fact persistence
- `full`: Uses `main_model`, full system prompt, tools, conversation history, fact persistence

The shared concerns:

- Model building (both call `createOpenAICompatible`)
- Config validation (both check `llm_apikey`, `llm_baseurl`, `main_model`)
- History management (both append to history and trigger trim)

**Step 2: Add `buildModel` helper to `llm-orchestrator.ts`**

Extract model building into a reusable function:

```typescript
export const buildModel = (userId: string, modelOverride?: string): LanguageModelV1 | string => {
  const apiKey = getConfig(userId, 'llm_apikey')
  const baseURL = getConfig(userId, 'llm_baseurl')
  const mainModel = getConfig(userId, 'main_model')
  if (apiKey === null || baseURL === null || mainModel === null) {
    return 'Missing LLM configuration. Use /set to configure llm_apikey, llm_baseurl, and main_model.'
  }
  const modelId = modelOverride ?? mainModel
  return buildOpenAI(apiKey, baseURL)(modelId)
}
```

**Step 3: Update `proactive-llm.ts` to use `buildModel` from orchestrator**

Replace the local `getLlmConfig` + `createOpenAICompatible` calls with:

```typescript
import { buildModel } from '../llm-orchestrator.js'
```

Replace each `createOpenAICompatible` call in `invokeLightweight`, `invokeWithContext`, `invokeFull` with `buildModel`.

**Step 4: Remove `createOpenAICompatible` import from `proactive-llm.ts`**

After replacing all three usages, remove:

```typescript
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
```

And remove the local `getLlmConfig` function.

**Step 5: Run typecheck**

Run: `cd /Users/ki/Projects/experiments/papai && bun typecheck`
Expected: PASS

**Step 6: Run tests**

Run: `cd /Users/ki/Projects/experiments/papai && bun test`
Expected: All tests pass.

**Step 7: Commit**

```bash
git add src/llm-orchestrator.ts src/deferred-prompts/proactive-llm.ts
git commit -m "refactor: consolidate LLM model building into orchestrator, remove AI SDK import from proactive-llm"
```

---

### Task 7: Consolidate Fact Persistence

**Files:**

- Modify: `src/deferred-prompts/proactive-llm.ts:38-51` (remove `persistProactiveResults`, use orchestrator's)
- Modify: `src/llm-orchestrator.ts` (export `persistFactsFromResults`)

**Step 1: Export `persistFactsFromResults` from orchestrator**

Change `const persistFactsFromResults` to `export const persistFactsFromResults` in `llm-orchestrator.ts`.

**Step 2: Update `proactive-llm.ts`**

Replace the local `persistProactiveResults` function with the orchestrator's `persistFactsFromResults`:

```typescript
import { buildModel, persistFactsFromResults } from '../llm-orchestrator.js'
```

In `invokeFull`, replace:

```typescript
persistProactiveResults(userId, result, history)
```

With:

```typescript
persistFactsFromResults(userId, result.toolCalls, result.toolResults)
const msgs = result.response.messages
if (msgs.length > 0) {
  appendHistory(userId, msgs)
  const updated = [...history, ...msgs]
  if (shouldTriggerTrim(updated)) void runTrimInBackground(userId, updated)
}
```

Note: The history management part of `persistProactiveResults` stays inline since it's specific to the proactive flow.

Delete the `persistProactiveResults` function from `proactive-llm.ts`.

**Step 3: Run typecheck and tests**

Run: `cd /Users/ki/Projects/experiments/papai && bun typecheck && bun test`
Expected: PASS

**Step 4: Commit**

```bash
git add src/llm-orchestrator.ts src/deferred-prompts/proactive-llm.ts
git commit -m "refactor: consolidate fact persistence, remove duplicate from proactive-llm"
```

---

## Phase 6: Fix Orchestrator Platform-Specific Dependencies

### Task 8: Abstract Error Classification in Orchestrator

**Files:**

- Modify: `src/llm-orchestrator.ts:13-18, 130-143` (replace specific error imports with generic handling)
- Modify: `src/providers/errors.ts` (ensure `ProviderClassifiedError` covers all cases)

**Step 1: Read providers/errors.ts**

Run: Read `src/providers/errors.ts` to see the base error class.

**Step 2: Read classify-error files**

Run: Read `src/providers/kaneo/classify-error.ts` and `src/providers/youtrack/classify-error.ts` to understand inheritance.

**Step 3: Verify `KaneoClassifiedError` and `YouTrackClassifiedError` extend `ProviderClassifiedError`**

If they do, then the orchestrator can use `instanceof ProviderClassifiedError` instead of checking each specific class.

**Step 4: Update `handleMessageError` in `llm-orchestrator.ts`**

Replace:

```typescript
else if (error instanceof KaneoClassifiedError || error instanceof YouTrackClassifiedError)
    await reply.text(getUserMessage(error.appError))
  else if (error instanceof ProviderClassifiedError) await reply.text(getUserMessage(error.error))
```

With (if both extend `ProviderClassifiedError`):

```typescript
else if (error instanceof ProviderClassifiedError)
    await reply.text(getUserMessage(error.appError ?? error.error))
```

Adjust the property access based on the actual error class structure.

**Step 5: Remove provider-specific imports**

Remove from `llm-orchestrator.ts`:

```typescript
import { KaneoClassifiedError } from './providers/kaneo/classify-error.js'
import { YouTrackClassifiedError } from './providers/youtrack/classify-error.js'
```

**Step 6: Run typecheck and tests**

Run: `cd /Users/ki/Projects/experiments/papai && bun typecheck && bun test`
Expected: PASS

**Step 7: Commit**

```bash
git add src/llm-orchestrator.ts
git commit -m "refactor: use generic ProviderClassifiedError instead of provider-specific error classes"
```

---

## Phase 7: Fix Commands Importing AI SDK

### Task 9: Remove `ModelMessage` Import from `commands/context.ts`

**Files:**

- Modify: `src/commands/context.ts:1` (replace `ModelMessage` with local type or re-export from domain)

**Step 1: Read `commands/context.ts`**

Run: Read the file to understand how `ModelMessage` is used.

**Step 2: Replace AI SDK type import**

Option A: If `ModelMessage` is only used for type annotation, define a local type alias or import from a shared domain types file.

Option B: Import the type from a central types file that re-exports it.

The simplest approach: since `ModelMessage` from `ai` is `{ role: string; content: string | ... }`, create a minimal type in `src/types/` or use the type from `history.ts` which already exposes the data.

Check what `context.ts` actually needs from `ModelMessage`. If it just formats messages, it can accept `readonly { role: string; content: unknown }[]` instead.

**Step 3: Apply the change**

Replace:

```typescript
import type { ModelMessage } from 'ai'
```

With a local type that matches what the code actually uses:

```typescript
type ConversationMessage = { role: string; content: unknown }
```

Update function signatures accordingly.

**Step 4: Run typecheck and tests**

Run: `cd /Users/ki/Projects/experiments/papai && bun typecheck && bun test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/commands/context.ts
git commit -m "refactor: remove AI SDK import from commands layer"
```

---

## Phase 8: Move Deferred Prompt Tools to `src/tools/`

### Task 10: Move Tool Definitions from `deferred-prompts/tools.ts` to `src/tools/deferred/`

**Files:**

- Read: `src/deferred-prompts/tools.ts`
- Create: `src/tools/deferred/` directory
- Create: `src/tools/deferred/index.ts` (move tool definitions)
- Modify: `src/tools/index.ts` (import from new location)
- Modify: Any files that import from `deferred-prompts/tools.ts`

**Step 1: Read `deferred-prompts/tools.ts`**

Understand the 5 tool definitions and their imports.

**Step 2: Find all importers of `deferred-prompts/tools.ts`**

Run:

```bash
grep -rn "deferred-prompts/tools" src/ --include="*.ts"
```

**Step 3: Create `src/tools/deferred/` directory**

**Step 4: Move tool definitions**

Create `src/tools/deferred/index.ts` with the tool definitions, updating import paths (e.g., `../deferred-prompts/` → `../../deferred-prompts/`).

**Step 5: Update importers**

Update all files that imported from `deferred-prompts/tools.ts` to import from `tools/deferred/index.ts`.

**Step 6: Delete `src/deferred-prompts/tools.ts`**

After all imports are updated, remove the old file.

**Step 7: Run typecheck and tests**

Run: `cd /Users/ki/Projects/experiments/papai && bun typecheck && bun test`
Expected: PASS

**Step 8: Run knip to verify no dead exports**

Run: `cd /Users/ki/Projects/experiments/papai && bun knip`
Expected: No new issues.

**Step 9: Commit**

```bash
git add src/tools/deferred/ src/deferred-prompts/ src/tools/index.ts
git commit -m "refactor: move deferred prompt tools to src/tools/deferred/"
```

---

## Phase 9: Run Full Verification Suite

### Task 11: Run All Verification Commands and Confirm Fixes

**Files:**

- Read: All modified files to verify changes

**Step 1: Re-run all Phase 1 verification commands**

Run each verification command from Task 1 and confirm the violations are resolved.

**Step 2: Verify `createOpenAICompatible` is only in `llm-orchestrator.ts`**

Run:

```bash
grep -rn "createOpenAICompatible" src/ --include="*.ts"
```

Expected: Only `src/llm-orchestrator.ts` (no longer in `proactive-llm.ts`).

**Step 3: Verify no direct DB access outside cache/infrastructure**

Run:

```bash
grep -rn "from.*db/drizzle" src/history.ts src/memory.ts
```

Expected: No results.

**Step 4: Verify tools don't import `scheduler.ts`**

Run:

```bash
grep -rn "from '../scheduler" src/tools/*.ts
```

Expected: No results.

**Step 5: Verify no provider-specific imports in orchestrator**

Run:

```bash
grep -rn "KaneoClassifiedError\|YouTrackClassifiedError" src/llm-orchestrator.ts
```

Expected: No results.

**Step 6: Verify commands don't import AI SDK**

Run:

```bash
grep -rn "from 'ai'" src/commands/*.ts
```

Expected: No results.

**Step 7: Run full quality checks**

Run: `cd /Users/ki/Projects/experiments/papai && bun check:verbose`
Expected: All checks pass.

**Step 8: Commit verification results**

No code changes — just verification.

---

## Phase 10: Write Architecture Verification Document

### Task 12: Write Comprehensive Architecture Document

**Files:**

- Create: `docs/adr/0035-layered-architecture-verification-guidelines.md`
- Modify: `docs/adr/0008-layered-architecture-current-state-and-violations.md` (update status to "Fixed" for resolved violations)

**Step 1: Write the architecture verification document**

Create `docs/adr/0035-layered-architecture-verification-guidelines.md` with the following structure:

```markdown
# ADR-0035: Layered Architecture — Key Points and Verification Guidelines

## Status

Accepted

## Date

2026-03-26

## Context

Following the resolution of violations identified in ADR-0008, this document establishes the definitive architecture reference and automated verification guidelines for the papai project.

## Architecture Overview

### Four-Layer Architecture
```

┌─────────────────────────────────────────────────────────┐
│ PRESENTATION LAYER │
│ src/chat/ (Telegram, Mattermost adapters) │
│ src/commands/ (command handlers) │
│ src/bot.ts (platform-agnostic wiring) │
├─────────────────────────────────────────────────────────┤
│ ORCHESTRATION LAYER │
│ src/llm-orchestrator.ts (single LLM entry point) │
├─────────────────────────────────────────────────────────┤
│ APPLICATION / DOMAIN LAYER │
│ src/memory.ts, src/conversation.ts, src/config.ts │
│ src/history.ts, src/users.ts, src/groups.ts │
│ src/recurring.ts, src/recurring-occurrences.ts │
│ src/recurring-missed.ts │
│ src/deferred-prompts/ (business logic only) │
│ src/instructions.ts, src/announcements.ts │
├─────────────────────────────────────────────────────────┤
│ INFRASTRUCTURE LAYER │
│ src/providers/ (task provider adapters) │
│ src/cache.ts, src/cache-db.ts │
│ src/db/ (Drizzle ORM, migrations, schema) │
│ src/scheduler.ts (interval management) │
│ src/deferred-prompts/poller.ts │
│ src/logger.ts │
└─────────────────────────────────────────────────────────┘

````

### Layer Dependency Rules

| Layer | May Import From | Must NOT Import From |
|-------|----------------|---------------------|
| **Presentation** | Orchestration (entry points), Application (types, services), own types | Infrastructure directly, AI SDK, `db/drizzle`, provider implementations |
| **Orchestration** | Application layer, Infrastructure interfaces (`providers/types.ts`, `providers/factory.ts`) | Platform-specific code (`chat/telegram/`, `chat/mattermost/`), provider-specific implementations (`providers/kaneo/classify-error.ts`) |
| **Application** | Cache layer (`cache.ts`), pure types, utilities, other application modules | `db/drizzle.ts`, `drizzle-orm`, `@ai-sdk/openai-compatible`, `setInterval`/`setTimeout` |
| **Infrastructure** | Everything (implements interfaces) | — |

### Key Architectural Rules

#### Rule 1: Single LLM Orchestration Entry Point
All LLM model building MUST go through `llm-orchestrator.ts`. No other file may import `@ai-sdk/openai-compatible` or call `createOpenAICompatible`.

#### Rule 2: Centralized Provider Construction
Only `providers/factory.ts` may construct task providers. Other modules receive providers as parameters or call `buildProviderForUser`.

#### Rule 3: Application Layer Uses Cache Abstraction
Application layer files MUST use `cache.ts` for all data access. Direct `getDrizzleDb` calls are only allowed in `cache.ts`, `cache-db.ts`, and `db/` modules.

#### Rule 4: Tool Definitions Co-located in `src/tools/`
All tool definitions (`tool()` calls) live in `src/tools/` or `src/tools/<feature>/`. Feature folders (`deferred-prompts/`) contain only business logic, types, and handlers — never tool definitions.

#### Rule 5: Tools Depend Only on Interfaces
Tools may import: `ai` (tool types), `providers/types.ts`, application services, `zod`. Tools must NOT transitively depend on presentation layer modules.

#### Rule 6: Commands Are Presentation-Only
Commands in `src/commands/` must not import from `ai` package, `db/drizzle`, or provider implementations. They receive data through function parameters.

#### Rule 7: Orchestrator Is Provider-Agnostic
`llm-orchestrator.ts` must not import provider-specific error classes. Use `ProviderClassifiedError` base class from `providers/errors.ts`.

## Verification Commands

### Quick Check (run before every PR)

```bash
# All checks in one script — any non-empty output indicates a violation
bun run check:architecture
````

### Individual Verification Commands

#### 1. LLM Orchestration — Single Entry Point

```bash
# @ai-sdk/openai-compatible should ONLY appear in llm-orchestrator.ts
grep -rn "@ai-sdk/openai-compatible" src/ --include="*.ts"
# Expected: ONLY src/llm-orchestrator.ts

# createOpenAICompatible should ONLY be called in llm-orchestrator.ts
grep -rn "createOpenAICompatible" src/ --include="*.ts"
# Expected: ONLY src/llm-orchestrator.ts
```

#### 2. Application Layer — No Direct DB Access

```bash
# getDrizzleDb should NOT appear in application layer files
grep -rn "from.*db/drizzle" \
  src/announcements.ts src/groups.ts src/history.ts src/memory.ts \
  src/users.ts src/recurring.ts src/recurring-occurrences.ts \
  src/recurring-missed.ts src/instructions.ts \
  src/deferred-prompts/alerts.ts src/deferred-prompts/scheduled.ts \
  src/deferred-prompts/snapshots.ts 2>/dev/null
# Expected: NO output

# drizzle-orm should NOT be imported in application layer
grep -rn "from 'drizzle-orm'" \
  src/announcements.ts src/groups.ts src/history.ts src/memory.ts \
  src/users.ts src/recurring.ts src/recurring-occurrences.ts \
  src/recurring-missed.ts src/instructions.ts 2>/dev/null
# Expected: NO output
```

#### 3. Tools — No Infrastructure Dependencies

```bash
# Tools should NOT import scheduler (which has presentation layer deps)
grep -rn "from '../scheduler" src/tools/*.ts
# Expected: NO output

# Verify tools don't import DB layer
grep -rn "from.*db/drizzle" src/tools/*.ts src/tools/**/*.ts 2>/dev/null
# Expected: NO output
```

#### 4. Provider Construction — Centralized

```bash
# buildProviderForUser should only be defined in factory.ts
grep -rn "const buildProviderForUser\|function buildProviderForUser" src/ --include="*.ts" | grep -v "factory.ts"
# Expected: NO output
```

#### 5. Orchestrator — No Provider-Specific Imports

```bash
# No provider-specific error classes in orchestrator
grep -rn "KaneoClassifiedError\|YouTrackClassifiedError" src/llm-orchestrator.ts
# Expected: NO output

# No provider-specific imports (only factory and types allowed)
grep -rn "from.*providers/kaneo/\|from.*providers/youtrack/" src/llm-orchestrator.ts | grep -v "provision"
# Expected: Only provisionAndConfigure import (acceptable until further refactoring)
```

#### 6. Commands — No AI SDK Types

```bash
# Commands should not import from 'ai' package
grep -rn "from 'ai'" src/commands/*.ts
# Expected: NO output
```

#### 7. Tool Definitions — All in src/tools/

```bash
# No tool() definitions outside src/tools/
grep -rn "tool({" src/deferred-prompts/*.ts src/*.ts 2>/dev/null | grep -v "src/tools/"
# Expected: NO output
```

#### 8. Infrastructure Isolation

```bash
# setInterval should only be in infrastructure files and entry point
grep -rln "setInterval" src/ --include="*.ts" | grep -v "scheduler\|poller\|cache\|index\|chat/"
# Expected: NO output
```

### Automated CI Check

Add to `package.json` scripts:

```json
{
  "check:architecture": "bash scripts/check-architecture.sh"
}
```

Create `scripts/check-architecture.sh` that runs all verification commands and exits non-zero on any violation.

## Remaining Known Violations (Accepted / Deferred)

These violations are tracked but accepted as low-priority technical debt:

| #   | Violation                                                       | Severity | Reason for Deferral                                 |
| --- | --------------------------------------------------------------- | -------- | --------------------------------------------------- |
| 1   | `src/announcements.ts` direct DB access                         | MEDIUM   | Low-change-rate module, isolated scope              |
| 2   | `src/groups.ts` direct DB access                                | MEDIUM   | Small module, no caching benefit                    |
| 3   | `src/users.ts` direct DB access                                 | MEDIUM   | Auth checks are read-through, workspace uses cache  |
| 4   | `src/recurring.ts` direct DB access                             | MEDIUM   | Complex domain logic, needs dedicated service layer |
| 5   | `src/recurring-occurrences.ts` direct DB access                 | MEDIUM   | Tightly coupled with recurring.ts                   |
| 6   | `src/deferred-prompts/alerts.ts` direct DB access               | MEDIUM   | No caching needed (read-through from DB)            |
| 7   | `src/deferred-prompts/scheduled.ts` direct DB access            | MEDIUM   | No caching needed                                   |
| 8   | `src/deferred-prompts/snapshots.ts` direct DB access            | MEDIUM   | No caching needed                                   |
| 9   | `src/providers/kaneo/provision.ts` imports application layer    | LOW      | Bridge module, necessary coupling                   |
| 10  | `src/providers/factory.ts` imports config/users                 | LOW      | Factory pattern, necessary coupling                 |
| 11  | Business logic in `commands/context.ts`, `group.ts`, `admin.ts` | LOW      | Small scope, low risk                               |
| 12  | `src/llm-orchestrator.ts` imports `provisionAndConfigure`       | LOW      | Kaneo-specific provision flow                       |

## Consequences

### Positive

- Clear, verifiable architecture boundaries
- Automated checks prevent regression
- New contributors can verify compliance with simple commands
- Reduced code duplication in LLM orchestration and provider building

### Negative

- Remaining deferred violations create inconsistency
- Cache layer is larger than ideal
- Some indirection added for boundary compliance

## Related Documents

- ADR-0007: Layered Architecture Enforcement
- ADR-0008: Layered Architecture Current State and Violations
- `scripts/check-architecture.sh` — automated verification script

````

**Step 2: Create `scripts/check-architecture.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

VIOLATIONS=0

check() {
  local label="$1"
  shift
  local result
  result=$("$@" 2>/dev/null || true)
  if [ -n "$result" ]; then
    echo "❌ VIOLATION: $label"
    echo "$result"
    echo ""
    VIOLATIONS=$((VIOLATIONS + 1))
  else
    echo "✅ $label"
  fi
}

echo "=== Architecture Verification ==="
echo ""

check "AI SDK only in orchestrator" \
  grep -rn "@ai-sdk/openai-compatible" src/ --include="*.ts" --exclude="*llm-orchestrator*"

check "No direct DB in history.ts" \
  grep -rn "from.*db/drizzle" src/history.ts

check "No direct DB in memory.ts" \
  grep -rn "from.*db/drizzle" src/memory.ts

check "Tools don't import scheduler" \
  grep -rn "from '../scheduler" src/tools/*.ts

check "No provider-specific errors in orchestrator" \
  grep -rn "KaneoClassifiedError\|YouTrackClassifiedError" src/llm-orchestrator.ts

check "Commands don't import AI SDK" \
  grep -rn "from 'ai'" src/commands/*.ts

check "No duplicate buildProviderForUser" \
  bash -c "grep -rn 'const buildProviderForUser\|function buildProviderForUser' src/ --include='*.ts' | grep -v factory.ts"

echo ""
if [ "$VIOLATIONS" -gt 0 ]; then
  echo "❌ $VIOLATIONS violation(s) found"
  exit 1
else
  echo "✅ All architecture checks passed"
fi
````

**Step 3: Add `check:architecture` script to `package.json`**

Add to the `scripts` section of `package.json`:

```json
"check:architecture": "bash scripts/check-architecture.sh"
```

**Step 4: Run the verification script**

Run: `cd /Users/ki/Projects/experiments/papai && bash scripts/check-architecture.sh`
Expected: All checks pass.

**Step 5: Update ADR-0008 status**

Change the status of `docs/adr/0008-layered-architecture-current-state-and-violations.md` from "Draft / Needs Decision" to "Partially Resolved — See ADR-0035".

**Step 6: Run full quality checks**

Run: `cd /Users/ki/Projects/experiments/papai && bun check:verbose`
Expected: All checks pass.

**Step 7: Commit**

```bash
git add docs/adr/0035-layered-architecture-verification-guidelines.md \
  docs/adr/0008-layered-architecture-current-state-and-violations.md \
  scripts/check-architecture.sh \
  package.json
git commit -m "docs: add architecture verification guidelines (ADR-0035) and automated check script"
```

---

## Summary of Violations Fixed

| Phase | Violation                                                  | Severity | Files Changed                                                           |
| ----- | ---------------------------------------------------------- | -------- | ----------------------------------------------------------------------- |
| 2     | `history.ts` direct DB delete                              | HIGH     | cache-db.ts, cache.ts, history.ts                                       |
| 3     | `memory.ts` direct DB delete (summary + facts)             | HIGH     | cache-db.ts, cache.ts, memory.ts                                        |
| 4     | Duplicate `buildProviderForUser` in scheduler              | MEDIUM   | scheduler.ts                                                            |
| 5     | `resume-recurring-task.ts` → `scheduler.ts` → ChatProvider | HIGH     | recurring-missed.ts (new), scheduler.ts, tools/resume-recurring-task.ts |
| 6     | Duplicate LLM orchestration (model building)               | HIGH     | llm-orchestrator.ts, deferred-prompts/proactive-llm.ts                  |
| 7     | Duplicate fact persistence                                 | HIGH     | llm-orchestrator.ts, deferred-prompts/proactive-llm.ts                  |
| 8     | Orchestrator imports provider-specific errors              | MEDIUM   | llm-orchestrator.ts                                                     |
| 9     | Commands import AI SDK                                     | MEDIUM   | commands/context.ts                                                     |
| 10    | Tool definitions outside `src/tools/`                      | MEDIUM   | tools/deferred/ (new), deferred-prompts/tools.ts (deleted)              |

## Violations Deferred (Documented in ADR-0035)

| Violation                                                                                                                              | Reason                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8 app-layer files with direct DB access (announcements, groups, users, recurring, recurring-occurrences, alerts, scheduled, snapshots) | These modules access DB for data that doesn't benefit from caching (write-heavy, no read-through pattern). Proper fix requires a dedicated service/repository layer — tracked as future work. |
| Provider layer cross-deps (provision.ts, factory.ts)                                                                                   | Bridge modules that necessarily cross boundaries. Factory pattern requires config access.                                                                                                     |
| Business logic in commands                                                                                                             | Small scope, low risk. Extract when commands grow.                                                                                                                                            |
| `provisionAndConfigure` import in orchestrator                                                                                         | Kaneo-specific auto-provision flow. Acceptable until multi-provider provisioning is needed.                                                                                                   |
