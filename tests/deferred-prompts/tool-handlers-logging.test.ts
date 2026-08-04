// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// tool-handlers.ts binds `const log = logger.child(...)` at module load, so we
// install a tracked logger mock and import the module through a cachebuster
// query (mirroring tests/coding-credentials/redaction-log.test.ts) to get a
// fresh binding that resolves the mocked logger.

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert'

import { setConfig } from '../../src/config.testing.js'
import { subscribe, unsubscribe, type DebugEvent } from '../../src/debug/event-bus.js'
import { createTrackedLoggerMock, type TrackedLoggerMock } from '../utils/logger-mock.js'
import { setupTestDb } from '../utils/test-helpers.js'

type ToolHandlersModule = typeof import('../../src/deferred-prompts/tool-handlers.js')

const importHandlers = (): Promise<ToolHandlersModule> =>
  import(`../../src/deferred-prompts/tool-handlers.js?test=${crypto.randomUUID()}`)

const USER_ID = 'user-log-test'

const tracked: TrackedLoggerMock = createTrackedLoggerMock()

beforeEach(async () => {
  tracked.clearCalls()
  void mock.module('../../src/logger.js', () => ({
    getLogLevel: tracked.getLogLevel,
    logger: tracked.logger,
  }))
  await setupTestDb()
})

const infoArgs = (): unknown[][] => tracked.getCallsByLevel('info').map((c) => c.args)
const debugArgs = (): unknown[][] => tracked.getCallsByLevel('debug').map((c) => c.args)

describe('tool-handlers logging', () => {
  test('binds the child logger with the deferred:tools scope', async () => {
    await importHandlers()
    expect(tracked.logger.child).toHaveBeenCalledWith({ scope: 'deferred:tools' })
  })

  test('create scheduled logs debug entry and info with id/userId/type', async () => {
    const { executeCreate } = await importHandlers()
    setConfig(USER_ID, 'timezone', 'UTC')
    const result = executeCreate(USER_ID, {
      prompt: 'logged',
      schedule: { fire_at: { date: '2099-01-01', time: '09:00' } },
    })
    assert.ok('id' in result)
    expect(debugArgs()).toContainEqual([
      { userId: USER_ID, hasSchedule: true, hasCondition: false },
      'create_reminder/create_alert called',
    ])
    expect(infoArgs()).toContainEqual([
      { id: result.id, userId: USER_ID, type: 'scheduled' },
      'Deferred prompt created',
    ])
  })

  test('create alert logs info with id/userId/type', async () => {
    const { executeCreate } = await importHandlers()
    const result = executeCreate(USER_ID, {
      prompt: 'logged alert',
      condition: { field: 'task.status', op: 'changed_to', value: 'done' },
    })
    assert.ok('id' in result)
    expect(debugArgs()).toContainEqual([
      { userId: USER_ID, hasSchedule: false, hasCondition: true },
      'create_reminder/create_alert called',
    ])
    expect(infoArgs()).toContainEqual([{ id: result.id, userId: USER_ID, type: 'alert' }, 'Deferred prompt created'])
  })

  test('list logs debug entry and info count', async () => {
    const { executeCreate, executeList } = await importHandlers()
    setConfig(USER_ID, 'timezone', 'UTC')
    executeCreate(USER_ID, {
      prompt: 'counted',
      schedule: { fire_at: { date: '2099-01-01', time: '09:00' } },
    })
    executeList(USER_ID, {})
    expect(debugArgs()).toContainEqual([
      { userId: USER_ID, type: undefined, status: undefined },
      'list_reminders called',
    ])
    expect(infoArgs()).toContainEqual([{ userId: USER_ID, count: 1 }, 'Listed deferred prompts'])
  })

  test('get logs debug entry', async () => {
    const { executeGet } = await importHandlers()
    executeGet(USER_ID, { id: 'nope' })
    expect(debugArgs()).toContainEqual([{ userId: USER_ID, id: 'nope' }, 'get_reminder called'])
  })

  test('update logs debug entry and per-type info', async () => {
    const { executeCreate, executeList, executeUpdate } = await importHandlers()
    setConfig(USER_ID, 'timezone', 'UTC')
    executeCreate(USER_ID, {
      prompt: 'upd',
      schedule: { fire_at: { date: '2099-01-01', time: '09:00' } },
    })
    const { prompts } = executeList(USER_ID, { type: 'scheduled' })
    const id = prompts[0]!.id

    executeUpdate(USER_ID, { id, prompt: 'upd2' })
    expect(debugArgs()).toContainEqual([{ userId: USER_ID, id }, 'update_reminder called'])
    expect(infoArgs()).toContainEqual([{ id, userId: USER_ID }, 'Scheduled prompt updated via tool'])

    const alert = executeCreate(USER_ID, {
      prompt: 'upd alert',
      condition: { field: 'task.status', op: 'changed_to', value: 'done' },
    })
    assert.ok('id' in alert)
    executeUpdate(USER_ID, { id: alert.id, prompt: 'upd alert 2' })
    expect(infoArgs()).toContainEqual([{ id: alert.id, userId: USER_ID }, 'Alert prompt updated via tool'])
  })

  test('cancel logs debug entry and per-type info', async () => {
    const { executeCreate, executeList, executeCancel } = await importHandlers()
    setConfig(USER_ID, 'timezone', 'UTC')
    executeCreate(USER_ID, {
      prompt: 'cancel me',
      schedule: { fire_at: { date: '2099-01-01', time: '09:00' } },
    })
    const { prompts } = executeList(USER_ID, { type: 'scheduled' })
    const id = prompts[0]!.id

    executeCancel(USER_ID, { id })
    expect(debugArgs()).toContainEqual([{ userId: USER_ID, id }, 'cancel_reminder called'])
    expect(infoArgs()).toContainEqual([{ id, userId: USER_ID, type: 'scheduled' }, 'Deferred prompt cancelled'])

    const alert = executeCreate(USER_ID, {
      prompt: 'cancel alert',
      condition: { field: 'task.status', op: 'changed_to', value: 'done' },
    })
    assert.ok('id' in alert)
    executeCancel(USER_ID, { id: alert.id })
    expect(infoArgs()).toContainEqual([{ id: alert.id, userId: USER_ID, type: 'alert' }, 'Deferred prompt cancelled'])
  })
})

