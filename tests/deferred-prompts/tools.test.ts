import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import type { ToolSet } from 'ai'

import { setConfig } from '../../src/config.js'
import { getAlertPrompt } from '../../src/deferred-prompts/alerts.js'
import { getScheduledPrompt } from '../../src/deferred-prompts/scheduled.js'
import {
  makeCancelDeferredPromptTool,
  makeCreateDeferredPromptTool,
  makeGetDeferredPromptTool,
  makeListDeferredPromptsTool,
  makeUpdateDeferredPromptTool,
} from '../../src/deferred-prompts/tools.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const USER_ID = 'user-1'
const toolCtx = { toolCallId: 'tc1', messages: [] as never[], abortSignal: new AbortController().signal }

function getTools(): ToolSet {
  return {
    create_deferred_prompt: makeCreateDeferredPromptTool(USER_ID, USER_ID, 'dm'),
    list_deferred_prompts: makeListDeferredPromptsTool(USER_ID),
    get_deferred_prompt: makeGetDeferredPromptTool(USER_ID),
    update_deferred_prompt: makeUpdateDeferredPromptTool(USER_ID),
    cancel_deferred_prompt: makeCancelDeferredPromptTool(USER_ID),
  }
}

/** Build a fire_at object for 1 hour in the future (UTC, since tests set timezone=UTC). */
function futureFireAt(): { date: string; time: string } {
  const future = new Date(Date.now() + 3_600_000)
  const date = future.toISOString().slice(0, 10)
  const time = future.toISOString().slice(11, 16)
  return { date, time }
}

function extractId(result: unknown): string {
  if (typeof result !== 'object' || result === null || !('id' in result)) {
    throw new Error('Expected result with id property')
  }
  const id: unknown = Reflect.get(result, 'id')
  if (typeof id !== 'string') throw new Error('Expected id to be string')
  return id
}

function extractPrompts(result: unknown): unknown[] {
  if (typeof result !== 'object' || result === null || !('prompts' in result)) {
    throw new Error('Expected result with prompts property')
  }
  const prompts: unknown = Reflect.get(result, 'prompts')
  if (!Array.isArray(prompts)) throw new Error('Expected prompts to be array')
  return prompts
}

function extractFireAt(result: unknown): unknown {
  if (typeof result !== 'object' || result === null || !('fireAt' in result)) {
    throw new Error('Expected result with fireAt property')
  }
  return (result as Record<string, unknown>)['fireAt']
}

beforeEach(() => {
  mockLogger()
})

describe('makeDeferredPromptTools', () => {
  beforeEach(async () => {
    await setupTestDb()
    setConfig(USER_ID, 'timezone', 'UTC')
  })

  test('exposes all 5 tools', () => {
    const names = Object.keys(getTools())
    expect(names).toContain('create_deferred_prompt')
    expect(names).toContain('list_deferred_prompts')
    expect(names).toContain('get_deferred_prompt')
    expect(names).toContain('update_deferred_prompt')
    expect(names).toContain('cancel_deferred_prompt')
    expect(names).toHaveLength(5)
  })
})

