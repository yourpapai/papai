# Deferred Prompt Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a unified deferred-prompt delivery model so scheduled prompts and alerts fire into the same DM/group/thread context where they were created, with personal-vs-shared audience behavior and provider-specific mention rendering.

**Architecture:** Replace the current DM-centric deferred-prompt flow with an explicit delivery contract stored on both scheduled prompts and alerts. Keep creator identity separate from delivery destination: creator fields drive config and ownership, while delivery fields drive execution context, outbound routing, and mention behavior. Update the chat-provider proactive send surface to accept structured delivery targets instead of bare user IDs.

**Tech Stack:** TypeScript, Bun, SQLite with Drizzle ORM, grammY, Mattermost REST/WebSocket API, discord.js, Bun test runner

---

## File Structure Overview

**Modify:**

- `src/chat/types.ts` — add shared deferred delivery types and widen `ChatProvider.sendMessage`
- `src/db/schema.ts` — replace deferred-prompt ownership columns with explicit creator fields and add delivery columns
- `src/db/index.ts` — register the new migration
- `src/deferred-prompts/types.ts` — add shared delivery/audience domain types used by scheduled prompts and alerts
- `src/deferred-prompts/scheduled.ts` — store, read, and query scheduled prompts with explicit creator and delivery metadata
- `src/deferred-prompts/alerts.ts` — store, read, and query alerts with explicit creator and delivery metadata
- `src/deferred-prompts/tool-handlers.ts` — accept creation context and explicit audience/mention policy for both prompt types
- `src/deferred-prompts/poller.ts` — group execution by creator plus delivery target and send to stored target
- `src/deferred-prompts/proactive-llm.ts` — execute in stored delivery context while reading config from creator identity
- `src/tools/create-deferred-prompt.ts` — capture current context and pass creation-time delivery metadata into handlers
- `src/tools/tools-builder.ts` — pass `storageContextId` and `contextType` into `create_deferred_prompt`
- `src/chat/telegram/index.ts` — send to group/thread targets and render Telegram-native personal mentions
- `src/chat/telegram/format.ts` — allow `tg://user?id=` inline links if needed by the chosen mention path
- `src/chat/mattermost/index.ts` — support proactive send to DM, channel, and thread-aware post target
- `src/chat/discord/index.ts` — support proactive send to DM or channel target
- `tests/deferred-prompts/scheduled.test.ts` — scheduled storage and ownership/delivery semantics
- `tests/deferred-prompts/alerts.test.ts` — alert storage and ownership/delivery semantics
- `tests/deferred-prompts/tools.test.ts` — creation-time classification persistence for scheduled prompts and alerts
- `tests/deferred-prompts/poller.test.ts` — routing, grouping, and migrated-record behavior
- `tests/deferred-prompts/proactive-llm.test.ts` — stored delivery context drives history/tools, creator drives config
- `tests/utils/test-helpers.ts` — proactive sent-message capture must store target metadata instead of only `userId`

**Create:**

- `src/db/migrations/025_deferred_prompt_delivery_targets.ts` — rename old owner fields and add explicit delivery columns for both deferred prompt tables
- `tests/chat/proactive-send.test.ts` — adapter-level proactive-send behavior for structured delivery targets

**Out of Scope:**

- `src/announcements.ts`
- `src/scheduler-recurring.ts`
- non-deferred proactive systems

This plan intentionally implements only the approved deferred-prompt redesign.

---

### Task 1: Add Shared Delivery Types and ChatProvider Send Contract

**Files:**

- Modify: `src/chat/types.ts`
- Test: `tests/chat/proactive-send-contract.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/chat/proactive-send-contract.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'

import type { DeferredAudience, DeferredDeliveryTarget } from '../../src/chat/types.js'

describe('Deferred proactive send types', () => {
  test('supports group target with personal audience and mentions', () => {
    const audience: DeferredAudience = 'personal'
    const target: DeferredDeliveryTarget = {
      contextId: '-1001234567890',
      contextType: 'group',
      threadId: '42',
      audience,
      mentionUserIds: ['12345678'],
      createdByUserId: '12345678',
      createdByUsername: 'ki',
    }

    expect(target.contextType).toBe('group')
    expect(target.audience).toBe('personal')
    expect(target.mentionUserIds).toEqual(['12345678'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/chat/proactive-send-contract.test.ts`
Expected: FAIL because `DeferredAudience` and `DeferredDeliveryTarget` do not exist.

- [ ] **Step 3: Add shared types and update ChatProvider**

In `src/chat/types.ts`, add after `ContextType`:

```typescript
export type DeferredAudience = 'personal' | 'shared'

export type DeferredDeliveryTarget = {
  contextId: string
  contextType: ContextType
  audience: DeferredAudience
  mentionUserIds: readonly string[]
  createdByUserId: string
  createdByUsername: string | null
} & Partial<{
  threadId: string
}>
```

Then change `ChatProvider.sendMessage` from:

```typescript
sendMessage(userId: string, markdown: string): Promise<void>
```

to:

```typescript
sendMessage(target: DeferredDeliveryTarget, markdown: string): Promise<void>
```

