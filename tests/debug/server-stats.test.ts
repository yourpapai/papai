// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { users } from '../../src/db/schema.js'
import { startDebugServer, stopDebugServer } from '../../src/debug/server.js'
import { getLogLevel } from '../../src/logger.js'
import { clearStatsCacheForTesting } from '../../src/stats/index.js'
import { getTestDb, mockLogger, restoreFetch, setupTestDb } from '../utils/test-helpers.js'

const TEST_PORT = 19112
const TOKEN = 'stats-route-token'

const readJson = async (res: Response): Promise<object> => {
  const parsed: unknown = JSON.parse(await res.text())
  assert(typeof parsed === 'object' && parsed !== null, 'expected JSON object')
  return parsed
}
const pick = (obj: object, key: string): unknown => Reflect.get(obj, key)

const authHeaders: HeadersInit = { Authorization: `Bearer ${TOKEN}` }

describe('debug-server stats routes', () => {
  beforeAll(async () => {
    mockLogger()
    await setupTestDb()
    restoreFetch()
    process.env['DEBUG_PORT'] = String(TEST_PORT)
    process.env['DEBUG_TOKEN'] = TOKEN
    process.env['ADMIN_USER_ID'] = 'admin-1'
    startDebugServer('test-admin', getLogLevel())
  })

  beforeEach(async () => {
    await setupTestDb()
    clearStatsCacheForTesting()
  })

  afterAll(() => {
    stopDebugServer()
    delete process.env['DEBUG_PORT']
    delete process.env['DEBUG_TOKEN']
    delete process.env['ADMIN_USER_ID']
  })

  test('GET /stats/global without token returns 401', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/stats/global`)
    expect(res.status).toBe(401)
    await res.body?.cancel()
  })

  test('GET /stats/global with token returns GlobalStats shape', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/stats/global`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(pick(body, 'window')).toBe('30d')
    expect(pick(body, 'subjects')).toBeDefined()
    expect(pick(body, 'active')).toBeDefined()
    expect(pick(body, 'distributions')).toBeDefined()
    expect(pick(body, 'storage')).toBeDefined()
    expect(pick(body, 'identityMix')).toBeDefined()
    expect(pick(body, 'surfaceMix')).toBeDefined()
    expect(pick(body, 'webFetches')).toBeDefined()
    expect(pick(body, 'toolMix')).toBeDefined()
  })

  test('GET /stats/global?window=7d returns body with window 7d', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/stats/global?window=7d`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(pick(body, 'window')).toBe('7d')
  })

  test('GET /stats/global rejects unknown window with 400', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/stats/global?window=foo`, { headers: authHeaders })
    expect(res.status).toBe(400)
    await res.body?.cancel()
  })

  test('GET /stats/subject/<unknown> returns 404', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/stats/subject/nobody`, { headers: authHeaders })
    expect(res.status).toBe(404)
    await res.body?.cancel()
  })

  test('GET /stats/subject/<seeded> returns SubjectStats shape', async () => {
    getTestDb().insert(users).values({ platformUserId: 'u1', username: 'alice', addedBy: 'admin' }).run()

    const res = await fetch(`http://localhost:${TEST_PORT}/stats/subject/u1`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(pick(body, 'storageContextId')).toBe('u1')
    expect(pick(body, 'contextType')).toBe('dm')
    expect(pick(body, 'displayName')).toBe('alice')
    expect(pick(body, 'memos')).toBeDefined()
    expect(pick(body, 'llmUsage')).toBeDefined()
    expect(pick(body, 'toolCalls')).toBeDefined()
  })
})
