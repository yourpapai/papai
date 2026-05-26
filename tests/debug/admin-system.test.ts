// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { handleAdminSystem } from '../../src/debug/admin-system.js'

const readJson = async (res: Response): Promise<object> => {
  const parsed: unknown = JSON.parse(await res.text())
  assert(typeof parsed === 'object' && parsed !== null, 'expected JSON object')
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

  beforeEach(() => {
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

  test('returns known providers verbatim', async () => {
    process.env['CHAT_PROVIDER'] = 'mattermost'
    process.env['TASK_PROVIDER'] = 'youtrack'
    process.env['ADMIN_USER_ID'] = 'admin-2'

    const res = handleAdminSystem()
    const body = await readJson(res)
    expect(pick(body, 'chatProvider')).toBe('mattermost')
    expect(pick(body, 'taskProvider')).toBe('youtrack')
  })

  test('maps unknown providers to "unknown"', async () => {
    process.env['CHAT_PROVIDER'] = 'signal'
    process.env['TASK_PROVIDER'] = 'jira'

    const res = handleAdminSystem()
    const body = await readJson(res)
    expect(pick(body, 'chatProvider')).toBe('unknown')
    expect(pick(body, 'taskProvider')).toBe('unknown')
  })

  test('reports unknown task provider when TASK_PROVIDER is unset', async () => {
    delete process.env['TASK_PROVIDER']

    const res = handleAdminSystem()
    const body = await readJson(res)

    expect(res.status).toBe(200)
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
})