describe('tool-handlers store-null update branches', () => {
  test('updateScheduledPrompt returning null surfaces not-found', async () => {
    const scheduledActual = await import('../../src/deferred-prompts/scheduled.js')
    void mock.module('../../src/deferred-prompts/scheduled.js', () => ({
      ...scheduledActual,
      updateScheduledPrompt: (): null => null,
    }))
    const { executeCreate, executeList, executeUpdate } = await importHandlers()
    setConfig(USER_ID, 'timezone', 'UTC')
    executeCreate(USER_ID, {
      prompt: 'will vanish',
      schedule: { fire_at: { date: '2099-01-01', time: '09:00' } },
    })
    const { prompts } = executeList(USER_ID, { type: 'scheduled' })
    const id = prompts[0]!.id

    const result = executeUpdate(USER_ID, { id, prompt: 'too late' })
    expect(result).toEqual({ error: 'Reminder or alert not found.' })
  })

  test('updateAlertPrompt returning null surfaces not-found', async () => {
    const alertsActual = await import('../../src/deferred-prompts/alerts.js')
    void mock.module('../../src/deferred-prompts/alerts.js', () => ({
      ...alertsActual,
      updateAlertPrompt: (): null => null,
    }))
    const { executeCreate, executeUpdate } = await importHandlers()
    const created = executeCreate(USER_ID, {
      prompt: 'will vanish',
      condition: { field: 'task.status', op: 'changed_to', value: 'done' },
    })
    assert.ok('id' in created)

    const result = executeUpdate(USER_ID, { id: created.id, prompt: 'too late' })
    expect(result).toEqual({ error: 'Reminder or alert not found.' })
  })
})

