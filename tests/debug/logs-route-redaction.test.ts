// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { SESSION_COOKIE_NAME } from '../../src/dashboard-auth/cookie.js'
import { mintSession } from '../../src/dashboard-auth/index.js'
import { setStoreDb } from '../../src/dashboard-auth/store.js'
import { logBuffer } from '../../src/debug/log-buffer.js'
import { startDebugServer, stopDebugServer } from '../../src/debug/server.js'
import { getTestDb, mockLogger, setupTestDb } from '../utils/test-helpers.js'

const TEST_PORT = 19233
const ADMIN = 'admin-user'

const readJsonArray = async (res: Response): Promise<unknown[]> => {
  const parsed: unknown = JSON.parse(await res.text())
  assert(Array.isArray(parsed), 'expected JSON array')
  const arr: unknown[] = parsed
  return arr
}

const pick = (obj: unknown, key: string): unknown =>
  typeof obj === 'object' && obj !== null ? Reflect.get(obj, key) : undefined

describe('/logs redaction', () => {
  let cookie: string

  beforeAll(async () => {
    mockLogger()
    await setupTestDb()
    setStoreDb(getTestDb().$client)
    // getPort() reads DEBUG_PORT; bind a unique port for this worker
    process.env['DEBUG_PORT'] = String(TEST_PORT)
    startDebugServer(ADMIN, { debugEnabled: true })
    const { cookieValue } = mintSession(ADMIN, { secure: false })
    cookie = `${SESSION_COOKIE_NAME}=${cookieValue}`
    logBuffer.clear()
    logBuffer.push({
      level: 30,
      time: '2026-06-15T00:00:00.000Z',
      msg: 'Message received from user',
      userText: 'top secret',
      scope: 'bot',
      messageLength: 10,
    })
  })

  afterAll(() => {
    stopDebugServer()
    setStoreDb(null)
    logBuffer.clear()
    delete process.env['DEBUG_PORT']
  })

  test('does not return sensitive fields', async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/logs`, {
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(200)
    const body = await readJsonArray(res)
    expect(body).toHaveLength(1)
    const entry = body[0]
    expect(entry).not.toHaveProperty('userText')
    expect(pick(entry, 'messageLength')).toBe(10)
    expect(pick(entry, 'msg')).toBe('Message received from user')
  })
})
