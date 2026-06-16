<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Scope Corrections & Declarative Registry Implementation Plan (Plan 3 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two scope mistakes — attachments are unreachable across sibling threads, and the web-fetch quota is pooled per-group instead of per-user — and replace the fragile, four-places-to-edit scope model with one declarative `ENTITY_SCOPES` registry guarded by a consistency test.

**Architecture:** Attachments gain a denormalized `group_context_id` (the thread-stripped parent), populated at ingest and used to widen read queries for group contexts only (write/ingest stays thread-scoped). The web-fetch tool keys its quota on `chatUserId` instead of the group-stripped owner id. A new `src/chat/context-scope.ts` declares every context-owned entity's effective scope plus its raw column behavior; a unit test reconciles it against `CONTEXT_OWNED_COLUMNS.threadScoped`, making it impossible to mislabel an entity's scope again.

**Tech Stack:** Bun, TypeScript (strict, `.js` import paths), Drizzle ORM over `bun:sqlite`, Zod v4. Tests: `bun run test`, DI-first per `tests/CLAUDE.md`.

**Independent of Plans 1 & 2** — can land before, after, or in parallel. **Reference spec:** `docs/superpowers/specs/2026-06-16-cross-thread-memory-and-context-scope-design.md` §5–§6.

---

## File Structure

| File                                                | Responsibility                                                                  | Change |
| --------------------------------------------------- | ------------------------------------------------------------------------------- | ------ |
| `src/db/migrations/057_attachment_group_context.ts` | Add `group_context_id` to `attachments` + `staged_files`                        | Create |
| `src/db/index.ts`                                   | Register migration 057                                                          | Modify |
| `src/db/attachments-schema.ts`                      | `groupContextId` column                                                         | Modify |
| `src/db/staged-schema.ts`                           | `groupContextId` column                                                         | Modify |
| `src/attachments/store.ts`                          | Populate `group_context_id` in `saveAttachment`                                 | Modify |
| `src/attachments/staged.ts`                         | Populate `group_context_id` on staged insert; group-widened `searchStagedFiles` | Modify |
| `src/attachments/workspace.ts`                      | Group-widened `listActiveAttachments`                                           | Modify |
| `src/tools/workspace-files.ts`                      | Thread `groupContextId` into `list_files`                                       | Modify |
| `src/tools/staged-tools.ts`                         | Thread `groupContextId` into `search_staged_files`                              | Modify |
| `src/tools/provider-independent-tools-builder.ts`   | Compute group-read id (group ctx only); web-fetch actor = `chatUserId`          | Modify |
| `src/chat/context-scope.ts`                         | `ENTITY_SCOPES`, `EffectiveScope`, `getScopeKey`                                | Create |
| `tests/chat/context-scope-consistency.test.ts`      | Reconcile registry vs `CONTEXT_OWNED_COLUMNS`                                   | Create |

---

## Task 1: Migration 057 — `group_context_id` columns

**Files:**

- Create: `src/db/migrations/057_attachment_group_context.ts`
- Modify: `src/db/index.ts`
- Test: `tests/db/migration-057.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/db/migration-057.test.ts
import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/index.js'

const cols = (db: Database, table: string): string[] =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((r) => r.name)

describe('migration 057', () => {
  test('adds group_context_id to attachments and staged_files', () => {
    const db = new Database(':memory:')
    runMigrations(db, MIGRATIONS)
    expect(cols(db, 'attachments')).toContain('group_context_id')
    expect(cols(db, 'staged_files')).toContain('group_context_id')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/db/migration-057.test.ts`
Expected: FAIL — column absent.

- [ ] **Step 3: Create the migration**

```typescript
// src/db/migrations/057_attachment_group_context.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:057' })

const columnExists = (db: Database, table: string, column: string): boolean =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => row.name === column)

const up = (db: Database): void => {
  if (!columnExists(db, 'attachments', 'group_context_id')) {
    db.run(`ALTER TABLE attachments ADD COLUMN group_context_id TEXT`)
  }
  if (!columnExists(db, 'staged_files', 'group_context_id')) {
    db.run(`ALTER TABLE staged_files ADD COLUMN group_context_id TEXT`)
  }
  db.run(`CREATE INDEX IF NOT EXISTS idx_attachments_group ON attachments(group_context_id, is_active)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_staged_group ON staged_files(group_context_id, status)`)
  log.info('migration 057: attachment/staged group_context_id added')
}

export const migration057AttachmentGroupContext: Migration = { id: '057_attachment_group_context', up }

export default migration057AttachmentGroupContext
```

- [ ] **Step 4: Register**

In `src/db/index.ts`, import and append after `migration056ProvisionalMemory` (or after `migration055...` if Plan 1 is not merged — append as the last element regardless):

```typescript
import { migration057AttachmentGroupContext } from './migrations/057_attachment_group_context.js'
```

```typescript
  migration057AttachmentGroupContext,
]
```

- [ ] **Step 5: Run test + commit**

Run: `bun test tests/db/migration-057.test.ts`
Expected: PASS.

```bash
git add src/db/migrations/057_attachment_group_context.ts src/db/index.ts tests/db/migration-057.test.ts
git commit -m "feat(attachments): group_context_id columns (057)"
```

---

## Task 2: Drizzle schema columns

**Files:**

- Modify: `src/db/attachments-schema.ts`
- Modify: `src/db/staged-schema.ts`
- Test: `tests/db/attachment-group-context-schema.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/db/attachment-group-context-schema.test.ts
import { beforeEach, describe, expect, test } from 'bun:test'
import { getDrizzleDb } from '../../src/db/drizzle.js'
import { attachments } from '../../src/db/attachments-schema.js'
import { eq } from 'drizzle-orm'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('attachments.groupContextId', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('round-trips group_context_id', () => {
    const db = getDrizzleDb()
    db.insert(attachments)
      .values({
        attachmentId: 'a1',
        contextId: 'g:thread:a',
        groupContextId: 'g',
        sourceProvider: 'telegram',
        filename: 'f.txt',
        checksum: 'c',
        blobKey: 'b',
        status: 'stored',
        createdAt: '2026-06-16T00:00:00.000Z',
      })
      .run()
    const row = db.select().from(attachments).where(eq(attachments.attachmentId, 'a1')).get()
    expect(row?.groupContextId).toBe('g')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/db/attachment-group-context-schema.test.ts`
Expected: FAIL — `groupContextId` not a known column.

- [ ] **Step 3: Add the columns**

In `src/db/attachments-schema.ts`, add inside the `attachments` column object (after `contextId`):

```typescript
    groupContextId: text('group_context_id'),
```

In `src/db/staged-schema.ts`, add inside the `stagedFiles` column object (after `contextId`):

```typescript
    groupContextId: text('group_context_id'),
```

- [ ] **Step 4: Run test + commit**

Run: `bun test tests/db/attachment-group-context-schema.test.ts`
Expected: PASS.

```bash
git add src/db/attachments-schema.ts src/db/staged-schema.ts tests/db/attachment-group-context-schema.test.ts
git commit -m "feat(attachments): groupContextId in drizzle schema"
```

---

## Task 3: Populate `group_context_id` at ingest

**Files:**

- Modify: `src/attachments/store.ts` (`saveAttachment`)
- Modify: `src/attachments/staged.ts` (staged insert site)
- Test: `tests/attachments/group-context-ingest.test.ts`

Compute the group id at the lowest write point so all callers benefit without API changes: `group_context_id = getConfigContextIdFromStorageContextId(contextId)`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/attachments/group-context-ingest.test.ts
import { beforeEach, describe, expect, test } from 'bun:test'
import { getDrizzleDb } from '../../src/db/drizzle.js'
import { attachments } from '../../src/db/attachments-schema.js'
import { eq } from 'drizzle-orm'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'
import { saveAttachment } from '../../src/attachments/store.js'
import { toScopedThreadContextId, toScopedContextId } from '../../src/chat/scoped-context.js'

describe('saveAttachment populates group_context_id', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('stores the thread-stripped parent for a thread context', async () => {
    const thread = toScopedThreadContextId({ platformInstanceId: 'pi', nativeContextId: 'grp', threadId: 't1' })
    const parent = toScopedContextId({ platformInstanceId: 'pi', nativeContextId: 'grp' })
    await saveAttachment({
      contextId: thread,
      sourceProvider: 'telegram',
      filename: 'f.txt',
      checksum: 'c',
      blobKey: 'b',
      status: 'stored',
      size: 1,
      mimeType: 'text/plain',
    } as Parameters<typeof saveAttachment>[0])
    const row = getDrizzleDb().select().from(attachments).where(eq(attachments.contextId, thread)).get()
    expect(row?.groupContextId).toBe(parent)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/attachments/group-context-ingest.test.ts`
Expected: FAIL — `groupContextId` is null.

- [ ] **Step 3: Populate in `saveAttachment`**

In `src/attachments/store.ts`, add the import:

```typescript
import { getConfigContextIdFromStorageContextId } from '../chat/scoped-context.js'
```

In the `.insert(attachments).values({...})` object, add (right after `contextId: input.contextId,`):

```typescript
      groupContextId: getConfigContextIdFromStorageContextId(input.contextId),
```

- [ ] **Step 4: Populate at the staged insert site**

In `src/attachments/staged.ts`, locate the `.insert(stagedFiles).values({...})` call (grep `insert(stagedFiles)`), add the same import, and add to the values object after `contextId`:

```typescript
      groupContextId: getConfigContextIdFromStorageContextId(<the contextId variable used in this insert>),
```

- [ ] **Step 5: Run test + commit**

Run: `bun test tests/attachments/group-context-ingest.test.ts`
Expected: PASS.

```bash
git add src/attachments/store.ts src/attachments/staged.ts tests/attachments/group-context-ingest.test.ts
git commit -m "feat(attachments): populate group_context_id at ingest"
```

---

## Task 4: Group-discoverable reads (group contexts only)

**Files:**

- Modify: `src/attachments/workspace.ts` (`listActiveAttachments`)
- Modify: `src/attachments/staged.ts` (`searchStagedFiles`)
- Modify: `src/tools/workspace-files.ts`, `src/tools/staged-tools.ts`
- Modify: `src/tools/provider-independent-tools-builder.ts`
- Test: `tests/attachments/group-discovery-read.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/attachments/group-discovery-read.test.ts
import { beforeEach, describe, expect, test } from 'bun:test'
import { getDrizzleDb } from '../../src/db/drizzle.js'
import { attachments } from '../../src/db/attachments-schema.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'
import { listActiveAttachments } from '../../src/attachments/workspace.js'

const seed = (attachmentId: string, contextId: string, groupContextId: string): void => {
  getDrizzleDb()
    .insert(attachments)
    .values({
      attachmentId,
      contextId,
      groupContextId,
      sourceProvider: 'telegram',
      filename: `${attachmentId}.txt`,
      checksum: attachmentId,
      blobKey: attachmentId,
      status: 'stored',
      isActive: 1,
      createdAt: '2026-06-16T00:00:00.000Z',
    })
    .run()
}

describe('listActiveAttachments group discovery', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('without groupContextId, only the exact thread is returned', () => {
    seed('a', 'g:thread:1', 'g')
    seed('b', 'g:thread:2', 'g')
    expect(listActiveAttachments('g:thread:1').map((r) => r.attachmentId)).toEqual(['a'])
  })

  test('with groupContextId, sibling-thread attachments are included', () => {
    seed('a', 'g:thread:1', 'g')
    seed('b', 'g:thread:2', 'g')
    seed('c', 'other', 'other')
    const ids = listActiveAttachments('g:thread:1', { groupContextId: 'g' })
      .map((r) => r.attachmentId)
      .sort()
    expect(ids).toEqual(['a', 'b'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/attachments/group-discovery-read.test.ts`
Expected: FAIL — `listActiveAttachments` takes one arg.

- [ ] **Step 3: Widen the store reads**

In `src/attachments/workspace.ts`, change `listActiveAttachments` to accept an optional group id and widen the `where`:

```typescript
import { and, eq, or } from 'drizzle-orm'

export function listActiveAttachments(
  contextId: string,
  options?: Readonly<{ groupContextId?: string }>,
): AttachmentRef[] {
  const scopeCondition =
    options?.groupContextId === undefined
      ? eq(attachments.contextId, contextId)
      : or(eq(attachments.contextId, contextId), eq(attachments.groupContextId, options.groupContextId))
  return getDrizzleDb()
    .select()
    .from(attachments)
    .where(and(scopeCondition, eq(attachments.isActive, 1)))
    .all()
    .filter((row) => row.clearedAt === null)
  // ...existing mapping unchanged...
}
```

In `src/attachments/staged.ts`, change `searchStagedFiles` to accept an optional group id and replace the `eq(stagedFiles.contextId, contextId)` clause with the same `or(...)` shape (preserving the existing `status` + `LIKE` conditions):

```typescript
export function searchStagedFiles(
  contextId: string,
  query: string,
  options?: Readonly<{ groupContextId?: string; limit?: number }>,
): StagedFileRef[] {
  const scopeCondition =
    options?.groupContextId === undefined
      ? eq(stagedFiles.contextId, contextId)
      : or(eq(stagedFiles.contextId, contextId), eq(stagedFiles.groupContextId, options.groupContextId))
  // ...build the same and(scopeCondition, eq(status,'staged'), or(LIKE...)) query, limit unchanged...
}
```

> Keep `resolveStagedFile` unchanged — it requires an exact `stagedId`, so group widening does not apply.

- [ ] **Step 4: Thread the group id through the tool factories**

In `src/tools/workspace-files.ts`, change `makeListFilesTool` to accept and forward the group id:

```typescript
export function makeListFilesTool(contextId: string, groupContextId?: string): ToolSet[string] {
  // ...inside execute, replace listActiveAttachments(contextId) with:
  //   listActiveAttachments(contextId, groupContextId === undefined ? undefined : { groupContextId })
}
```

In `src/tools/staged-tools.ts`, change `makeSearchStagedFilesTool` similarly:

```typescript
export function makeSearchStagedFilesTool(contextId: string, groupContextId?: string): ToolSet[string] {
  // ...inside execute, call searchStagedFiles(contextId, query, { groupContextId, limit })
}
```

- [ ] **Step 5: Compute the group-read id (group contexts only) in the builder**

In `src/tools/provider-independent-tools-builder.ts`, inside `addProviderIndependentTools`, after `const storageOwnerId = getStorageOwnerId(chatUserId, contextId)`, add:

```typescript
const groupReadContextId =
  contextType === 'group' && contextId !== undefined ? getConfigContextIdFromStorageContextId(contextId) : undefined
```

Pass it where the file tools are constructed (the `isS3Configured()` block): `makeListFilesTool(contextId, groupReadContextId)` and `makeSearchStagedFilesTool(contextId, groupReadContextId)`. (`getConfigContextIdFromStorageContextId` is already imported in this file — see line 10 of the existing import block.)

- [ ] **Step 6: Run test + typecheck + commit**

Run: `bun test tests/attachments/group-discovery-read.test.ts && bun typecheck`
Expected: PASS.

```bash
git add src/attachments/workspace.ts src/attachments/staged.ts src/tools/workspace-files.ts src/tools/staged-tools.ts src/tools/provider-independent-tools-builder.ts tests/attachments/group-discovery-read.test.ts
git commit -m "feat(attachments): group-discoverable reads for group contexts"
```

---

## Task 5: `web_rate_limit` → per-user

**Files:**

- Modify: `src/tools/provider-independent-tools-builder.ts` (web-fetch call site)
- Modify: `tests/tools/web-fetch.test.ts` (existing actor assertion)
- Test: `tests/web/rate-limit-per-user.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/web/rate-limit-per-user.test.ts
import { beforeEach, describe, expect, test } from 'bun:test'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('web fetch quota keys on the actor', () => {
  let consumeWebFetchQuota: typeof import('../../src/web/rate-limit.js').consumeWebFetchQuota
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    ;({ consumeWebFetchQuota } = await import('../../src/web/rate-limit.js'))
  })

  test('two threads of the same user share one quota; two users are independent', () => {
    const t0 = Date.parse('2026-06-16T00:00:00.000Z')
    const first = consumeWebFetchQuota('user-A', t0)
    const second = consumeWebFetchQuota('user-A', t0 + 1000) // same actor id -> same bucket
    expect(second.remaining).toBe(first.remaining - 1)
    const other = consumeWebFetchQuota('user-B', t0 + 2000)
    expect(other.remaining).toBe(first.remaining) // independent bucket
  })
})
```

> This test asserts the rate-limit primitive is per-actor-id (already true). The behavioral change is _which_ id the web-fetch tool passes; Step 3 makes that the real `chatUserId`. If `RateLimitResult` field names differ, adjust the assertions to the real shape (`remaining`/`retryAfterSec`).

- [ ] **Step 2: Run test to verify it fails (or passes trivially), then change the actor**

Run: `bun test tests/web/rate-limit-per-user.test.ts`
Expected: PASS for the primitive. The meaningful change is the wiring below.

- [ ] **Step 3: Pass `chatUserId` as the actor**

In `src/tools/provider-independent-tools-builder.ts`, change the web-fetch registration from:

```typescript
if (contextId !== undefined) tools['web_fetch'] = makeWebFetchTool(contextId, storageOwnerId, contextType)
```

to:

```typescript
if (contextId !== undefined) tools['web_fetch'] = makeWebFetchTool(contextId, chatUserId, contextType)
```

- [ ] **Step 4: Update the existing web-fetch test**

In `tests/tools/web-fetch.test.ts`, the assembled-tools test (~line 87, "uses scoped storage context as actor id…") currently expects `actorId === storageContextId`. Update it so the assembled `web_fetch` records `actorId === chatUserId` (the value passed to `buildTools(provider, '<chatUserId>', storageContextId, ...)`). Update the test name to "uses chatUserId as the web-fetch actor id". The direct-DI test (~line 36) already passes `'user-456'` as `actorUserId` and asserts it forwards — leave it, it still validates the forwarding contract.

- [ ] **Step 5: Run tests + commit**

Run: `bun test tests/tools/web-fetch.test.ts tests/web/rate-limit-per-user.test.ts`
Expected: PASS.

```bash
git add src/tools/provider-independent-tools-builder.ts tests/tools/web-fetch.test.ts tests/web/rate-limit-per-user.test.ts
git commit -m "fix(web): rate-limit web_fetch per user, not per group"
```

---

## Task 6: Declarative `ENTITY_SCOPES` registry + consistency test

**Files:**

- Create: `src/chat/context-scope.ts`
- Modify: `src/tools/provider-independent-tools-builder.ts` (`getStorageOwnerId` delegates to the registry helper)
- Test: `tests/chat/context-scope.test.ts`
- Test: `tests/chat/context-scope-consistency.test.ts`

The registry declares, per context-owned entity, its **effective** scope (`thread | group | user | group+threadOverride`) and its **raw** column behaviour (`rawThreadScoped` — does the stored id carry a thread suffix before any promotion). `getScopeKey` resolves a write/read key from the effective scope; the consistency test reconciles `rawThreadScoped` against the existing `CONTEXT_OWNED_COLUMNS.threadScoped`, so the two can never silently diverge again.

- [ ] **Step 1: Write the failing unit test**

```typescript
// tests/chat/context-scope.test.ts
import { describe, expect, test } from 'bun:test'
import { getScopeKey } from '../../src/chat/context-scope.js'

const ctx = { storageContextId: 'pi:enc:ctx:grp:thread:enc', chatUserId: 'user-1', contextType: 'group' as const }

describe('getScopeKey', () => {
  test('thread scope returns the full storage id', () => {
    expect(getScopeKey('thread', ctx)).toBe(ctx.storageContextId)
  })
  test('group scope strips the thread suffix', () => {
    expect(getScopeKey('group', ctx)).toBe('pi:enc:ctx:grp')
    expect(getScopeKey('group+threadOverride', ctx)).toBe('pi:enc:ctx:grp')
  })
  test('user scope returns the chat user id', () => {
    expect(getScopeKey('user', ctx)).toBe('user-1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/chat/context-scope.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the registry + resolver**

```typescript
// src/chat/context-scope.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getConfigContextIdFromStorageContextId } from './scoped-context.js'

export type EffectiveScope = 'thread' | 'group' | 'group+threadOverride' | 'user'

export type EntityScope = Readonly<{
  table: string
  column: string
  /** Effective read/write semantics — what `getScopeKey` resolves. */
  scope: EffectiveScope
  /** Does the stored column carry a thread-scoped id at write time (pre-promotion)? Must match CONTEXT_OWNED_COLUMNS.threadScoped. */
  rawThreadScoped: boolean
}>

export type ScopeKeyContext = Readonly<{
  storageContextId: string
  chatUserId: string
  contextType: 'dm' | 'group'
}>

/** Resolve the read/write key for an effective scope. */
export function getScopeKey(scope: EffectiveScope, ctx: ScopeKeyContext): string {
  switch (scope) {
    case 'thread':
      return ctx.storageContextId
    case 'group':
    case 'group+threadOverride':
      return getConfigContextIdFromStorageContextId(ctx.storageContextId)
    case 'user':
      return ctx.chatUserId
  }
}

// Single source of truth for context-owned entity scoping.
// `scope` is the effective behaviour; `rawThreadScoped` mirrors the migration-era column flag.
export const ENTITY_SCOPES: readonly EntityScope[] = [
  { table: 'conversation_history', column: 'user_id', scope: 'thread', rawThreadScoped: true },
  { table: 'memory_summary', column: 'user_id', scope: 'thread', rawThreadScoped: true },
  { table: 'memory_facts', column: 'user_id', scope: 'thread', rawThreadScoped: true },
  { table: 'task_snapshots', column: 'user_id', scope: 'thread', rawThreadScoped: true },
  { table: 'message_metadata', column: 'context_id', scope: 'thread', rawThreadScoped: true },
  { table: 'attachments', column: 'context_id', scope: 'thread', rawThreadScoped: true },
  { table: 'staged_files', column: 'context_id', scope: 'thread', rawThreadScoped: true },
  { table: 'llm_usage_events', column: 'storage_context_id', scope: 'thread', rawThreadScoped: true },
  { table: 'tool_call_events', column: 'storage_context_id', scope: 'thread', rawThreadScoped: true },
  { table: 'scheduled_prompts', column: 'delivery_context_id', scope: 'thread', rawThreadScoped: true },
  { table: 'alert_prompts', column: 'delivery_context_id', scope: 'thread', rawThreadScoped: true },
  // Effectively per-user (identity is the person; quota guards the actor) though the raw column is thread-shaped.
  { table: 'user_identity_mappings', column: 'context_id', scope: 'user', rawThreadScoped: true },
  { table: 'web_rate_limit', column: 'actor_id', scope: 'user', rawThreadScoped: true },
  // Group-shared via runtime strip + migration-046 promotion (raw column may still be thread-shaped historically).
  { table: 'memos', column: 'user_id', scope: 'group', rawThreadScoped: true },
  { table: 'recurring_tasks', column: 'user_id', scope: 'group', rawThreadScoped: true },
  { table: 'user_instructions', column: 'context_id', scope: 'group+threadOverride', rawThreadScoped: true },
  { table: 'scheduled_prompts', column: 'created_by_user_id', scope: 'group', rawThreadScoped: true },
  { table: 'alert_prompts', column: 'created_by_user_id', scope: 'group', rawThreadScoped: true },
  // Natively group-scoped (never thread-shaped).
  { table: 'context_settings', column: 'context_id', scope: 'group', rawThreadScoped: false },
  { table: 'user_config', column: 'user_id', scope: 'group', rawThreadScoped: false },
  { table: 'authorized_groups', column: 'group_id', scope: 'group', rawThreadScoped: false },
  { table: 'group_members', column: 'group_id', scope: 'group', rawThreadScoped: false },
  { table: 'known_group_contexts', column: 'context_id', scope: 'group', rawThreadScoped: false },
  { table: 'group_admin_observations', column: 'context_id', scope: 'group', rawThreadScoped: false },
  { table: 'group_user_observations', column: 'context_id', scope: 'group', rawThreadScoped: false },
  // Plugin state — promoted to parent (mig 046).
  { table: 'plugin_context_state', column: 'context_id', scope: 'group', rawThreadScoped: true },
  { table: 'plugin_kv', column: 'context_id', scope: 'group', rawThreadScoped: true },
]
```

- [ ] **Step 4: Write the consistency test**

```typescript
// tests/chat/context-scope-consistency.test.ts
import { describe, expect, test } from 'bun:test'
import { ENTITY_SCOPES } from '../../src/chat/context-scope.js'
import { CONTEXT_OWNED_COLUMNS } from '../../src/db/migrations/scoped-context-owned-columns.js'

const key = (t: string, c: string): string => `${t}.${c}`

describe('ENTITY_SCOPES reconciliation', () => {
  test('rawThreadScoped matches CONTEXT_OWNED_COLUMNS.threadScoped for every shared (table,column)', () => {
    const owned = new Map(CONTEXT_OWNED_COLUMNS.map((c) => [key(c.table, c.column), c.threadScoped]))
    const mismatches: string[] = []
    for (const entry of ENTITY_SCOPES) {
      const flag = owned.get(key(entry.table, entry.column))
      if (flag !== undefined && flag !== entry.rawThreadScoped) {
        mismatches.push(
          `${key(entry.table, entry.column)}: registry rawThreadScoped=${entry.rawThreadScoped} but CONTEXT_OWNED_COLUMNS=${flag}`,
        )
      }
    }
    expect(mismatches).toEqual([])
  })

  test('every effective-thread entity is rawThreadScoped (cannot group-collapse a thread-scoped entity)', () => {
    const bad = ENTITY_SCOPES.filter((e) => e.scope === 'thread' && !e.rawThreadScoped).map((e) =>
      key(e.table, e.column),
    )
    expect(bad).toEqual([])
  })

  test('every CONTEXT_OWNED_COLUMNS entry is declared in the registry', () => {
    const declared = new Set(ENTITY_SCOPES.map((e) => key(e.table, e.column)))
    const missing = CONTEXT_OWNED_COLUMNS.map((c) => key(c.table, c.column)).filter((k) => !declared.has(k))
    expect(missing).toEqual([])
  })
})
```

- [ ] **Step 5: Run both tests to verify behavior**

Run: `bun test tests/chat/context-scope.test.ts tests/chat/context-scope-consistency.test.ts`
Expected: the unit test PASSES; the consistency test PASSES only when every `rawThreadScoped` agrees with `CONTEXT_OWNED_COLUMNS` and every owned column is declared. If a mismatch/missing entry is reported, fix the `ENTITY_SCOPES` entry to match the real `threadScoped` value from `scoped-context-owned-columns.ts` (this is the test doing its job — reconcile, don't silence it).

- [ ] **Step 6: Make the registry load-bearing**

In `src/tools/provider-independent-tools-builder.ts`, reimplement `getStorageOwnerId` to resolve through the registry's group-strip (its three consumers — memos, recurring tasks, instructions — are all effective `group`), keeping the existing `undefined`/DM fallback:

```typescript
import { getScopeKey } from '../chat/context-scope.js'

export function getStorageOwnerId(chatUserId: string | undefined, contextId: string | undefined): string | undefined {
  if (contextId === undefined) return chatUserId
  return getScopeKey('group', {
    storageContextId: contextId,
    chatUserId: chatUserId ?? contextId,
    contextType: 'group',
  })
}
```

This is behavior-identical (`getScopeKey('group', …)` is exactly `getConfigContextIdFromStorageContextId(contextId)`) but routes the strip through the single source of truth.

- [ ] **Step 7: Run the full suite + commit**

Run: `bun run test && bun typecheck`
Expected: PASS (the existing `getStorageOwnerId` callers are unchanged behaviorally).

```bash
git add src/chat/context-scope.ts src/tools/provider-independent-tools-builder.ts tests/chat/context-scope.test.ts tests/chat/context-scope-consistency.test.ts
git commit -m "feat(scope): declarative ENTITY_SCOPES registry + consistency test"
```

---

## Final verification

- [ ] **Run the full server suite**: `bun run test` — all suites pass.
- [ ] **Manual scope sanity**: in a group thread, an attachment uploaded in thread A is now listable from thread B (`list_files`) but not from a different group; a DM is unaffected (no `groupContextId` widening since `contextType !== 'group'`).
- [ ] **Run staged checks**: `bun check`.

---

## Notes / deferred

- **Per-thread `user_instructions` override** (`group+threadOverride`) is declared in the registry but not yet implemented — base behavior stays group-shared. Implementing the override layer is a separate change.
- **Full migration of all `getConfigContextIdFromStorageContextId` call sites to `getScopeKey`** is intentionally out of scope; Task 6 wires the one generic helper (`getStorageOwnerId`) and establishes the registry + enforcement so new code uses `getScopeKey` going forward.
  </content>
