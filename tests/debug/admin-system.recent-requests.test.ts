// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { llmUsageEvents } from '../../src/db/schema.js'
import { RecentRequestsResponseSchema } from '../../src/debug/admin-schemas.js'
import { handleAdminRecentRequests } from '../../src/debug/admin-system.js'
import { setupTestDb } from '../utils/test-helpers.js'

const readJson = async (res: Response): Promise<object> => {
  const parsed: unknown = JSON.parse(await res.text())
  assert(typeof parsed === 'object' && parsed !== null, 'expected JSON object')
  return parsed
}

const pick = (obj: object, key: string): unknown => Reflect.get(obj, key)

const baseRow = {
  turnId: 'turn_abc',
  contextType: 'dm',
  chatUserId: 'u1',
  model: 'gpt-4o-mini',
  modelRole: 'main',
  inputTokens: 100,
  outputTokens: 40,
  stepCount: 1,
  toolCallCount: 0,
  messageCount: 1,
  finishReason: 'stop',
  durationMs: 250,
  responseId: null,
  error: null,
}

const insert = (eventId: string, ctxId: string, occurredAt: number): void => {
  getDrizzleDb()
    .insert(llmUsageEvents)
    .values({ eventId, storageContextId: ctxId, occurredAt, ...baseRow })
    .run()
}

describe('handleAdminRecentRequests', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('returns 400 when subject id missing', () => {
    const res = handleAdminRecentRequests(new URL('http://localhost/admin/subjects//recent-requests'))
    expect(res.status).toBe(400)
  })

  test('returns the anonymous shape with default limit of 25', async () => {
    insert('e1', 'user:1', 1000)
    insert('e2', 'user:1', 2000)
    const res = handleAdminRecentRequests(new URL('http://localhost/admin/subjects/user%3A1/recent-requests'))
    expect(res.status).toBe(200)
    const body = JSON.parse(await res.text()) as unknown
    const parsed = RecentRequestsResponseSchema.parse(body)
    expect(parsed.subjectId).toBe('user:1')
    expect(parsed.limit).toBe(25)
    expect(parsed.requests).toHaveLength(2)
    expect(parsed.requests[0]?.ts).toBe(2000)
  })

  test('respects ?limit=', async () => {
    for (let i = 0; i < 5; i += 1) insert(`e${i}`, 'user:1', i * 1000)
    const res = handleAdminRecentRequests(new URL('http://localhost/admin/subjects/user%3A1/recent-requests?limit=2'))
    const body = await readJson(res)
    const requests = pick(body, 'requests')
    assert(Array.isArray(requests), 'expected requests array')
    expect(requests).toHaveLength(2)
  })

  test('clamps invalid limits to the default safe range', async () => {
    insert('e1', 'user:1', 1000)
    const res = handleAdminRecentRequests(new URL('http://localhost/admin/subjects/user%3A1/recent-requests?limit=-5'))
    const body = await readJson(res)
    expect(pick(body, 'limit')).toBe(0)
    const requests = pick(body, 'requests')
    assert(Array.isArray(requests), 'expected requests array')
    expect(requests).toHaveLength(0)
  })

  test('never returns content-bearing fields', async () => {
    insert('e1', 'user:1', 1000)
    const res = handleAdminRecentRequests(new URL('http://localhost/admin/subjects/user%3A1/recent-requests'))
    const body = JSON.parse(await res.text()) as unknown
    const parsed = RecentRequestsResponseSchema.parse(body)
    expect(parsed.requests).toHaveLength(1)
    const keys = Object.keys(parsed.requests[0]!)
    expect(keys).not.toContain('chatUserId')
    expect(keys).not.toContain('turnId')
    expect(keys).not.toContain('responseId')
    expect(keys).not.toContain('error')
    expect(keys).not.toContain('message')
    expect(keys).not.toContain('prompt')
    expect(keys).not.toContain('content')
  })
})