describe('tool-handlers update payload guards', () => {
  type UpdateSpy = ReturnType<typeof mock>

  const mockScheduledUpdate = async (impl: (...args: unknown[]) => unknown): Promise<UpdateSpy> => {
    const scheduledActual = await import('../../src/deferred-prompts/scheduled.js')
    const updateSpy = mock(impl)
    void mock.module('../../src/deferred-prompts/scheduled.js', () => ({
      ...scheduledActual,
      updateScheduledPrompt: updateSpy,
    }))
    return updateSpy
  }

  const mockAlertUpdate = async (impl: (...args: unknown[]) => unknown): Promise<UpdateSpy> => {
    const alertsActual = await import('../../src/deferred-prompts/alerts.js')
    const updateSpy = mock(impl)
    void mock.module('../../src/deferred-prompts/alerts.js', () => ({
      ...alertsActual,
      updateAlertPrompt: updateSpy,
    }))
    return updateSpy
  }

  const createScheduled = (handlers: ToolHandlersModule): string => {
    setConfig(USER_ID, 'timezone', 'UTC')
    handlers.executeCreate(USER_ID, {
      prompt: 'payload probe',
      schedule: { fire_at: { date: '2099-01-01', time: '09:00' } },
    })
    const { prompts } = handlers.executeList(USER_ID, { type: 'scheduled' })
    return prompts[0]!.id
  }

  const createAlert = (handlers: ToolHandlersModule): string => {
    const created = handlers.executeCreate(USER_ID, {
      prompt: 'payload alert',
      condition: { field: 'task.status', op: 'changed_to', value: 'done' },
    })
    assert.ok('id' in created)
    return created.id
  }

  const collectEvents = (type: string): { events: DebugEvent[]; cleanup: () => void } => {
    const events: DebugEvent[] = []
    const handler = (e: DebugEvent): void => {
      if (e.type === type) events.push(e)
    }
    subscribe(handler)
    return { events, cleanup: () => unsubscribe(handler) }
  }

  test('scheduled update without prompt sends no prompt key to the store', async () => {
    const updateSpy = await mockScheduledUpdate(() => ({ id: 'stored' }))
    const handlers = await importHandlers()
    const id = createScheduled(handlers)

    handlers.executeUpdate(USER_ID, { id, execution: { delivery_brief: 'brief' } })
    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect(updateSpy.mock.calls[0]![2]).toStrictEqual({
      executionMetadata: { delivery_brief: 'brief', context_snapshot: null },
    })
  })

  test('scheduled update with invalid execution sends no executionMetadata key to the store', async () => {
    const updateSpy = await mockScheduledUpdate(() => ({ id: 'stored' }))
    const handlers = await importHandlers()
    const id = createScheduled(handlers)

    const invalidExecution = { delivery_brief: 'x', context_snapshot: 'no brief' }
    delete (invalidExecution as { delivery_brief?: string }).delivery_brief
    handlers.executeUpdate(USER_ID, { id, execution: invalidExecution })
    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect(updateSpy.mock.calls[0]![2]).toStrictEqual({})
  })

  test('alert update without prompt sends no prompt key to the store', async () => {
    const updateSpy = await mockAlertUpdate(() => ({ id: 'stored' }))
    const handlers = await importHandlers()
    const id = createAlert(handlers)

    handlers.executeUpdate(USER_ID, { id, cooldown_minutes: 15 })
    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect(updateSpy.mock.calls[0]![2]).toStrictEqual({ cooldownMinutes: 15 })
  })

  test('alert update without cooldown sends no cooldownMinutes key to the store', async () => {
    const updateSpy = await mockAlertUpdate(() => ({ id: 'stored' }))
    const handlers = await importHandlers()
    const id = createAlert(handlers)

    handlers.executeUpdate(USER_ID, { id, prompt: 'only prompt' })
    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect(updateSpy.mock.calls[0]![2]).toStrictEqual({ prompt: 'only prompt' })
  })

  test('alert update with invalid execution sends no executionMetadata key to the store', async () => {
    const updateSpy = await mockAlertUpdate(() => ({ id: 'stored' }))
    const handlers = await importHandlers()
    const id = createAlert(handlers)

    const invalidExecution = { delivery_brief: 'x', context_snapshot: 'no brief' }
    delete (invalidExecution as { delivery_brief?: string }).delivery_brief
    handlers.executeUpdate(USER_ID, { id, execution: invalidExecution })
    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect(updateSpy.mock.calls[0]![2]).toStrictEqual({})
  })

  test('updateAlertPrompt is not called when the alert id does not exist', async () => {
    const updateSpy = await mockAlertUpdate(() => null)
    const handlers = await importHandlers()

    const result = handlers.executeUpdate(USER_ID, { id: 'missing-alert', prompt: 'x' })
    expect(result).toEqual({ error: 'Reminder or alert not found.' })
    expect(updateSpy).not.toHaveBeenCalled()
  })

  test('scheduled update emits nothing when the store result carries both id and error', async () => {
    await mockScheduledUpdate(() => ({ id: 'x', error: 'conflict' }))
    const handlers = await importHandlers()
    const id = createScheduled(handlers)

    const { events, cleanup } = collectEvents('deferred:updated')
    try {
      handlers.executeUpdate(USER_ID, { id, prompt: 'x' })
      expect(events).toHaveLength(0)
    } finally {
      cleanup()
    }
  })

  test('alert update emits nothing when the store result carries both id and error', async () => {
    await mockAlertUpdate(() => ({ id: 'x', error: 'conflict' }))
    const handlers = await importHandlers()
    const id = createAlert(handlers)

    const { events, cleanup } = collectEvents('deferred:updated')
    try {
      handlers.executeUpdate(USER_ID, { id, prompt: 'x' })
      expect(events).toHaveLength(0)
    } finally {
      cleanup()
    }
  })
})
