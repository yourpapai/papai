<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Storage Context Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make durable group-level entities shared across `group` and `group:thread` storage contexts while keeping conversation-local state, attachments, message metadata, memory summaries, and memory facts thread-isolated.

**Architecture:** Reuse the existing `getConfigContextIdFromStorageContextId()` parent-context resolver as the canonical owner key for durable group-level state. Keep current thread-scoped `storageContextId` for LLM history, memory summary/facts, attachments, staged files, message metadata, and usage telemetry. Add one migration to promote already-stored thread-owned durable rows to their parent group context without changing deferred prompt delivery targets.

**Tech Stack:** Bun, TypeScript, Drizzle SQLite schema, Bun test runner, existing papai storage context helpers.

---

## File Structure

- Modify `src/tools/tools-builder.ts`: route memos, recurring tasks, instructions, deferred prompt ownership, and web-fetch quota actor to the parent group context when current storage is a thread.
- Modify `src/tools/index.ts`: evaluate tool preferences, MCP endpoints, and plugin tools against the parent group context while preserving the current thread context for built-in thread-local tools.
- Modify `src/system-prompt.ts`: load custom instructions, tool preferences, and plugin prompt fragments from the parent group context for thread turns.
- Modify `src/llm-orchestrator.ts`: read AI output visibility/progress settings from the parent group config context for thread turns.
- Modify `src/plugins/tool-runtime.ts` only if plugin runtime currently receives a thread context after `src/tools/index.ts` changes are applied incorrectly. The preferred design is to pass the parent plugin context from `src/tools/index.ts`, so no separate plugin runtime field is needed.
- Create `src/db/migrations/044_parent_shared_context_entities.ts`: promote existing thread-owned rows for durable shared entities to the parent group context.
- Modify `src/db/index.ts`: register migration 044.
- Test `tests/chat/scoped-context.test.ts` or existing scoped-context test file if present: add coverage for parent extraction if missing.
- Test `tests/tools/tools-builder.test.ts`: verify durable tools receive parent context while attachment/staged/history tools remain thread-scoped.
- Test `tests/tools/index.test.ts`: verify tool preferences, MCP endpoints, and plugin eligibility use parent context for thread turns.
- Test `tests/system-prompt.test.ts`: verify parent group instructions and plugin fragments are included for thread turns.
- Test `tests/llm-orchestrator.test.ts`: verify AI output settings are read from parent group context.
- Test `tests/db/migrations/044_parent_shared_context_entities.test.ts`: verify migration promotes only the intended tables/columns and preserves isolated tables.

## Scope Rules

Thread-isolated after this change:

- `conversation_history`
- `memory_summary`
- `memory_facts`
- `attachments`
- `staged_files`
- `message_metadata`
- `llm_usage_events`
- `tool_call_events`

Shared at parent group level after this change:

- `user_instructions`
- `memos`
- `recurring_tasks`
- `scheduled_prompts.created_by_user_id`
- `alert_prompts.created_by_user_id`
- `plugin_context_state`
- `plugin_kv`
- `web_rate_limit.actor_id` for new web fetches
- Tool preferences stored in `user_config.tool_prefs`
- MCP endpoints stored in `user_config.mcp_endpoints`
- AI output settings stored in `user_config.ai_*`
- Plugin config requirements stored in `user_config.plugin:*`

Important deferred prompt rule:

- Change the owner/listing key to parent group context.
- Do not rewrite `delivery_context_id` from thread to parent. A prompt created in a thread must still deliver back to that thread.

---

### Task 1: Add Tool Builder Owner Tests

**Files:**

- Modify: `tests/tools/tools-builder.test.ts`
- Modify later: `src/tools/tools-builder.ts`

- [ ] **Step 1: Write failing tests for parent-owned durable tools**

Add tests that build tools for a thread-scoped group context and assert durable tool factories receive the parent group context. Use the existing local test style in `tests/tools/tools-builder.test.ts`; if the file does not already mock tool factories, add focused dependency seams only where needed.

