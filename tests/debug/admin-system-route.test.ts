// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { startDebugServer, stopDebugServer } from '../../src/debug/server.js'
import { getLogLevel } from '../../src/logger.js'
import { mockLogger, restoreFetch, setupTestDb } from '../utils/test-helpers.js'

const TEST_PORT = 19118
const TOKEN = 'system-route-token'

const authHeaders: HeadersInit = {
  Authorization: `Bearer ${TOKEN}`,
}

const pick = (obj: object, key: string): unknown => Reflect.get(obj, key)

const parseJsonObject = (text: string): object => {
  const parsed: unknown = JSON.parse(text)
  assert.ok(typeof parsed === 'object' && parsed !== null, 'expected JSON object')
  return parsed
}

const cancelBody = async (body: ReadableStream<Uint8Array> | null): Promise<void> => {
  if (body !== null) await body.cancel()
}

describe('debug-server admin/system route', () => {
  beforeAll(async () => {
    mockLogger()
    await setupTestDb()
    restoreFetch()
    process.env['DEBUG_PORT'] = String(TEST_PORT)
    process.env['DEBUG_HOSTNAME'] = 'localhost'
    process.env['DEBUG_TOKEN'] = TOKEN
    startDebugServer('test-admin', getLogLevel())
  })

  beforeEach(() => {
    process.env['DEBUG_TOKEN'] = TOKEN
    process.env['CHAT_PROVIDER'] = 'telegram'
    process.env['TASK_PROVIDER'] = 'kaneo'
    process.env['DEBUG_SERVER'] = 'true'
    process.env['ADMIN_USER_ID'] = 'admin-1'
    process.env['TELEGRAM_BOT_TOKEN'] = 'secret-token-value'
    process.env['LLM_API_KEY'] = 'sk-secret-value'
  })

  afterAll(() => {
    stopDebugServer()
    delete process.env['DEBUG_PORT']
    delete process.env['DEBUG_HOSTNAME']
    delete process.env['DEBUG_TOKEN']
    delete process.env['CHAT_PROVIDER']
    delete process.env['TASK_PROVIDER']
    delete process.env['DEBUG_SERVER']
    delete process.env['ADMIN_USER_ID']
    delete process.env['TELEGRAM_BOT_TOKEN']
    delete process.env['LLM_API_KEY']
  })

  test('GET /admin/system requires the bearer token', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/admin/system`)
    expect(res.status).toBe(401)
    await cancelBody(res.body)
  })

  test('GET /admin/system returns only safe system summary fields', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/admin/system`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toContain('secret-token-value')
    expect(text).not.toContain('sk-secret-value')

    const body = parseJsonObject(text)
    expect(pick(body, 'chatProvider')).toBe('telegram')
    expect(pick(body, 'taskProvider')).toBe('kaneo')
    expect(pick(body, 'debugServer')).toBe(true)
    expect(pick(body, 'adminUserSet')).toBe(true)
    expect(Object.keys(body).toSorted()).toEqual(['adminUserSet', 'chatProvider', 'debugServer', 'taskProvider'])
  })

  test('GET /admin/system maps unsupported providers to unknown', async () => {
    process.env['CHAT_PROVIDER'] = 'custom-chat-secret'
    process.env['TASK_PROVIDER'] = 'custom-task-secret'

    const res = await fetch(`http://localhost:${TEST_PORT}/admin/system`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toContain('custom-chat-secret')
    expect(text).not.toContain('custom-task-secret')

    const body = parseJsonObject(text)
    expect(pick(body, 'chatProvider')).toBe('unknown')
    expect(pick(body, 'taskProvider')).toBe('unknown')
  })
})