describe('create_deferred_prompt', () => {
  beforeEach(async () => {
    await setupTestDb()
    setConfig(USER_ID, 'timezone', 'UTC')
  })

  test('creates with schedule (returns type scheduled)', async () => {
    const t = getTools()['create_deferred_prompt']!
    assert(t.execute)
    const result: unknown = await t.execute({ prompt: 'Remind me', schedule: { fire_at: futureFireAt() } }, toolCtx)
    expect(result).toHaveProperty('status', 'created')
    expect(result).toHaveProperty('type', 'scheduled')
    expect(result).toHaveProperty('id')
    expect(result).toHaveProperty('fireAt')
  })

  test('creates with rrule schedule', async () => {
    const t = getTools()['create_deferred_prompt']!
    assert(t.execute)
    const result: unknown = await t.execute(
      { prompt: 'Daily', schedule: { rrule: { freq: 'DAILY', byHour: [9], byMinute: [0], timezone: 'UTC' } } },
      toolCtx,
    )
    expect(result).toHaveProperty('status', 'created')
    expect(result).toHaveProperty('type', 'scheduled')
    expect(result).toHaveProperty('rrule', 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0')
  })

  test('creates with condition (returns type alert)', async () => {
    const t = getTools()['create_deferred_prompt']!
    assert(t.execute)
    const result: unknown = await t.execute(
      {
        prompt: 'Urgent',
        condition: { field: 'task.priority', op: 'changed_to', value: 'urgent' },
        cooldown_minutes: 30,
      },
      toolCtx,
    )
    expect(result).toHaveProperty('status', 'created')
    expect(result).toHaveProperty('type', 'alert')
    expect(result).toHaveProperty('cooldownMinutes', 30)
  })

  test('rejects both schedule and condition', async () => {
    const t = getTools()['create_deferred_prompt']!
    assert(t.execute)
    const result: unknown = await t.execute(
      {
        prompt: 'X',
        schedule: { fire_at: futureFireAt() },
        condition: { field: 'task.status', op: 'eq', value: 'done' },
      },
      toolCtx,
    )
    expect(result).toHaveProperty('error')
  })

  test('rejects neither schedule nor condition', async () => {
    const t = getTools()['create_deferred_prompt']!
    assert(t.execute)
    const result: unknown = await t.execute({ prompt: 'X' }, toolCtx)
    expect(result).toHaveProperty('error')
  })

  test('rejects past fire_at', async () => {
    const t = getTools()['create_deferred_prompt']!
    assert(t.execute)
    const result: unknown = await t.execute(
      { prompt: 'X', schedule: { fire_at: { date: '2020-01-01', time: '00:00' } } },
      toolCtx,
    )
    expect(result).toHaveProperty('error')
  })

  test('creates with weekly rrule schedule and stores correct rrule string', async () => {
    const t = getTools()['create_deferred_prompt']!
    assert(t.execute)
    const result: unknown = await t.execute(
      {
        prompt: 'Weekly',
        schedule: { rrule: { freq: 'WEEKLY', byDay: ['MO'], byHour: [9], byMinute: [0], timezone: 'UTC' } },
      },
      toolCtx,
    )
    expect(result).toHaveProperty('status', 'created')
    expect(result).toHaveProperty('type', 'scheduled')
    expect(result).toHaveProperty('rrule', 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0')
  })

  test('rejects empty schedule object', async () => {
    const t = getTools()['create_deferred_prompt']!
    assert(t.execute)
    const result: unknown = await t.execute({ prompt: 'X', schedule: {} }, toolCtx)
    expect(result).toHaveProperty('error')
  })

  test('converts structured fire_at from local time to UTC', async () => {
    setConfig(USER_ID, 'timezone', 'Asia/Karachi')
    const t = getTools()['create_deferred_prompt']!
    assert(t.execute)

    // Use a date far in the future to avoid "must be future" check
    const result: unknown = await t.execute(
      { prompt: 'Remind me', schedule: { fire_at: { date: '2027-03-25', time: '17:00' } } },
      toolCtx,
    )

    expect(result).toHaveProperty('status', 'created')
    expect(result).toHaveProperty('type', 'scheduled')
    // The stored fireAt should be 12:00 UTC (17:00 - 5h offset)
    // But returned fireAt is converted back to local (17:00)
    expect(result).toHaveProperty('fireAt')
    expect(String(extractFireAt(result))).toContain('17:00:00')
  })
})

describe('list_deferred_prompts', () => {
  beforeEach(async () => {
    await setupTestDb()
    setConfig(USER_ID, 'timezone', 'UTC')
  })

  test('returns both types', async () => {
    const tools = getTools()
    const create = tools['create_deferred_prompt']!
    const list = tools['list_deferred_prompts']!
    assert(create.execute)
    assert(list.execute)
    await create.execute({ prompt: 'S', schedule: { fire_at: futureFireAt() } }, toolCtx)
    await create.execute({ prompt: 'A', condition: { field: 'task.status', op: 'eq', value: 'done' } }, toolCtx)
    expect(extractPrompts(await list.execute({}, toolCtx))).toHaveLength(2)
  })

  test('filters by type', async () => {
    const tools = getTools()
    const create = tools['create_deferred_prompt']!
    const list = tools['list_deferred_prompts']!
    assert(create.execute)
    assert(list.execute)
    await create.execute({ prompt: 'S', schedule: { fire_at: futureFireAt() } }, toolCtx)
    await create.execute({ prompt: 'A', condition: { field: 'task.status', op: 'eq', value: 'done' } }, toolCtx)
    expect(extractPrompts(await list.execute({ type: 'scheduled' }, toolCtx))).toHaveLength(1)
    expect(extractPrompts(await list.execute({ type: 'alert' }, toolCtx))).toHaveLength(1)
  })
})

describe('get_deferred_prompt', () => {
  beforeEach(async () => {
    await setupTestDb()
    setConfig(USER_ID, 'timezone', 'UTC')
  })

  test('retrieves a prompt by ID', async () => {
    const tools = getTools()
    const create = tools['create_deferred_prompt']!
    const get = tools['get_deferred_prompt']!
    assert(create.execute)
    assert(get.execute)
    const created: unknown = await create.execute(
      { prompt: 'Fetch me', schedule: { fire_at: futureFireAt() } },
      toolCtx,
    )
    const result: unknown = await get.execute({ id: extractId(created) }, toolCtx)
    expect(result).toHaveProperty('type', 'scheduled')
    expect(result).toHaveProperty('prompt', 'Fetch me')
  })

  test('returns error for non-existent ID', async () => {
    const get = getTools()['get_deferred_prompt']!
    assert(get.execute)
    expect(await get.execute({ id: 'non-existent' }, toolCtx)).toHaveProperty('error')
  })
})

describe('update_deferred_prompt', () => {
  beforeEach(async () => {
    await setupTestDb()
    setConfig(USER_ID, 'timezone', 'UTC')
  })

  test('changes prompt text', async () => {
    const tools = getTools()
    const create = tools['create_deferred_prompt']!
    const update = tools['update_deferred_prompt']!
    assert(create.execute)
    assert(update.execute)
    const created: unknown = await create.execute(
      { prompt: 'Original', schedule: { fire_at: futureFireAt() } },
      toolCtx,
    )
    const result: unknown = await update.execute({ id: extractId(created), prompt: 'Updated text' }, toolCtx)
    expect(result).toHaveProperty('status', 'updated')
    expect(result).toHaveProperty('prompt', 'Updated text')
  })

  test('changes alert prompt text', async () => {
    const tools = getTools()
    const create = tools['create_deferred_prompt']!
    const update = tools['update_deferred_prompt']!
    assert(create.execute)
    assert(update.execute)
    const created: unknown = await create.execute(
      { prompt: 'Original', condition: { field: 'task.status', op: 'eq', value: 'done' } },
      toolCtx,
    )
    const result: unknown = await update.execute({ id: extractId(created), prompt: 'Updated alert' }, toolCtx)
    expect(result).toHaveProperty('status', 'updated')
    expect(result).toHaveProperty('prompt', 'Updated alert')
  })

  test('rejects condition on scheduled prompt', async () => {
    const tools = getTools()
    const create = tools['create_deferred_prompt']!
    const update = tools['update_deferred_prompt']!
    assert(create.execute)
    assert(update.execute)
    const created: unknown = await create.execute({ prompt: 'S', schedule: { fire_at: futureFireAt() } }, toolCtx)
    const result: unknown = await update.execute(
      { id: extractId(created), condition: { field: 'task.status', op: 'eq', value: 'done' } },
      toolCtx,
    )
    expect(result).toHaveProperty('error')
  })

  test('rejects schedule on alert prompt', async () => {
    const tools = getTools()
    const create = tools['create_deferred_prompt']!
    const update = tools['update_deferred_prompt']!
    assert(create.execute)
    assert(update.execute)
    const created: unknown = await create.execute(
      { prompt: 'A', condition: { field: 'task.status', op: 'eq', value: 'done' } },
      toolCtx,
    )
    const result: unknown = await update.execute(
      { id: extractId(created), schedule: { fire_at: futureFireAt() } },
      toolCtx,
    )
    expect(result).toHaveProperty('error')
  })

  test('returns error for non-existent ID', async () => {
    const update = getTools()['update_deferred_prompt']!
    assert(update.execute)
    expect(await update.execute({ id: 'missing', prompt: 'X' }, toolCtx)).toHaveProperty('error')
  })

  test('rejects past fire_at on update', async () => {
    const tools = getTools()
    const create = tools['create_deferred_prompt']!
    const update = tools['update_deferred_prompt']!
    assert(create.execute)
    assert(update.execute)
    const created: unknown = await create.execute({ prompt: 'S', schedule: { fire_at: futureFireAt() } }, toolCtx)
    const result: unknown = await update.execute(
      { id: extractId(created), schedule: { fire_at: { date: '2020-01-01', time: '00:00' } } },
      toolCtx,
    )
    expect(result).toHaveProperty('error')
  })
})

describe('cancel_deferred_prompt', () => {
  beforeEach(async () => {
    await setupTestDb()
    setConfig(USER_ID, 'timezone', 'UTC')
  })

  test('cancels a prompt', async () => {
    const tools = getTools()
    const create = tools['create_deferred_prompt']!
    const cancel = tools['cancel_deferred_prompt']!
    const get = tools['get_deferred_prompt']!
    assert(create.execute)
    assert(cancel.execute)
    assert(get.execute)
    const created: unknown = await create.execute(
      { prompt: 'Cancel me', schedule: { fire_at: futureFireAt() } },
      toolCtx,
    )
    const id = extractId(created)
    const result: unknown = await cancel.execute({ id }, toolCtx)
    expect(result).toHaveProperty('status', 'cancelled')
    expect(result).toHaveProperty('id', id)
    expect(await get.execute({ id }, toolCtx)).toHaveProperty('status', 'cancelled')
  })

  test('returns error for non-existent ID', async () => {
    const cancel = getTools()['cancel_deferred_prompt']!
    assert(cancel.execute)
    expect(await cancel.execute({ id: 'non-existent' }, toolCtx)).toHaveProperty('error')
  })
})

describe('execution metadata', () => {
  beforeEach(async () => {
    await setupTestDb()
    setConfig(USER_ID, 'timezone', 'UTC')
  })

  test('creates with execution metadata', async () => {
    const t = getTools()['create_deferred_prompt']!
    assert(t.execute)
    const result: unknown = await t.execute(
      {
        prompt: 'Drink water',
        schedule: { fire_at: futureFireAt() },
        execution: { mode: 'lightweight', delivery_brief: 'Simple hydration reminder' },
      },
      toolCtx,
    )
    expect(result).toHaveProperty('status', 'created')
  })

  test('creates without execution metadata (backward compat)', async () => {
    const t = getTools()['create_deferred_prompt']!
    assert(t.execute)
    const result: unknown = await t.execute({ prompt: 'Remind me', schedule: { fire_at: futureFireAt() } }, toolCtx)
    expect(result).toHaveProperty('status', 'created')
  })

  test('persists execution metadata in scheduled prompt', async () => {
    const tools = getTools()
    const create = tools['create_deferred_prompt']!
    const get = tools['get_deferred_prompt']!
    assert(create.execute)
    assert(get.execute)

    const created: unknown = await create.execute(
      {
        prompt: 'Check tasks',
        schedule: { fire_at: futureFireAt() },
        execution: { mode: 'context', delivery_brief: 'Remind about standup', context_snapshot: 'Sprint discussion' },
      },
      toolCtx,
    )
    const id = extractId(created)
    const detail: unknown = await get.execute({ id }, toolCtx)

    expect(detail).toHaveProperty('executionMetadata.mode', 'context')
    expect(detail).toHaveProperty('executionMetadata.delivery_brief', 'Remind about standup')
    expect(detail).toHaveProperty('executionMetadata.context_snapshot', 'Sprint discussion')
  })

  test('persists execution metadata in alert prompt', async () => {
    const tools = getTools()
    const create = tools['create_deferred_prompt']!
    const get = tools['get_deferred_prompt']!
    assert(create.execute)
    assert(get.execute)

    const created: unknown = await create.execute(
      {
        prompt: 'Check overdue',
        condition: { field: 'task.dueDate', op: 'overdue' },
        execution: { mode: 'full', delivery_brief: 'Check overdue tasks' },
      },
      toolCtx,
    )
    const id = extractId(created)
    const detail: unknown = await get.execute({ id }, toolCtx)

    expect(detail).toHaveProperty('executionMetadata.mode', 'full')
  })

  test('defaults to full mode when no execution provided', async () => {
    const tools = getTools()
    const create = tools['create_deferred_prompt']!
    const get = tools['get_deferred_prompt']!
    assert(create.execute)
    assert(get.execute)

    const created: unknown = await create.execute({ prompt: 'No exec', schedule: { fire_at: futureFireAt() } }, toolCtx)
    const id = extractId(created)
    const detail: unknown = await get.execute({ id }, toolCtx)

    expect(detail).toHaveProperty('executionMetadata.mode', 'full')
  })

  test('updates execution metadata on scheduled prompt', async () => {
    const tools = getTools()
    const create = tools['create_deferred_prompt']!
    const update = tools['update_deferred_prompt']!
    const get = tools['get_deferred_prompt']!
    assert(create.execute)
    assert(update.execute)
    assert(get.execute)

    const created: unknown = await create.execute({ prompt: 'Test', schedule: { fire_at: futureFireAt() } }, toolCtx)
    const id = extractId(created)

    const result: unknown = await update.execute(
      { id, execution: { mode: 'lightweight', delivery_brief: 'Updated brief' } },
      toolCtx,
    )
    expect(result).toHaveProperty('status', 'updated')

    const detail: unknown = await get.execute({ id }, toolCtx)
    expect(detail).toHaveProperty('executionMetadata.mode', 'lightweight')
    expect(detail).toHaveProperty('executionMetadata.delivery_brief', 'Updated brief')
  })
})

describe('delivery classification persistence', () => {
  beforeEach(async () => {
    await setupTestDb()
    setConfig(USER_ID, 'timezone', 'UTC')
  })

  test('group scheduled prompt persists personal audience and mention target chosen at creation', async () => {
    const tool = makeCreateDeferredPromptTool(USER_ID, '-1001:42', 'group')
    assert(tool.execute)

    const result: unknown = await tool.execute(
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
    expect(created!.deliveryTarget.contextId).toBe('-1001')
    expect(created!.deliveryTarget.audience).toBe('personal')
    expect(created!.deliveryTarget.mentionUserIds).toEqual([USER_ID])
  })

  test('group alert persists shared audience and no mention targets chosen at creation', async () => {
    const tool = makeCreateDeferredPromptTool(USER_ID, 'chan-1', 'group')
    assert(tool.execute)

    const result: unknown = await tool.execute(
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

  test('group shared delivery drops stale mention targets chosen by the model', async () => {
    const tool = makeCreateDeferredPromptTool(USER_ID, 'chan-1', 'group')
    assert(tool.execute)

    const result: unknown = await tool.execute(
      {
        prompt: 'Notify this channel when a task becomes overdue',
        condition: { field: 'task.dueDate', op: 'overdue' },
        delivery: {
          audience: 'shared',
          mention_user_ids: [USER_ID, 'stale-user-id'],
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
    expect(created!.deliveryTarget.audience).toBe('shared')
    expect(created!.deliveryTarget.mentionUserIds).toEqual([])
  })
})