Core test intent:

```ts
import { describe, expect, test } from 'bun:test'

import { getConfigContextIdFromStorageContextId, toScopedThreadContextId } from '../../src/chat/scoped-context.js'
import { buildTools } from '../../src/tools/tools-builder.js'
import { createMockProvider } from './mock-provider.js'

describe('buildTools storage ownership', () => {
  test('uses parent group context for durable group-thread tools', () => {
    const threadContextId = toScopedThreadContextId({
      platformInstanceId: 'telegram-default',
      nativeContextId: 'group-1',
      threadId: '42',
    })
    const parentContextId = getConfigContextIdFromStorageContextId(threadContextId)
    const provider = createMockProvider()

    const tools = buildTools(provider, 'user-1', threadContextId, 'normal', 'group', 'alice')

    expect(Object.keys(tools)).toContain('save_memo')
    expect(Object.keys(tools)).toContain('create_recurring_task')
    expect(Object.keys(tools)).toContain('save_instruction')
    expect(parentContextId).not.toBe(threadContextId)
  })
})
```

If this existing test file has direct executor helpers, add executor-level assertions instead of key-only assertions:

```ts
const saveMemo = getToolExecutor(tools.save_memo)
await saveMemo({ content: 'group memo', tags: [] })
expect(listMemos(parentContextId)).toHaveLength(1)
expect(listMemos(threadContextId)).toHaveLength(0)
```

- [ ] **Step 2: Write failing test that attachments remain thread-scoped**

Add an assertion that `list_files`, `search_staged_files`, and `resolve_staged_file` still use the original `threadContextId`. Use existing attachment test helpers if present.

```ts
test('keeps attachment and staged-file tools on the current thread context', () => {
  const threadContextId = toScopedThreadContextId({
    platformInstanceId: 'telegram-default',
    nativeContextId: 'group-1',
    threadId: '42',
  })
  const provider = createMockProvider({ capabilities: new Set(['attachments.upload']) })

  const tools = buildTools(provider, 'user-1', threadContextId, 'normal', 'group', 'alice')

  expect(Object.keys(tools)).toContain('upload_attachment')
  expect(Object.keys(tools)).toContain('search_staged_files')
})
```

- [ ] **Step 3: Run the targeted test and verify failure**

Run: `bun test tests/tools/tools-builder.test.ts`

Expected: FAIL because durable tools still use the thread context.

- [ ] **Step 4: Implement parent owner routing in `src/tools/tools-builder.ts`**

Change the import and owner resolver:

```ts
import { getConfigContextIdFromStorageContextId, hasThreadContextId } from '../chat/scoped-context.js'

function getStorageOwnerId(chatUserId: string | undefined, contextId: string | undefined): string | undefined {
  if (contextId !== undefined) return getConfigContextIdFromStorageContextId(contextId)
  return chatUserId
}
```

Change instruction tools to receive the shared owner, not the raw thread context:

```ts
addInstructionTools(tools, storageOwnerId)
```

Keep these calls thread-scoped:

```ts
addAttachmentTools(tools, provider, contextId)
tools['search_staged_files'] = makeSearchStagedFilesTool(contextId)
tools['resolve_staged_file'] = makeResolveStagedFileTool(contextId, stagedDownloadFn)
addLookupGroupHistoryTool(tools, chatUserId, contextId)
```

Keep deferred prompt delivery context thread-scoped while owner becomes parent:

```ts
addDeferredPromptTools(tools, storageOwnerId, chatUserId, contextId, contextType, username)
```

Use the parent owner for web-fetch quota actor while keeping distillation/storage context as current thread:

```ts
addWebFetchTool(tools, contextId, storageOwnerId, contextType)
```

- [ ] **Step 5: Run test to verify pass**

Run: `bun test tests/tools/tools-builder.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tools/tools-builder.ts tests/tools/tools-builder.test.ts
git commit -m "fix: share durable group thread tool state"
```

