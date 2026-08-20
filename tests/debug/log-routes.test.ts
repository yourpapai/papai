// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import type { AuthenticatedRequest } from '../../src/dashboard-auth/index.js'
import { logBuffer } from '../../src/debug/log-buffer.js'
import { handleLogs, handleLogStats, handleLogScopes } from '../../src/debug/log-routes.js'
import { setupTestDb } from '../utils/test-helpers.js'

const sessionFor = (adminUserId: string): AuthenticatedRequest => ({
  adminUserId,
  expiresAt: Number.MAX_SAFE_INTEGER,
  sessionIdHash: `hash-${adminUserId}`,
})

const pick = (obj: unknown, key: string): unknown =>
  typeof obj === 'object' && obj !== null ? Reflect.get(obj, key) : undefined

describe('log-routes egress', () => {
  afterEach(() => {
    logBuffer.clear()
  })

  test('handleLogs shapes foreign and unattributable entries, keeps own verbatim', async () => {
    await setupTestDb()
    logBuffer.clear()
    logBuffer.push({ level: 30, time: 't1', msg: 'own', chatUserId: 'a1', userText: 's1' })
    logBuffer.push({ level: 30, time: 't2', msg: 'foreign', chatUserId: 'a2', userText: 's2' })
    logBuffer.push({ level: 30, time: 't3', msg: 'anon', userText: 's3', durationMs: 2 })

    const res = handleLogs(new URL('http://x/logs'), sessionFor('a1'))
    const body: unknown = JSON.parse(await res.text())
    assert(Array.isArray(body), 'expected array')
    const entries = body as unknown[]
    const own = entries.find((e) => pick(e, 'msg') === 'own')
    expect(pick(own, 'userText')).toBe('s1')
    const foreign = entries.find((e) => pick(e, 'msg') === 'foreign')
    expect(pick(foreign, 'userText')).toBeUndefined()
    const anon = entries.find((e) => pick(e, 'msg') === 'anon')
    expect(pick(anon, 'userText')).toBeUndefined()
    expect(pick(anon, 'durationMs')).toBe(2)
  })

  test('handleLogStats matchingCount counts post-shaping matches only', async () => {
    await setupTestDb()
    logBuffer.clear()
    logBuffer.push({ level: 30, time: 't1', msg: 'own', chatUserId: 'a1', userText: 'secret' })
    logBuffer.push({ level: 30, time: 't2', msg: 'foreign', chatUserId: 'a2', userText: 'secret' })

    const res = handleLogStats(new URL('http://x/logs/stats?q=secret'), sessionFor('a1'))
    const body: unknown = JSON.parse(await res.text())
    expect(pick(body, 'matchingCount')).toBe(1)
  })

  test('handleLogScopes returns distinct scopes', async () => {
    await setupTestDb()
    logBuffer.clear()
    logBuffer.push({ level: 30, time: 't1', msg: 'a', scope: 'bot' })
    const res = handleLogScopes()
    const body: unknown = JSON.parse(await res.text())
    assert(Array.isArray(body), 'expected array')
    expect(body).toHaveLength(1)
  })
})
