// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { taskInstances } from '../../src/db/schema.js'
import { handleAdminSystem } from '../../src/debug/admin-system.js'
import { insertPlatformInstance } from '../../src/instances/platform-store.js'
import { insertTaskInstance } from '../../src/instances/task-store.js'
import { setupTestDb } from '../utils/test-helpers.js'

const readJson = async (res: Response): Promise<object> => {
  const parsed: unknown = JSON.parse(await res.text())
  assert.ok(typeof parsed === 'object' && parsed !== null, 'expected JSON object')
  return parsed
}

const pick = (obj: object, key: string): unknown => Reflect.get(obj, key)

describe('handleAdminSystem', () => {
  const saved = {
    CHAT_PROVIDER: process.env['CHAT_PROVIDER'],
    TASK_PROVIDER: process.env['TASK_PROVIDER'],
    DEBUG_SERVER: process.env['DEBUG_SERVER'],
    ADMIN_USER_ID: process.env['ADMIN_USER_ID'],
  }

  beforeEach(async () => {
    await setupTestDb()
    process.env['CHAT_PROVIDER'] = saved['CHAT_PROVIDER']
    process.env['TASK_PROVIDER'] = saved['TASK_PROVIDER']
    process.env['DEBUG_SERVER'] = saved['DEBUG_SERVER']
    process.env['ADMIN_USER_ID'] = saved['ADMIN_USER_ID']
  })

  afterEach(() => {
    process.env['CHAT_PROVIDER'] = saved['CHAT_PROVIDER']
    process.env['TASK_PROVIDER'] = saved['TASK_PROVIDER']
    process.env['DEBUG_SERVER'] = saved['DEBUG_SERVER']
    process.env['ADMIN_USER_ID'] = saved['ADMIN_USER_ID']
  })

  test('returns 200 with JSON content type', () => {
    process.env['CHAT_PROVIDER'] = 'telegram'
    process.env['TASK_PROVIDER'] = 'kaneo'
    process.env['ADMIN_USER_ID'] = 'admin-1'
    process.env['DEBUG_SERVER'] = 'true'

    const res = handleAdminSystem()
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/json')
  })

  test('returns providers from instance tables when bootstrap env vars are unset', async () => {
    delete process.env['CHAT_PROVIDER']
    delete process.env['TASK_PROVIDER']
    insertPlatformInstance({ id: 'discord-main', type: 'discord', config: { token: 'secret' }, status: 'active' })
    insertTaskInstance({
      id: 'youtrack-main',
      type: 'youtrack',
      config: { baseUrl: 'https://youtrack.invalid' },
      status: 'active',
    })

    const res = handleAdminSystem()
    const body = await readJson(res)

    expect(pick(body, 'chatProvider')).toBe('discord')
    expect(pick(body, 'taskProvider')).toBe('youtrack')
  })

  test('ignores unsupported bootstrap env provider values', async () => {
    process.env['CHAT_PROVIDER'] = 'signal'
    process.env['TASK_PROVIDER'] = 'jira'

    const res = handleAdminSystem()
    const body = await readJson(res)
    expect(pick(body, 'chatProvider')).toBe('unknown')
    expect(pick(body, 'taskProvider')).toBe('unknown')
  })

  test('reports unknown task provider when no task instances exist', async () => {
    delete process.env['TASK_PROVIDER']

    const res = handleAdminSystem()
    const body = await readJson(res)

    expect(res.status).toBe(200)
    expect(pick(body, 'taskProvider')).toBe('unknown')
  })

  test('ignores stopped platform instances when reporting chat provider', async () => {
    insertPlatformInstance({ id: 'telegram-main', type: 'telegram', config: { token: 'secret' }, status: 'active' })
    insertPlatformInstance({ id: 'discord-main', type: 'discord', config: { token: 'secret' }, status: 'stopped' })

    const res = handleAdminSystem()
    const body = await readJson(res)

    expect(pick(body, 'chatProvider')).toBe('telegram')
  })

  test('ignores stopped task instances when reporting task provider', async () => {
    insertTaskInstance({
      id: 'kaneo-main',
      type: 'kaneo',
      config: { baseUrl: 'https://kaneo.invalid' },
      status: 'active',
    })
    insertTaskInstance({
      id: 'youtrack-main',
      type: 'youtrack',
      config: { baseUrl: 'https://youtrack.invalid' },
      status: 'stopped',
    })

    const res = handleAdminSystem()
    const body = await readJson(res)

    expect(pick(body, 'taskProvider')).toBe('kaneo')
  })

  test('reports unknown task provider when active providers include a custom type', async () => {
    insertTaskInstance({
      id: 'kaneo-main',
      type: 'kaneo',
      config: { baseUrl: 'https://kaneo.invalid' },
      status: 'active',
    })
    insertTaskInstance({
      id: 'linear-main',
      type: 'linear',
      config: { baseUrl: 'https://linear.invalid' },
      status: 'active',
    })

    const res = handleAdminSystem()
    const body = await readJson(res)

    expect(pick(body, 'taskProvider')).toBe('unknown')
  })

  test('adminUserSet is true when ADMIN_USER_ID is set', async () => {
    process.env['ADMIN_USER_ID'] = 'u1'

    const res = handleAdminSystem()
    const body = await readJson(res)
    expect(pick(body, 'adminUserSet')).toBe(true)
  })

  test('adminUserSet is false when ADMIN_USER_ID is unset', async () => {
    process.env['ADMIN_USER_ID'] = undefined

    const res = handleAdminSystem()
    const body = await readJson(res)
    expect(pick(body, 'adminUserSet')).toBe(false)
  })

  test('degrades gracefully when a task_instances row is undecryptable', async () => {
    insertTaskInstance({
      id: 'kaneo-main',
      type: 'kaneo',
      config: { baseUrl: 'https://kaneo.invalid' },
      status: 'active',
    })
    getDrizzleDb()
      .insert(taskInstances)
      .values({ id: 'bad-task', type: 'kaneo', config: 'not-base64', status: 'active' })
      .run()

    const res = handleAdminSystem()
    const body = await readJson(res)

    expect(res.status).toBe(200)
    expect(pick(body, 'taskProvider')).toBe('kaneo')
  })
})