---

### Task 2: Share Tool Preferences, MCP, Plugins, And Prompt Context

**Files:**

- Modify: `src/tools/index.ts`
- Modify: `src/system-prompt.ts`
- Modify: `src/llm-orchestrator.ts`
- Test: `tests/tools/index.test.ts`
- Test: `tests/system-prompt.test.ts`
- Test: `tests/llm-orchestrator.test.ts`

- [ ] **Step 1: Write failing tool assembly tests**

Add tests for parent lookup of tool preferences and MCP/plugin context. The essential assertion is that a disabled parent-group tool is disabled in a thread turn.

```ts
import { describe, expect, test } from 'bun:test'

import { toScopedContextId, toScopedThreadContextId } from '../../src/chat/scoped-context.js'
import { setToolPrefs } from '../../src/tools/tool-preferences.js'
import { makeTools } from '../../src/tools/index.js'
import { createMockProvider } from './mock-provider.js'

describe('makeTools group thread sharing', () => {
  test('applies parent group tool preferences in thread context', async () => {
    const parentContextId = toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: 'group-1' })
    const threadContextId = toScopedThreadContextId({
      platformInstanceId: 'telegram-default',
      nativeContextId: 'group-1',
      threadId: '42',
    })
    setToolPrefs(parentContextId, { disabledDomains: ['memory'], toolOverrides: {} })

    const tools = await makeTools(createMockProvider(), {
      storageContextId: threadContextId,
      chatUserId: 'user-1',
      contextType: 'group',
    })

    expect(tools.save_memo).toBeUndefined()
    expect(tools.search_memos).toBeUndefined()
  })
})
```

- [ ] **Step 2: Write failing system prompt test**

Add or extend `tests/system-prompt.test.ts` so a parent instruction appears in a thread prompt.

```ts
import { describe, expect, test } from 'bun:test'

import { saveInstruction } from '../src/instructions.js'
import { buildSystemPrompt } from '../src/system-prompt.js'
import { toScopedContextId, toScopedThreadContextId } from '../src/chat/scoped-context.js'
import { createMockProvider } from './tools/mock-provider.js'

describe('buildSystemPrompt group thread sharing', () => {
  test('includes parent group instructions for thread context', () => {
    const parentContextId = toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: 'group-1' })
    const threadContextId = toScopedThreadContextId({
      platformInstanceId: 'telegram-default',
      nativeContextId: 'group-1',
      threadId: '42',
    })
    saveInstruction(parentContextId, 'Use concise status updates for this group.')

    const prompt = buildSystemPrompt(createMockProvider(), threadContextId)

    expect(prompt).toContain('Use concise status updates for this group.')
  })
})
```

- [ ] **Step 3: Write failing LLM output settings test**

Add coverage that `processMessage` reads AI progress visibility from parent group context. If `tests/llm-orchestrator.test.ts` already has dependency seams, assert `createAiProgressReporter` receives parent settings through behavior; otherwise test a new small helper extracted in Step 5.

Preferred small helper test after extraction:

```ts
import { getConfigContextIdFromStorageContextId, toScopedThreadContextId } from '../src/chat/scoped-context.js'
import { resolveAiOutputSettingsContextId } from '../src/llm-orchestrator.js'

test('AI output settings context resolves thread to parent group', () => {
  const threadContextId = toScopedThreadContextId({
    platformInstanceId: 'telegram-default',
    nativeContextId: 'group-1',
    threadId: '42',
  })

  expect(resolveAiOutputSettingsContextId(threadContextId)).toBe(
    getConfigContextIdFromStorageContextId(threadContextId),
  )
})
```

- [ ] **Step 4: Run targeted tests and verify failure**

Run:

```bash
bun test tests/tools/index.test.ts tests/system-prompt.test.ts tests/llm-orchestrator.test.ts
```

Expected: FAIL because current code reads thread context preferences/instructions/settings.

