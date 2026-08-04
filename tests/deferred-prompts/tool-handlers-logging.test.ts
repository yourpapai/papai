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