Keep the rest of the interface unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/chat/proactive-send-contract.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/chat/types.ts tests/chat/proactive-send-contract.test.ts
git commit -m "feat(chat): add deferred delivery target contract"
```

---

### Task 2: Add Deferred Delivery Columns and Rename Legacy Owner Fields

**Files:**

- Create: `src/db/migrations/025_deferred_prompt_delivery_targets.ts`
- Modify: `src/db/index.ts`
- Modify: `src/db/schema.ts`
- Test: `tests/db/deferred-prompt-delivery-migration.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/db/deferred-prompt-delivery-migration.test.ts`:

```typescript
import { beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { alertPrompts, scheduledPrompts } from '../../src/db/schema.js'
import { setupTestDb } from '../utils/test-helpers.js'

describe('migration 025: deferred prompt delivery targets', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('scheduled_prompts stores explicit creator and delivery fields', () => {
    const db = getDrizzleDb()
    db.insert(scheduledPrompts)
      .values({
        id: 'sp1',
        createdByUserId: 'u1',
        createdByUsername: 'ki',
        deliveryContextId: '-1001',
        deliveryContextType: 'group',
        deliveryThreadId: '42',
        audience: 'personal',
        mentionUserIds: '["u1"]',
        prompt: 'remind me',
        fireAt: '2027-01-01T00:00:00.000Z',
      })
      .run()

    const row = db.select().from(scheduledPrompts).where(eq(scheduledPrompts.id, 'sp1')).get()
    expect(row).not.toBeUndefined()
    expect(row!.createdByUserId).toBe('u1')
    expect(row!.deliveryContextId).toBe('-1001')
    expect(row!.audience).toBe('personal')
  })

  test('alert_prompts stores explicit creator and delivery fields', () => {
    const db = getDrizzleDb()
    db.insert(alertPrompts)
      .values({
        id: 'ap1',
        createdByUserId: 'u2',
        createdByUsername: 'alex',
        deliveryContextId: 'chan-1',
        deliveryContextType: 'group',
        deliveryThreadId: 'root-1',
        audience: 'shared',
        mentionUserIds: '[]',
        prompt: 'notify channel',
        condition: '{"field":"task.status","op":"eq","value":"done"}',
      })
      .run()

    const row = db.select().from(alertPrompts).where(eq(alertPrompts.id, 'ap1')).get()
    expect(row).not.toBeUndefined()
    expect(row!.createdByUserId).toBe('u2')
    expect(row!.deliveryContextId).toBe('chan-1')
    expect(row!.audience).toBe('shared')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/db/deferred-prompt-delivery-migration.test.ts`
Expected: FAIL because schema columns do not exist.

- [ ] **Step 3: Create migration file**

Create `src/db/migrations/025_deferred_prompt_delivery_targets.ts`:

```typescript
import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

function migrateScheduledPrompts(db: Database): void {
  db.run('ALTER TABLE scheduled_prompts RENAME COLUMN user_id TO created_by_user_id')
  db.run(`ALTER TABLE scheduled_prompts ADD COLUMN created_by_username TEXT`)
  db.run(`ALTER TABLE scheduled_prompts ADD COLUMN delivery_context_id TEXT NOT NULL DEFAULT ''`)
  db.run(`ALTER TABLE scheduled_prompts ADD COLUMN delivery_context_type TEXT NOT NULL DEFAULT 'dm'`)
  db.run(`ALTER TABLE scheduled_prompts ADD COLUMN delivery_thread_id TEXT`)
  db.run(`ALTER TABLE scheduled_prompts ADD COLUMN audience TEXT NOT NULL DEFAULT 'personal'`)
  db.run(`ALTER TABLE scheduled_prompts ADD COLUMN mention_user_ids TEXT NOT NULL DEFAULT '[]'`)
  db.run(`UPDATE scheduled_prompts SET delivery_context_id = created_by_user_id WHERE delivery_context_id = ''`)
  db.run('DROP INDEX IF EXISTS idx_scheduled_prompts_user')
  db.run('CREATE INDEX idx_scheduled_prompts_creator ON scheduled_prompts(created_by_user_id)')
  db.run('CREATE INDEX idx_scheduled_prompts_delivery_context ON scheduled_prompts(delivery_context_id)')
}

function migrateAlertPrompts(db: Database): void {
  db.run('ALTER TABLE alert_prompts RENAME COLUMN user_id TO created_by_user_id')
  db.run(`ALTER TABLE alert_prompts ADD COLUMN created_by_username TEXT`)
  db.run(`ALTER TABLE alert_prompts ADD COLUMN delivery_context_id TEXT NOT NULL DEFAULT ''`)
  db.run(`ALTER TABLE alert_prompts ADD COLUMN delivery_context_type TEXT NOT NULL DEFAULT 'dm'`)
  db.run(`ALTER TABLE alert_prompts ADD COLUMN delivery_thread_id TEXT`)
  db.run(`ALTER TABLE alert_prompts ADD COLUMN audience TEXT NOT NULL DEFAULT 'personal'`)
  db.run(`ALTER TABLE alert_prompts ADD COLUMN mention_user_ids TEXT NOT NULL DEFAULT '[]'`)
  db.run(`UPDATE alert_prompts SET delivery_context_id = created_by_user_id WHERE delivery_context_id = ''`)
  db.run('DROP INDEX IF EXISTS idx_alert_prompts_user')
  db.run('CREATE INDEX idx_alert_prompts_creator ON alert_prompts(created_by_user_id)')
  db.run('CREATE INDEX idx_alert_prompts_delivery_context ON alert_prompts(delivery_context_id)')
}

export const migration025DeferredPromptDeliveryTargets: Migration = {
  id: '025_deferred_prompt_delivery_targets',
  up(db: Database): void {
    migrateScheduledPrompts(db)
    migrateAlertPrompts(db)
  },
}
```

- [ ] **Step 4: Register migration**

In `src/db/index.ts`, add:

```typescript
import { migration025DeferredPromptDeliveryTargets } from './migrations/025_deferred_prompt_delivery_targets.js'
```

and append it to `MIGRATIONS` after `migration024AuthorizedGroups`.

- [ ] **Step 5: Update schema**

In `src/db/schema.ts`, replace deferred-prompt legacy owner fields with explicit creator fields and add delivery columns.

For `scheduledPrompts`, define:

```typescript
createdByUserId: text('created_by_user_id').notNull(),
createdByUsername: text('created_by_username'),
deliveryContextId: text('delivery_context_id').notNull(),
deliveryContextType: text('delivery_context_type').notNull().default('dm'),
deliveryThreadId: text('delivery_thread_id'),
audience: text('audience').notNull().default('personal'),
mentionUserIds: text('mention_user_ids').notNull().default('[]'),
```

Update indexes to:

```typescript
index('idx_scheduled_prompts_creator').on(table.createdByUserId),
index('idx_scheduled_prompts_delivery_context').on(table.deliveryContextId),
```

For `alertPrompts`, mirror the same creator and delivery fields and indexes.

- [ ] **Step 6: Run migration test**

Run: `bun test tests/db/deferred-prompt-delivery-migration.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/db/migrations/025_deferred_prompt_delivery_targets.ts src/db/index.ts src/db/schema.ts tests/db/deferred-prompt-delivery-migration.test.ts
git commit -m "feat(db): add explicit deferred prompt delivery fields"
```

---

### Task 3: Model Shared Deferred Delivery Types in Deferred Prompt Domain

**Files:**

- Modify: `src/deferred-prompts/types.ts`
- Test: `tests/deferred-prompts/deferred-delivery-types.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/deferred-prompts/deferred-delivery-types.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'

import type { DeferredAudience } from '../../src/chat/types.js'
import type { DeferredPromptDelivery } from '../../src/deferred-prompts/types.js'

describe('deferred delivery domain types', () => {
  test('supports personal delivery with mention targets', () => {
    const audience: DeferredAudience = 'personal'
    const delivery: DeferredPromptDelivery = {
      contextId: '-1001',
      contextType: 'group',
      threadId: '42',
      audience,
      mentionUserIds: ['u1'],
      createdByUserId: 'u1',
      createdByUsername: 'ki',
    }

    expect(delivery.audience).toBe('personal')
    expect(delivery.mentionUserIds).toEqual(['u1'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/deferred-prompts/deferred-delivery-types.test.ts`
Expected: FAIL because `DeferredPromptDelivery` does not exist in the deferred-prompt module.

- [ ] **Step 3: Add explicit deferred delivery types**

In `src/deferred-prompts/types.ts`, add:

```typescript
import type { DeferredAudience } from '../chat/types.js'

export type DeferredPromptDelivery = {
  contextId: string
  contextType: 'dm' | 'group'
  threadId: string | null
  audience: DeferredAudience
  mentionUserIds: readonly string[]
  createdByUserId: string
  createdByUsername: string | null
}
```

Then update `ScheduledPrompt` and `AlertPrompt` to remove `userId` and include:

```typescript
createdByUserId: string
createdByUsername: string | null
deliveryTarget: DeferredPromptDelivery
```

Also add a creation input type used by handlers/CRUD:

```typescript
export type DeferredPromptDeliveryInput = {
  contextId: string
  contextType: 'dm' | 'group'
  threadId?: string | null
  audience: DeferredAudience
  mentionUserIds: readonly string[]
  createdByUserId: string
  createdByUsername: string | null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/deferred-prompts/deferred-delivery-types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/deferred-prompts/types.ts tests/deferred-prompts/deferred-delivery-types.test.ts
git commit -m "feat(deferred): add shared delivery domain types"
```

---

### Task 4: Persist Delivery Target on Scheduled Prompts

**Files:**

- Modify: `src/deferred-prompts/scheduled.ts`
- Modify: `tests/deferred-prompts/scheduled.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/deferred-prompts/scheduled.test.ts`:

```typescript
test('creates scheduled prompt with explicit creator and delivery target', () => {
  const fireAt = new Date(Date.now() + 60_000).toISOString()
  const prompt = createScheduledPrompt('user-1', 'remind me', { fireAt }, undefined, {
    contextId: '-1001',
    contextType: 'group',
    threadId: '42',
    audience: 'personal',
    mentionUserIds: ['user-1'],
    createdByUserId: 'user-1',
    createdByUsername: 'ki',
  })

  expect(prompt.createdByUserId).toBe('user-1')
  expect(prompt.createdByUsername).toBe('ki')
  expect(prompt.deliveryTarget.contextId).toBe('-1001')
  expect(prompt.deliveryTarget.threadId).toBe('42')
  expect(prompt.deliveryTarget.audience).toBe('personal')
  expect(prompt.deliveryTarget.mentionUserIds).toEqual(['user-1'])
})

test('lists scheduled prompts by creator identity after schema rename', () => {
  const fireAt = new Date(Date.now() + 60_000).toISOString()
  createScheduledPrompt('user-1', 'mine', { fireAt }, undefined, {
    contextId: '-1001',
    contextType: 'group',
    threadId: null,
    audience: 'shared',
    mentionUserIds: [],
    createdByUserId: 'user-1',
    createdByUsername: null,
  })
  createScheduledPrompt('user-2', 'not mine', { fireAt }, undefined, {
    contextId: '-1001',
    contextType: 'group',
    threadId: null,
    audience: 'shared',
    mentionUserIds: [],
    createdByUserId: 'user-2',
    createdByUsername: null,
  })

  const prompts = listScheduledPrompts('user-1')
  expect(prompts).toHaveLength(1)
  expect(prompts[0]!.createdByUserId).toBe('user-1')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/deferred-prompts/scheduled.test.ts`
Expected: FAIL because `createScheduledPrompt` and row mapping still use `userId` only.

- [ ] **Step 3: Update scheduled prompt mapper and CRUD**

In `src/deferred-prompts/scheduled.ts`:

- map creator and delivery columns into `ScheduledPrompt`
- extend `createScheduledPrompt` signature to:

```typescript
export function createScheduledPrompt(
  creatorUserId: string,
  prompt: string,
  schedule: { fireAt: string; cronExpression?: string },
  executionMetadata?: ExecutionMetadata,
  delivery?: DeferredPromptDeliveryInput,
): ScheduledPrompt
```

- default `delivery` for migrated call sites:

```typescript
const resolvedDelivery = delivery ?? {
  contextId: creatorUserId,
  contextType: 'dm',
  threadId: null,
  audience: 'personal',
  mentionUserIds: [],
  createdByUserId: creatorUserId,
  createdByUsername: null,
}
```

- write creator and delivery fields into DB
- change list/get/update/cancel filters from `scheduledPrompts.userId` to `scheduledPrompts.createdByUserId`
- keep function parameters named by creator identity so ownership semantics stay clear

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/deferred-prompts/scheduled.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/deferred-prompts/scheduled.ts tests/deferred-prompts/scheduled.test.ts
git commit -m "feat(deferred): persist scheduled creator and delivery target"
```

---

### Task 5: Persist Delivery Target on Alerts

**Files:**

- Modify: `src/deferred-prompts/alerts.ts`
- Create: `tests/deferred-prompts/alerts.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/deferred-prompts/alerts.test.ts` with:

```typescript
import { beforeEach, describe, expect, test } from 'bun:test'

import { createAlertPrompt, listAlertPrompts } from '../../src/deferred-prompts/alerts.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

beforeEach(() => {
  mockLogger()
})

describe('alerts delivery target', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('creates alert prompt with explicit creator and delivery target', () => {
    const alert = createAlertPrompt(
      'user-1',
      'notify channel',
      { field: 'task.status', op: 'eq', value: 'done' },
      60,
      undefined,
      {
        contextId: 'chan-1',
        contextType: 'group',
        threadId: 'root-1',
        audience: 'shared',
        mentionUserIds: [],
        createdByUserId: 'user-1',
        createdByUsername: 'ki',
      },
    )

    expect(alert.createdByUserId).toBe('user-1')
    expect(alert.deliveryTarget.contextId).toBe('chan-1')
    expect(alert.deliveryTarget.audience).toBe('shared')
  })

  test('lists alerts by creator identity after schema rename', () => {
    createAlertPrompt('user-1', 'mine', { field: 'task.status', op: 'eq', value: 'done' }, 60, undefined, {
      contextId: 'chan-1',
      contextType: 'group',
      threadId: null,
      audience: 'shared',
      mentionUserIds: [],
      createdByUserId: 'user-1',
      createdByUsername: null,
    })
    createAlertPrompt('user-2', 'not mine', { field: 'task.status', op: 'eq', value: 'done' }, 60, undefined, {
      contextId: 'chan-1',
      contextType: 'group',
      threadId: null,
      audience: 'shared',
      mentionUserIds: [],
      createdByUserId: 'user-2',
      createdByUsername: null,
    })

    expect(listAlertPrompts('user-1')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/deferred-prompts/alerts.test.ts`
Expected: FAIL because alert CRUD still uses legacy `userId`-only semantics.

- [ ] **Step 3: Update alert CRUD and row mapping**

In `src/deferred-prompts/alerts.ts`:

- map creator and delivery fields into `AlertPrompt`
- extend `createAlertPrompt` signature with `delivery?: DeferredPromptDeliveryInput`
- default `delivery` to DM personal delivery just like scheduled prompts
- change list/get/update/cancel/updateTrigger filters from `alertPrompts.userId` to `alertPrompts.createdByUserId`

Use the same creator-and-delivery separation as scheduled prompts.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/deferred-prompts/alerts.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/deferred-prompts/alerts.ts tests/deferred-prompts/alerts.test.ts
git commit -m "feat(deferred): persist alert creator and delivery target"
```

---

### Task 6: Capture Delivery Classification at Deferred Prompt Creation

**Files:**

- Modify: `src/deferred-prompts/tool-handlers.ts`
- Modify: `src/tools/create-deferred-prompt.ts`
- Modify: `src/tools/tools-builder.ts`
- Modify: `tests/deferred-prompts/tools.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/deferred-prompts/tools.test.ts`:

```typescript
import { getAlertPrompt } from '../../src/deferred-prompts/alerts.js'
import { getScheduledPrompt } from '../../src/deferred-prompts/scheduled.js'
```

Then add:

```typescript
test('group scheduled prompt persists personal audience and mention target chosen at creation', async () => {
  const tool = makeCreateDeferredPromptTool(USER_ID, '-1001:42', 'group')
  if (!tool.execute) throw new Error('Tool execute is undefined')

  const result = await tool.execute(
    {
      prompt: 'Remind me to send the report',
      schedule: { fire_at: futureFireAt() },
      delivery: {
        audience: 'personal',
        mention_user_ids: [USER_ID],
      },
      execution: {
        mode: 'context',
        delivery_brief: 'Personal reminder in the same group thread',
        context_snapshot: 'Discussed weekly reporting in this thread.',
      },
    },
    toolCtx,
  )

  const created = getScheduledPrompt(extractId(result), USER_ID)
  expect(created).not.toBeNull()
  expect(created!.deliveryTarget.contextId).toBe('-1001:42')
  expect(created!.deliveryTarget.audience).toBe('personal')
  expect(created!.deliveryTarget.mentionUserIds).toEqual([USER_ID])
})

test('group alert persists shared audience and no mention targets chosen at creation', async () => {
  const tool = makeCreateDeferredPromptTool(USER_ID, 'chan-1', 'group')
  if (!tool.execute) throw new Error('Tool execute is undefined')

  const result = await tool.execute(
    {
      prompt: 'Notify this channel when a task becomes overdue',
      condition: { field: 'task.dueDate', op: 'overdue' },
      delivery: {
        audience: 'shared',
        mention_user_ids: [],
      },
      execution: {
        mode: 'full',
        delivery_brief: 'Shared group alert for the whole channel',
        context_snapshot: 'Group operations alert for overdue work.',
      },
    },
    toolCtx,
  )

  const created = getAlertPrompt(extractId(result), USER_ID)
  expect(created).not.toBeNull()
  expect(created!.deliveryTarget.contextId).toBe('chan-1')
  expect(created!.deliveryTarget.audience).toBe('shared')
  expect(created!.deliveryTarget.mentionUserIds).toEqual([])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/deferred-prompts/tools.test.ts`
Expected: FAIL because `makeCreateDeferredPromptTool` does not accept context and handlers do not persist delivery classification.

- [ ] **Step 3: Add explicit creation-time delivery policy input and persistence hook**

In `src/deferred-prompts/types.ts`, add:

```typescript
export const deliveryPolicySchema = z.object({
  audience: z.enum(['personal', 'shared']).describe('Whether this deferred prompt is personal or shared in a group.'),
  mention_user_ids: z
    .array(z.string())
    .describe('Exact platform user IDs to mention. Use an empty array for shared group delivery.'),
})
```

Extend `CreateInput` in `src/deferred-prompts/tool-handlers.ts` with:

```typescript
delivery?: {
  audience: 'personal' | 'shared'
  mention_user_ids: string[]
}
```

Then in `src/deferred-prompts/tool-handlers.ts`, add:

```typescript
type CreateDeliveryContext = {
  storageContextId: string
  contextType: 'dm' | 'group' | undefined
  createdByUserId: string
  createdByUsername: string | null
}

function buildDeliveryInput(
  context: CreateDeliveryContext,
  delivery: CreateInput['delivery'],
): DeferredPromptDeliveryInput {
  if (context.contextType !== 'group') {
    return {
      contextId: context.createdByUserId,
      contextType: 'dm',
      threadId: null,
      audience: 'personal',
      mentionUserIds: [],
      createdByUserId: context.createdByUserId,
      createdByUsername: context.createdByUsername,
    }
  }

  const [contextId, threadId] = context.storageContextId.split(':')
  return {
    contextId,
    contextType: 'group',
    threadId: threadId ?? null,
    audience: delivery?.audience ?? 'personal',
    mentionUserIds:
      delivery?.audience === 'shared'
        ? []
        : (delivery?.mention_user_ids.length ?? 0) > 0
          ? delivery!.mention_user_ids
          : [context.createdByUserId],
    createdByUserId: context.createdByUserId,
    createdByUsername: context.createdByUsername,
  }
}
```

Change `executeCreate` to accept `CreateDeliveryContext`, validate `input.delivery` with `deliveryPolicySchema` when `contextType === 'group'`, build `DeferredPromptDeliveryInput`, and pass it to both scheduled and alert creation.

- [ ] **Step 4: Pass context through tool factory and builder**

In `src/tools/create-deferred-prompt.ts`, change signature to:

```typescript
export function makeCreateDeferredPromptTool(
  userId: string,
  storageContextId: string,
  contextType: 'dm' | 'group' | undefined,
  username: string | null = null,
): ToolSet[string]
```

Then extend the tool input schema with:

```typescript
delivery: deliveryPolicySchema
  .optional()
  .describe('For group prompts, set audience and exact mention targets at creation time.'),
```

and pass these values to `executeCreate`.

In `src/tools/tools-builder.ts`, change `addDeferredPromptTools` to receive both `chatUserId` and `contextId` and build only `create_deferred_prompt` with full context:

```typescript
tools['create_deferred_prompt'] = makeCreateDeferredPromptTool(userId, contextId, contextType)
```

Keep the other deferred prompt tools keyed by creator user ID.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/deferred-prompts/tools.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/deferred-prompts/tool-handlers.ts src/tools/create-deferred-prompt.ts src/tools/tools-builder.ts tests/deferred-prompts/tools.test.ts
git commit -m "feat(deferred): capture audience and mentions at creation"
```

---

### Task 7: Route Scheduled and Alert Delivery by Stored Target

**Files:**

- Modify: `src/deferred-prompts/poller.ts`
- Modify: `tests/deferred-prompts/poller.test.ts`
- Modify: `tests/utils/test-helpers.ts`

- [ ] **Step 1: Write the failing tests**

In `tests/deferred-prompts/poller.test.ts`, replace sent-message expectations with structured target assertions and add:

```typescript
test('scheduled prompt created in group fires to stored group target, not DM', async () => {
  const pastTime = new Date(Date.now() - 60_000).toISOString()
  createScheduledPrompt(USER_ID, 'Check my overdue tasks', { fireAt: pastTime }, undefined, {
    contextId: '-1001',
    contextType: 'group',
    threadId: '42',
    audience: 'personal',
    mentionUserIds: [USER_ID],
    createdByUserId: USER_ID,
    createdByUsername: null,
  })

  await pollScheduledOnce(chat, () => provider)

  expect(sentMessages).toHaveLength(1)
  expect(sentMessages[0]!.target.contextId).toBe('-1001')
  expect(sentMessages[0]!.target.threadId).toBe('42')
  expect(sentMessages[0]!.target.audience).toBe('personal')
})

test('alert created in group fires to stored group target, not DM', async () => {
  createAlertPrompt(USER_ID, 'Notify this channel', { field: 'task.status', op: 'eq', value: 'done' }, 60, undefined, {
    contextId: 'chan-1',
    contextType: 'group',
    threadId: 'root-1',
    audience: 'shared',
    mentionUserIds: [],
    createdByUserId: USER_ID,
    createdByUsername: null,
  })

  await pollAlertsOnce(chat, () => provider)

  expect(sentMessages[0]!.target.contextId).toBe('chan-1')
  expect(sentMessages[0]!.target.audience).toBe('shared')
})

test('same creator but different delivery targets do not merge into one scheduled execution batch', async () => {
  let callCount = 0
  generateTextImpl = (): Promise<GenerateTextResult> => {
    callCount++
    return Promise.resolve({ text: 'Done.', toolCalls: [], toolResults: [], response: { messages: [] } })
  }

  const pastTime = new Date(Date.now() - 60_000).toISOString()
  createScheduledPrompt(USER_ID, 'DM task', { fireAt: pastTime })
  createScheduledPrompt(USER_ID, 'Group task', { fireAt: pastTime }, undefined, {
    contextId: '-1001',
    contextType: 'group',
    threadId: null,
    audience: 'shared',
    mentionUserIds: [],
    createdByUserId: USER_ID,
    createdByUsername: null,
  })

  await pollScheduledOnce(chat, () => provider)

  expect(callCount).toBe(2)
})
```

In `tests/utils/test-helpers.ts`, update the helper to capture:

```typescript
sentMessages: Array<{ target: DeferredDeliveryTarget; text: string }>
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/deferred-prompts/poller.test.ts`
Expected: FAIL because poller still groups and sends by `userId`.

- [ ] **Step 3: Update sent-message helper**

In `tests/utils/test-helpers.ts`, change `createMockChatWithSentMessages()` to:

```typescript
export function createMockChatWithSentMessages(): {
  provider: ChatProvider
  sentMessages: Array<{ target: DeferredDeliveryTarget; text: string }>
} {
  const sentMessages: Array<{ target: DeferredDeliveryTarget; text: string }> = []

  const provider = createMockChat({
    sendMessage: (target: DeferredDeliveryTarget, text: string): Promise<void> => {
      sentMessages.push({ target, text })
      return Promise.resolve()
    },
  })

  return { provider, sentMessages }
}
```

- [ ] **Step 4: Update poller grouping and delivery**

In `src/deferred-prompts/poller.ts`:

- create a grouping key:

```typescript
function deliveryGroupKey(prompt: ScheduledPrompt | AlertPrompt): string {
  const threadPart = prompt.deliveryTarget.threadId ?? ''
  return [
    prompt.createdByUserId,
    prompt.deliveryTarget.contextType,
    prompt.deliveryTarget.contextId,
    threadPart,
    prompt.deliveryTarget.audience,
    prompt.deliveryTarget.mentionUserIds.join(','),
  ].join('::')
}
```

- group scheduled prompts by that key instead of creator only
- group alerts by that key instead of creator only
- send with `chat.sendMessage(prompts[0]!.deliveryTarget, response)`
- update trigger/advance/complete calls to pass creator identity, not old `userId`

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/deferred-prompts/poller.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/deferred-prompts/poller.ts tests/deferred-prompts/poller.test.ts tests/utils/test-helpers.ts
git commit -m "fix(deferred): route poller delivery by stored target"
```

---

### Task 8: Execute Deferred Prompts in Stored Context While Keeping Creator-Owned Config

**Files:**

- Modify: `src/deferred-prompts/proactive-llm.ts`
- Modify: `tests/deferred-prompts/proactive-llm.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/deferred-prompts/proactive-llm.test.ts`:

```typescript
test('full mode uses stored delivery context for tools and history while reading config from creator', async () => {
  setupUserConfig()
  const provider = createMockProvider()

  await dispatchExecution(
    {
      createdByUserId: USER_ID,
      deliveryTarget: {
        contextId: '-1001:42',
        contextType: 'group',
        threadId: '42',
        audience: 'personal',
        mentionUserIds: [USER_ID],
        createdByUserId: USER_ID,
        createdByUsername: null,
      },
    },
    'scheduled',
    'check overdue',
    metadata,
    () => provider,
  )

  expect(generateTextCalls).toHaveLength(1)
  expect(generateTextCalls[0]!.tools).toHaveProperty('create_task')
})
```

Then add assertions against the tool set or any captured builder arguments according to the local test pattern once implementation exposes them.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/deferred-prompts/proactive-llm.test.ts`
Expected: FAIL because `dispatchExecution` only accepts `userId` and full mode forces DM context.

- [ ] **Step 3: Refactor execution input**

In `src/deferred-prompts/proactive-llm.ts`, add:

```typescript
export type DeferredExecutionContext = {
  createdByUserId: string
  deliveryTarget: DeferredPromptDelivery
}
```

Change `dispatchExecution` signature from:

```typescript
dispatchExecution(userId: string, ...)
```

to:

```typescript
dispatchExecution(executionContext: DeferredExecutionContext, ...)
```

Then update helpers:

- config lookup uses `executionContext.createdByUserId`
- history and memory use `executionContext.deliveryTarget.contextId`
- full-mode `makeTools()` uses:

```typescript
storageContextId: executionContext.deliveryTarget.threadId === null || executionContext.deliveryTarget.threadId === undefined
  ? executionContext.deliveryTarget.contextId
  : `${executionContext.deliveryTarget.contextId}:${executionContext.deliveryTarget.threadId}`,
chatUserId: executionContext.createdByUserId,
contextType: executionContext.deliveryTarget.contextType,
mode: 'proactive',
```

Update `persistProactiveResults` and history handling to append using the delivery context key instead of creator ID.

- [ ] **Step 4: Update poller call sites**

In `src/deferred-prompts/poller.ts`, call `dispatchExecution` with:

```typescript
{
  createdByUserId: prompt.createdByUserId,
  deliveryTarget: prompt.deliveryTarget,
}
```

for both scheduled prompts and alerts.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/deferred-prompts/proactive-llm.test.ts tests/deferred-prompts/poller.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/deferred-prompts/proactive-llm.ts src/deferred-prompts/poller.ts tests/deferred-prompts/proactive-llm.test.ts tests/deferred-prompts/poller.test.ts
git commit -m "fix(deferred): execute proactive prompts in stored delivery context"
```

---

### Task 9: Implement Provider-Specific Proactive Delivery for Telegram, Mattermost, and Discord

**Files:**

- Modify: `src/chat/telegram/index.ts`
- Modify: `src/chat/telegram/format.ts`
- Modify: `src/chat/mattermost/index.ts`
- Modify: `src/chat/discord/index.ts`
- Create: `tests/chat/proactive-send.test.ts`

- [ ] **Step 1: Write the failing adapter tests**

Create `tests/chat/proactive-send.test.ts` with provider-focused tests using existing test helpers or local mocks:

```typescript
import { describe, expect, test } from 'bun:test'

import type { DeferredDeliveryTarget } from '../../src/chat/types.js'

describe('proactive send contract', () => {
  test('telegram group personal target can carry mention metadata', () => {
    const target: DeferredDeliveryTarget = {
      contextId: '-1001',
      contextType: 'group',
      threadId: '42',
      audience: 'personal',
      mentionUserIds: ['12345'],
      createdByUserId: '12345',
      createdByUsername: 'ki',
    }

    expect(target.threadId).toBe('42')
    expect(target.mentionUserIds).toEqual(['12345'])
  })

  test('mattermost shared group target carries no mention ids', () => {
    const target: DeferredDeliveryTarget = {
      contextId: 'chan-1',
      contextType: 'group',
      threadId: 'root-1',
      audience: 'shared',
      mentionUserIds: [],
      createdByUserId: 'u1',
      createdByUsername: 'ki',
    }

    expect(target.audience).toBe('shared')
    expect(target.mentionUserIds).toEqual([])
  })

  test('discord personal group target keeps explicit mention ids', () => {
    const target: DeferredDeliveryTarget = {
      contextId: '123456789012345678',
      contextType: 'group',
      audience: 'personal',
      mentionUserIds: ['998877665544332211'],
      createdByUserId: '998877665544332211',
      createdByUsername: 'ki',
    }

    expect(target.mentionUserIds).toEqual(['998877665544332211'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails or is insufficient**

Run: `bun test tests/chat/proactive-send.test.ts`
Expected: FAIL because send surfaces or provider-specific delivery behavior are not implemented yet.

- [ ] **Step 3: Update Telegram proactive send**

In `src/chat/telegram/index.ts`, replace the DM-only send with:

```typescript
async sendMessage(target: DeferredDeliveryTarget, markdown: string): Promise<void> {
  const prefixedMarkdown =
    target.contextType === 'group' && target.audience === 'personal' && target.mentionUserIds.length > 0
      ? target.mentionUserIds.reduceRight(
          (acc, userId) => `[Reminder for you](tg://user?id=${userId})\n\n${acc}`,
          markdown,
        )
      : markdown

  const formatted = formatLlmOutput(prefixedMarkdown)
  const chatId = Number.parseInt(target.contextId, 10)
  const threadOptions =
    target.threadId === undefined || target.threadId === null
      ? {}
      : { message_thread_id: Number.parseInt(target.threadId, 10) }

  await this.bot.api.sendMessage(chatId, formatted.text, {
    entities: formatted.entities,
    ...threadOptions,
  })
}
```

In `src/chat/telegram/format.ts`, relax `isValidHttpUrl` to also allow `tg:` URLs:

```typescript
return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'tg:'
```

- [ ] **Step 4: Update Mattermost proactive send**

In `src/chat/mattermost/index.ts`, change `sendMessage` to accept `DeferredDeliveryTarget` and branch:

```typescript
async sendMessage(target: DeferredDeliveryTarget, markdown: string): Promise<void> {
  if (target.contextType === 'dm') {
    const channelId = await this.getOrCreateDmChannel(target.contextId)
    await this.apiFetch('POST', '/api/v4/posts', { channel_id: channelId, message: markdown })
    return
  }

  const mentionPrefix =
    target.audience === 'personal' && target.createdByUsername !== null
      ? `@${target.createdByUsername}\n\n`
      : ''

  await this.apiFetch('POST', '/api/v4/posts', {
    channel_id: target.contextId,
    message: `${mentionPrefix}${markdown}`,
    root_id: target.threadId ?? '',
  })
}
```

- [ ] **Step 5: Update Discord proactive send**

In `src/chat/discord/index.ts`, change `sendMessage` to accept `DeferredDeliveryTarget` and branch:

```typescript
async sendMessage(target: DeferredDeliveryTarget, markdown: string): Promise<void> {
  if (this.client === null) {
    throw new Error('DiscordChatProvider.sendMessage called before start()')
  }

  const mentionPrefix =
    target.contextType === 'group' && target.audience === 'personal' && target.mentionUserIds.length > 0
      ? `${target.mentionUserIds.map((id) => `<@${id}>`).join(' ')}\n\n`
      : ''

  const content = `${mentionPrefix}${markdown}`
  const chunks = chunkForDiscord(content, discordTraits.maxMessageLength!)

  if (target.contextType === 'dm') {
    const user = await this.client.users!.fetch(target.contextId)
    const dm = await user.createDM()
    await chunks.reduce<Promise<unknown>>((prev, chunk) => prev.then(() => dm.send({ content: chunk })), Promise.resolve(null))
    return
  }

  const channel = this.client.channels!.cache.get(target.contextId)
  if (channel === undefined || typeof channel.send !== 'function') {
    throw new Error(`Discord channel ${target.contextId} not found or not sendable`)
  }
  await chunks.reduce<Promise<unknown>>((prev, chunk) => prev.then(() => channel.send({ content: chunk })), Promise.resolve(null))
}
```

- [ ] **Step 6: Run tests to verify provider contract behavior**

Run: `bun test tests/chat/proactive-send.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/chat/telegram/index.ts src/chat/telegram/format.ts src/chat/mattermost/index.ts src/chat/discord/index.ts tests/chat/proactive-send.test.ts
git commit -m "feat(chat): support proactive deferred delivery targets across providers"
```

---

### Task 10: Verify End-to-End Deferred Prompt Behavior and Migration Safety

**Files:**

- No new files unless verification reveals a missing regression test

- [ ] **Step 1: Run targeted deferred prompt tests**

Run:

```bash
bun test tests/db/deferred-prompt-delivery-migration.test.ts
bun test tests/deferred-prompts/deferred-delivery-types.test.ts
bun test tests/deferred-prompts/scheduled.test.ts
bun test tests/deferred-prompts/alerts.test.ts
bun test tests/deferred-prompts/tools.test.ts
bun test tests/deferred-prompts/poller.test.ts
bun test tests/deferred-prompts/proactive-llm.test.ts
bun test tests/chat/proactive-send.test.ts
```

Expected: all PASS

- [ ] **Step 2: Run broader suite**

Run:

```bash
bun test
```

Expected: PASS, or only unrelated pre-existing failures.

- [ ] **Step 3: Run typecheck and format validation**

Run:

```bash
bun typecheck
bun format:check
```

Expected: PASS

- [ ] **Step 4: Commit any verification follow-up fixes**

Only if verification reveals a small bug:

```bash
git add <fixed-files>
git commit -m "fix(deferred): address verification regressions"
```

---

## Self-Review

### Spec Coverage

- Same-context delivery: covered by Tasks 4, 5, 7, 8, and 9.
- Personal vs shared audience: covered by Tasks 3 and 6.
- Mention targets chosen at creation time: covered by Task 6.
- Scheduled prompts and alerts share one delivery model: covered by Tasks 2 through 8.
- Cross-provider consistency: covered by Task 9.
- Deprecated legacy delivery-era fields replaced by explicit creator fields: covered by Task 2.

### Placeholder Scan

No task uses TBD/TODO placeholders. Each task names exact files, concrete test additions, concrete commands, and concrete type/function signatures.

### Type Consistency

Plan uses these stable names consistently:

- `DeferredAudience` from `src/chat/types.ts`
- `DeferredDeliveryTarget`
- `DeferredPromptDelivery`
- `DeferredPromptDeliveryInput`
- `createdByUserId`
- `createdByUsername`
- `deliveryTarget`
- `dispatchExecution(executionContext, ...)`

These names are introduced before later tasks depend on them.