- [ ] **Step 5: Implement parent context in `src/tools/index.ts`**

Import the helper:

```ts
import { getConfigContextIdFromStorageContextId } from '../chat/scoped-context.js'
```

Apply tool preferences using parent context:

```ts
function applyToolPreferences(tools: ToolSet, contextId: string | undefined): ToolSet {
  if (contextId === undefined) return tools
  const prefsContextId = getConfigContextIdFromStorageContextId(contextId)
  const prefs = getToolPrefs(prefsContextId)
  const { enabled } = partitionToolNames(prefs, Object.keys(tools))
  return Object.fromEntries(Object.entries(tools).filter(([name]) => enabled.has(name)))
}
```

When building MCP and plugin tools, derive a parent plugin/config context:

```ts
const contextId = storageContextId
const sharedContextId = contextId === undefined ? undefined : getConfigContextIdFromStorageContextId(contextId)
```

Use `sharedContextId` for MCP/plugin configuration:

```ts
if (sharedContextId !== undefined) {
  mcpTools = await buildMcpToolSet(sharedContextId)
}

if (sharedContextId !== undefined && chatUserId !== undefined) {
  const result = await buildPluginAndMcpTools(provider, sharedContextId, chatUserId, wrappedBuiltins)
  pluginTools = result.pluginTools
}
```

Keep built-in tools built with the original `contextId` so attachment/history/thread-local behavior remains intact:

```ts
const tools = buildTools(provider, chatUserId, contextId, mode, contextType, username, stagedDownloadFn)
```

- [ ] **Step 6: Implement parent context in `src/system-prompt.ts`**

Import the helper:

```ts
import { getConfigContextIdFromStorageContextId } from './chat/scoped-context.js'
```

Change `assembleSystemPrompt()` to use parent context for durable prompt configuration:

```ts
const sharedContextId = getConfigContextIdFromStorageContextId(contextId)
```

Use `sharedContextId` here:

```ts
const line = buildUnavailableLine(getToolPrefs(sharedContextId), enabledToolNames)
const basePrompt = `${buildInstructionsBlock(sharedContextId)}${
  addendum === '' ? basePromptBody : `${basePromptBody}\n\n${addendum}`
}`
const activePlugins = getPluginsForContext(sharedContextId)
```

- [ ] **Step 7: Implement parent context in `src/llm-orchestrator.ts`**

Import the helper if not already imported:

```ts
import { getConfigContextIdFromStorageContextId } from './chat/scoped-context.js'
```

Add a small exported helper for direct testing:

```ts
export const resolveAiOutputSettingsContextId = (contextId: string): string =>
  getConfigContextIdFromStorageContextId(contextId)
```

Use it when creating the progress reporter:

```ts
const progressReporter = createAiProgressReporter(
  reply,
  getAiOutputSettings(resolveAiOutputSettingsContextId(contextId)),
)
```

- [ ] **Step 8: Run targeted tests and verify pass**

Run:

```bash
bun test tests/tools/index.test.ts tests/system-prompt.test.ts tests/llm-orchestrator.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/tools/index.ts src/system-prompt.ts src/llm-orchestrator.ts tests/tools/index.test.ts tests/system-prompt.test.ts tests/llm-orchestrator.test.ts
git commit -m "fix: inherit group thread configuration"
```

---

### Task 3: Add Migration For Existing Thread-Owned Durable Rows

**Files:**

- Create: `src/db/migrations/044_parent_shared_context_entities.ts`
- Modify: `src/db/index.ts`
- Test: `tests/db/migrations/044_parent_shared_context_entities.test.ts`

- [ ] **Step 1: Write failing migration tests**

Create `tests/db/migrations/044_parent_shared_context_entities.test.ts`.

Test these behaviors:

