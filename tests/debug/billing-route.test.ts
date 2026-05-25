// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { users } from '../../src/db/schema.js'
import { startDebugServer, stopDebugServer } from '../../src/debug/server.js'
import { getLogLevel } from '../../src/logger.js'
import { recordUsage, type UsageEvent } from '../../src/usage/recorder.js'
import { getTestDb, mockLogger, restoreFetch, setupTestDb } from '../utils/test-helpers.js'

const readJson = async (res: Response): Promise<object> => {
  const parsed: unknown = JSON.parse(await res.text())
  assert(typeof parsed === 'object' && parsed !== null, 'expected JSON object')
  return parsed
}

const pick = (obj: object, key: string): unknown => Reflect.get(obj, key)

const pickArray = (obj: object, key: string): unknown[] => {
  const v = pick(obj, key)
  assert(Array.isArray(v), `expected ${key} to be an array`)
  return v
}

const pickObject = (obj: object, key: string): object => {
  const v = pick(obj, key)
  assert(typeof v === 'object' && v !== null, `expected ${key} to be an object`)
  return v
}

const asObject = (value: unknown): object => {
  assert(typeof value === 'object' && value !== null, 'expected object')
  return value
}

const TEST_PORT = 19111
const TOKEN = 'route-test-token'
const NOW = 1_700_000_000_000

const seedUsage = (overrides: Partial<UsageEvent> = {}): void => {
  recordUsage({
    occurredAt: NOW,
    turnId: 'turn',
    storageContextId: 'ctx',
    contextType: 'dm',
    chatUserId: 'user',
    model: 'm',
    modelRole: 'main',
    inputTokens: 10,
    outputTokens: 20,
    stepCount: 1,
    toolCallCount: 0,
    messageCount: 1,
    finishReason: 'stop',
    durationMs: 100,
    responseId: 'resp',
    error: null,
    ...overrides,
  })
}

const insertUser = (platformUserId: string, username: string | null): void => {
  getTestDb()
    .insert(users)
    .values({
      platformUserId,
      username,
      addedBy: 'test',
      addedAt: new Date(NOW).toISOString(),
    })
    .run()
}

const authHeaders: HeadersInit = { Authorization: `Bearer ${TOKEN}` }

describe('debug-server billing routes', () => {
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
  })

  afterAll(() => {
    stopDebugServer()
    delete process.env['DEBUG_PORT']
    delete process.env['DEBUG_TOKEN']
    delete process.env['ADMIN_USER_ID']
  })

  test('GET /billing/subjects requires the bearer token', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/billing/subjects`)
    expect(res.status).toBe(401)
    await res.body?.cancel()
  })

  test('GET /billing/subjects returns subjects with displayName resolved', async () => {
    insertUser('user-A', 'alice')
    seedUsage({ storageContextId: 'user-A', chatUserId: 'user-A', contextType: 'dm' })

    const res = await fetch(`http://localhost:${TEST_PORT}/billing/subjects?window=all`, {
      headers: authHeaders,
    })
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(pick(body, 'window')).toBe('all')
    const subjects = pickArray(body, 'subjects')
    expect(subjects).toHaveLength(1)
    const first = asObject(subjects[0])
    expect(pick(first, 'displayName')).toBe('alice')
    expect(pick(first, 'storageContextId')).toBe('user-A')
  })

  test('GET /billing/subjects defaults window to 30d', async () => {
    seedUsage({ storageContextId: 'ctx-A' })
    const res = await fetch(`http://localhost:${TEST_PORT}/billing/subjects`, {
      headers: authHeaders,
    })
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(pick(body, 'window')).toBe('30d')
  })

  test('GET /billing/subjects rejects unknown window with 400', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/billing/subjects?window=foo`, {
      headers: authHeaders,
    })
    expect(res.status).toBe(400)
    await res.body?.cancel()
  })

  test('GET /billing/subject/:id returns detail with subject and requests', async () => {
    insertUser('user-A', 'alice')
    seedUsage({
      storageContextId: 'user-A',
      chatUserId: 'user-A',
      contextType: 'dm',
      occurredAt: NOW,
    })
    seedUsage({
      storageContextId: 'user-A',
      chatUserId: 'user-A',
      contextType: 'dm',
      occurredAt: NOW - 1,
    })

    const res = await fetch(`http://localhost:${TEST_PORT}/billing/subject/user-A?window=all`, {
      headers: authHeaders,
    })
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(pick(body, 'window')).toBe('all')
    const subject = pickObject(body, 'subject')
    expect(pick(subject, 'storageContextId')).toBe('user-A')
    expect(pick(subject, 'displayName')).toBe('alice')
    expect(pickArray(body, 'requests')).toHaveLength(2)
    expect(pick(body, 'truncated')).toBe(false)
  })

  test('GET /billing/subject/:id returns 404 when no rows exist', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/billing/subject/missing`, {
      headers: authHeaders,
    })
    expect(res.status).toBe(404)
    await res.body?.cancel()
  })

  test('GET /billing/subject/:id rejects unknown window with 400', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/billing/subject/ctx?window=2w`, {
      headers: authHeaders,
    })
    expect(res.status).toBe(400)
    await res.body?.cancel()
  })

  test('GET /billing/subject/:id decodes percent-encoded subject ids (group:thread)', async () => {
    seedUsage({ storageContextId: 'group-9:thread-1', contextType: 'group', chatUserId: 'user-A' })
    const encoded = encodeURIComponent('group-9:thread-1')
    const res = await fetch(`http://localhost:${TEST_PORT}/billing/subject/${encoded}?window=all`, {
      headers: authHeaders,
    })
    expect(res.status).toBe(200)
    const body = await readJson(res)
    const subject = pickObject(body, 'subject')
    expect(pick(subject, 'storageContextId')).toBe('group-9:thread-1')
  })
})