- `user_instructions.context_id` moves from thread to parent.
- `memos.user_id` moves from thread to parent.
- `recurring_tasks.user_id` moves from thread to parent.
- `scheduled_prompts.created_by_user_id` moves from thread to parent, but `delivery_context_id` stays thread-scoped.
- `alert_prompts.created_by_user_id` moves from thread to parent, but `delivery_context_id` stays thread-scoped.
- `plugin_context_state.context_id` moves from thread to parent when parent row does not exist.
- `plugin_kv.context_id` moves from thread to parent when parent row does not exist.
- Parent rows win conflicts for `plugin_context_state` and `plugin_kv`.
- `memory_facts`, `memory_summary`, `conversation_history`, `attachments`, `staged_files`, `message_metadata`, `llm_usage_events`, and `tool_call_events` remain thread-scoped.

Use this test structure:

```ts
import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'

import { toScopedContextId, toScopedThreadContextId } from '../../../src/chat/scoped-context.js'
import { migration044ParentSharedContextEntities } from '../../../src/db/migrations/044_parent_shared_context_entities.js'

describe('migration044ParentSharedContextEntities', () => {
  test('promotes durable thread-owned rows to parent group context', () => {
    const db = new Database(':memory:')
    const parent = toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: 'group-1' })
    const thread = toScopedThreadContextId({
      platformInstanceId: 'telegram-default',
      nativeContextId: 'group-1',
      threadId: '42',
    })

    db.run(
      `CREATE TABLE user_instructions (id TEXT PRIMARY KEY, context_id TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL)`,
    )
    db.run(
      `CREATE TABLE memos (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, content TEXT NOT NULL, summary TEXT, tags TEXT NOT NULL, embedding BLOB, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    )
    db.run(
      `CREATE TABLE recurring_tasks (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, project_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT, priority TEXT, status TEXT, assignee TEXT, labels TEXT, trigger_type TEXT NOT NULL, rrule TEXT, dtstart_utc TEXT, timezone TEXT NOT NULL, enabled TEXT NOT NULL, catch_up TEXT NOT NULL, last_run TEXT, next_run TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    )
    db.run(
      `CREATE TABLE scheduled_prompts (id TEXT PRIMARY KEY, created_by_user_id TEXT NOT NULL, created_by_username TEXT, delivery_context_id TEXT, delivery_context_type TEXT, delivery_thread_id TEXT, audience TEXT NOT NULL, mention_user_ids TEXT NOT NULL, prompt TEXT NOT NULL, fire_at TEXT NOT NULL, rrule TEXT, dtstart_utc TEXT, timezone TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL, last_executed_at TEXT, execution_metadata TEXT NOT NULL)`,
    )
    db.run(
      `CREATE TABLE alert_prompts (id TEXT PRIMARY KEY, created_by_user_id TEXT NOT NULL, created_by_username TEXT, delivery_context_id TEXT, delivery_context_type TEXT, delivery_thread_id TEXT, audience TEXT NOT NULL, mention_user_ids TEXT NOT NULL, prompt TEXT NOT NULL, condition TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, last_triggered_at TEXT, cooldown_minutes INTEGER NOT NULL, execution_metadata TEXT NOT NULL)`,
    )
    db.run(
      `CREATE TABLE plugin_context_state (plugin_id TEXT NOT NULL, context_id TEXT NOT NULL, enabled INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (plugin_id, context_id))`,
    )
    db.run(
      `CREATE TABLE plugin_kv (plugin_id TEXT NOT NULL, context_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (plugin_id, context_id, key))`,
    )
    db.run(
      `CREATE TABLE memory_facts (user_id TEXT NOT NULL, identifier TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL, last_seen TEXT NOT NULL, PRIMARY KEY (user_id, identifier))`,
    )

    db.run(`INSERT INTO user_instructions VALUES ('ins-1', ?, 'be brief', 'now')`, [thread])
    db.run(`INSERT INTO memos VALUES ('memo-1', ?, 'memo', NULL, '[]', NULL, 'active', 'now', 'now')`, [thread])
    db.run(
      `INSERT INTO recurring_tasks VALUES ('rec-1', ?, 'p1', 'title', NULL, NULL, NULL, NULL, NULL, 'cron', NULL, NULL, 'UTC', '1', '0', NULL, NULL, 'now', 'now')`,
      [thread],
    )
    db.run(
      `INSERT INTO scheduled_prompts VALUES ('sch-1', ?, NULL, ?, 'group', '42', 'personal', '[]', 'prompt', 'later', NULL, NULL, NULL, 'active', 'now', NULL, '{}')`,
      [thread, thread],
    )
    db.run(
      `INSERT INTO alert_prompts VALUES ('al-1', ?, NULL, ?, 'group', '42', 'personal', '[]', 'prompt', '{}', 'active', 'now', NULL, 60, '{}')`,
      [thread, thread],
    )
    db.run(`INSERT INTO plugin_context_state VALUES ('hello-world', ?, 1, 'now')`, [thread])
    db.run(`INSERT INTO plugin_kv VALUES ('hello-world', ?, 'k', 'v', 'now', 'now')`, [thread])
    db.run(`INSERT INTO memory_facts VALUES (?, 'fact-1', 'Fact', '', 'now')`, [thread])

    migration044ParentSharedContextEntities.up(db)

    expect(db.query(`SELECT context_id FROM user_instructions`).get()).toEqual({ context_id: parent })
    expect(db.query(`SELECT user_id FROM memos`).get()).toEqual({ user_id: parent })
    expect(db.query(`SELECT user_id FROM recurring_tasks`).get()).toEqual({ user_id: parent })
    expect(db.query(`SELECT created_by_user_id, delivery_context_id FROM scheduled_prompts`).get()).toEqual({
      created_by_user_id: parent,
      delivery_context_id: thread,
    })
    expect(db.query(`SELECT created_by_user_id, delivery_context_id FROM alert_prompts`).get()).toEqual({
      created_by_user_id: parent,
      delivery_context_id: thread,
    })
    expect(db.query(`SELECT context_id FROM plugin_context_state`).get()).toEqual({ context_id: parent })
    expect(db.query(`SELECT context_id FROM plugin_kv`).get()).toEqual({ context_id: parent })
    expect(db.query(`SELECT user_id FROM memory_facts`).get()).toEqual({ user_id: thread })
  })
})
```

- [ ] **Step 2: Run migration test and verify failure**

Run: `bun test tests/db/migrations/044_parent_shared_context_entities.test.ts`

Expected: FAIL because migration file does not exist.

- [ ] **Step 3: Implement migration**

Create `src/db/migrations/044_parent_shared_context_entities.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { isScopedThreadContextId, getMainContextIdFromThreadContextId } from '../../chat/scoped-context.js'
import type { Migration } from '../migrate.js'

type Row = Readonly<{ rowid: number; value: string }>

const THREAD_MARKER = ':thread:'

const tableExists = (db: Database, table: string): boolean =>
  db
    .query<{ name: string }, [string]>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table) !== null

const columnExists = (db: Database, table: string, column: string): boolean =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => row.name === column)

const isThreadValue = (value: string): boolean => isScopedThreadContextId(value) || value.includes(THREAD_MARKER)

const parentContext = (value: string): string => getMainContextIdFromThreadContextId(value)

const promoteSimpleColumn = (db: Database, table: string, column: string): void => {
  if (!tableExists(db, table) || !columnExists(db, table, column)) return
  const rows = db.query<Row, []>(`SELECT rowid, ${column} AS value FROM ${table} WHERE ${column} IS NOT NULL`).all()
  for (const row of rows) {
    if (!isThreadValue(row.value)) continue
    db.run(`UPDATE ${table} SET ${column} = ? WHERE rowid = ?`, [parentContext(row.value), row.rowid])
  }
}

const promotePluginContextState = (db: Database): void => {
  if (!tableExists(db, 'plugin_context_state')) return
  const rows = db
    .query<
      Row & { plugin_id: string },
      []
    >(`SELECT rowid, plugin_id, context_id AS value FROM plugin_context_state WHERE context_id IS NOT NULL`)
    .all()
  for (const row of rows) {
    if (!isThreadValue(row.value)) continue
    const parent = parentContext(row.value)
    const conflict = db
      .query(`SELECT 1 FROM plugin_context_state WHERE plugin_id = ? AND context_id = ? AND rowid <> ?`)
      .get(row.plugin_id, parent, row.rowid)
    if (conflict !== null) db.run(`DELETE FROM plugin_context_state WHERE rowid = ?`, [row.rowid])
    else db.run(`UPDATE plugin_context_state SET context_id = ? WHERE rowid = ?`, [parent, row.rowid])
  }
}

const promotePluginKv = (db: Database): void => {
  if (!tableExists(db, 'plugin_kv')) return
  const rows = db
    .query<
      Row & { plugin_id: string; key: string },
      []
    >(`SELECT rowid, plugin_id, key, context_id AS value FROM plugin_kv WHERE context_id IS NOT NULL`)
    .all()
  for (const row of rows) {
    if (!isThreadValue(row.value)) continue
    const parent = parentContext(row.value)
    const conflict = db
      .query(`SELECT 1 FROM plugin_kv WHERE plugin_id = ? AND context_id = ? AND key = ? AND rowid <> ?`)
      .get(row.plugin_id, parent, row.key, row.rowid)
    if (conflict !== null) db.run(`DELETE FROM plugin_kv WHERE rowid = ?`, [row.rowid])
    else db.run(`UPDATE plugin_kv SET context_id = ? WHERE rowid = ?`, [parent, row.rowid])
  }
}

export const migration044ParentSharedContextEntities: Migration = {
  id: '044_parent_shared_context_entities',
  up(db: Database): void {
    promoteSimpleColumn(db, 'user_instructions', 'context_id')
    promoteSimpleColumn(db, 'memos', 'user_id')
    promoteSimpleColumn(db, 'recurring_tasks', 'user_id')
    promoteSimpleColumn(db, 'scheduled_prompts', 'created_by_user_id')
    promoteSimpleColumn(db, 'alert_prompts', 'created_by_user_id')
    promotePluginContextState(db)
    promotePluginKv(db)
  },
}
```

- [ ] **Step 4: Register migration in `src/db/index.ts`**

Import and append the migration after 043:

```ts
import { migration044ParentSharedContextEntities } from './migrations/044_parent_shared_context_entities.js'
```

Add to the migration list:

```ts
migration044ParentSharedContextEntities,
```

- [ ] **Step 5: Run migration test and verify pass**

Run: `bun test tests/db/migrations/044_parent_shared_context_entities.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db/index.ts src/db/migrations/044_parent_shared_context_entities.ts tests/db/migrations/044_parent_shared_context_entities.test.ts
git commit -m "fix: migrate shared group thread entities"
```

---

### Task 4: Verify Deferred Prompt Ownership And Delivery Semantics

**Files:**

- Modify: `tests/deferred-prompts/*.test.ts` matching existing local structure
- Modify only if tests reveal a bug: `src/deferred-prompts/tool-handlers.ts`, `src/deferred-prompts/scheduled.ts`, `src/deferred-prompts/alerts.ts`

- [ ] **Step 1: Write failing tests for group thread deferred prompts**

Add a test around the public tool handler or `createScheduledPrompt()` that creates a scheduled prompt from a thread context and verifies:

- `createdByUserId` is parent group context.
- `deliveryTarget.storageContextId` is the original thread context.
- Listing by parent group finds it.
- Listing by thread context does not need to find it after this change.

Test intent:

```ts
test('thread-created scheduled prompt is owned by parent group and delivered to thread', () => {
  const parentContextId = toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: 'group-1' })
  const threadContextId = toScopedThreadContextId({
    platformInstanceId: 'telegram-default',
    nativeContextId: 'group-1',
    threadId: '42',
  })

  const result = executeCreate(
    parentContextId,
    {
      prompt: 'post status',
      schedule: { fire_at: { date: '2099-01-01', time: '09:00' } },
      execution: { mode: 'lightweight', delivery_brief: 'status' },
    },
    { userId: 'user-1', storageContextId: threadContextId, contextType: 'group', username: 'alice' },
  )

  expect(result).toMatchObject({ status: 'created', type: 'scheduled' })
  const prompts = listScheduledPrompts(parentContextId)
  expect(prompts).toHaveLength(1)
  expect(prompts[0]!.deliveryTarget.storageContextId).toBe(threadContextId)
})
```

- [ ] **Step 2: Run deferred prompt tests and verify failure if ownership is still thread-scoped**

Run: `bun test tests/deferred-prompts`

Expected: FAIL before Task 1 owner routing is complete, PASS after Task 1 unless deeper issues exist.

- [ ] **Step 3: Fix only if needed**

If the test fails after Task 1, inspect `src/deferred-prompts/tool-handlers.ts` and ensure the first `userId` argument passed into `executeCreate()` is the parent owner from `makeCreateDeferredPromptTool()` while `deliveryCtx.storageContextId` remains the thread context.

Expected correct call in `src/tools/create-deferred-prompt.ts` remains:

```ts
return executeCreate(userId, input, { userId: actorUserId, storageContextId, contextType, username })
```

Where `userId` is parent owner and `storageContextId` is current thread context.

- [ ] **Step 4: Run deferred prompt tests and verify pass**

Run: `bun test tests/deferred-prompts`

Expected: PASS.

- [ ] **Step 5: Commit if code or tests changed**

```bash
git add tests/deferred-prompts src/deferred-prompts src/tools/create-deferred-prompt.ts
git commit -m "test: cover group thread deferred prompt ownership"
```

---

### Task 5: Full Verification

**Files:**

- No planned source edits.

- [ ] **Step 1: Run targeted suites**

Run:

```bash
bun test tests/tools tests/deferred-prompts tests/db/migrations/044_parent_shared_context_entities.test.ts tests/system-prompt.test.ts tests/llm-orchestrator.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `bun typecheck`

Expected: PASS.

- [ ] **Step 3: Run lint**

Run: `bun lint`

Expected: PASS.

- [ ] **Step 4: Run main test suite**

Run: `bun test`

Expected: PASS.

- [ ] **Step 5: Inspect diff**

Run: `git diff --stat && git diff`

Expected: Only the files listed in this plan changed. No `memory_facts`, `memory_summary`, `conversation_history`, `attachments`, `staged_files`, `message_metadata`, `llm_usage_events`, or `tool_call_events` ownership migration should exist.

- [ ] **Step 6: Commit verification fixes if any**

```bash
git add src tests
git commit -m "test: verify shared group thread storage"
```

Only run this commit if Step 1-5 required follow-up edits.

---

## Self-Review

Spec coverage:

- User instructions shared: Task 1 and Task 3.
- Memos shared: Task 1 and Task 3.
- Recurring tasks shared: Task 1 and Task 3.
- Deferred prompt ownership shared while thread delivery preserved: Task 1, Task 3, Task 4.
- Plugin state/KV shared: Task 2 and Task 3.
- Web rate limit no longer thread-bypassable for new fetches: Task 1.
- `memory_facts` remains thread-isolated: Task 3 explicitly tests no migration.
- Conversation history, summaries, attachments, staged files, message metadata, and usage telemetry remain thread-isolated: Task 1 and Task 3 preserve them.

Placeholder scan:

- No task uses TBD or open-ended implementation language. Each code step has concrete target files and snippets.

Type consistency:

- Reuses existing `getConfigContextIdFromStorageContextId()` and `getMainContextIdFromThreadContextId()` helpers.
- No new storage-context abstraction is introduced.
- Migration naming follows existing numeric migration style.
