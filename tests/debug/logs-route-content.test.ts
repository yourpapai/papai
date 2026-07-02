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

describe('/logs content (unredacted)', () => {
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
      msg: 'searchTasks called',
      userText: 'top secret',
      scope: 'bot',
      messageLength: 10,
    })
    logBuffer.push({ level: 30, time: '2026-06-15T00:00:01.000Z', msg: 'tg', scope: 'chat:telegram' })
    logBuffer.push({ level: 30, time: '2026-06-15T00:00:02.000Z', msg: 'mm', scope: 'chat:mattermost' })
    logBuffer.push({ level: 20, time: '2026-06-15T00:00:03.000Z', msg: 'dbg', scope: 'tool:x' })
  })

  afterAll(() => {
    stopDebugServer()
    setStoreDb(null)
    logBuffer.clear()
    delete process.env['DEBUG_PORT']
  })

  test('returns full fields and the verbatim msg', async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/logs`, {
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(200)
    const body = await readJsonArray(res)
    expect(body).toHaveLength(4)
    const entry = body[0]
    expect(pick(entry, 'userText')).toBe('top secret')
    expect(pick(entry, 'messageLength')).toBe(10)
    expect(pick(entry, 'msg')).toBe('searchTasks called')
  })
})

describe('/logs filtering routes', () => {
  const base = `http://127.0.0.1:${TEST_PORT}`
  const cookieHeader = (): { Cookie: string } => ({
    Cookie: `${SESSION_COOKIE_NAME}=${mintSession(ADMIN, { secure: false }).cookieValue}`,
  })

  beforeAll(async () => {
    mockLogger()
    await setupTestDb()
    setStoreDb(getTestDb().$client)
    process.env['DEBUG_PORT'] = String(TEST_PORT)
    startDebugServer(ADMIN, { debugEnabled: true })
    logBuffer.clear()
    logBuffer.push({
      level: 30,
      time: '2026-06-15T00:00:00.000Z',
      msg: 'searchTasks called',
      userText: 'top secret',
      scope: 'bot',
      messageLength: 10,
    })
    logBuffer.push({ level: 30, time: '2026-06-15T00:00:01.000Z', msg: 'tg', scope: 'chat:telegram' })
    logBuffer.push({ level: 30, time: '2026-06-15T00:00:02.000Z', msg: 'mm', scope: 'chat:mattermost' })
    logBuffer.push({ level: 20, time: '2026-06-15T00:00:03.000Z', msg: 'dbg', scope: 'tool:x' })
  })

  afterAll(() => {
    stopDebugServer()
    setStoreDb(null)
    logBuffer.clear()
    delete process.env['DEBUG_PORT']
  })

  test('include prefix filters scopes server-side', async () => {
    const res = await fetch(`${base}/logs?include=chat`, { headers: cookieHeader() })
    const body = await readJsonArray(res)
    const scopes = body.map((e) => pick(e, 'scope'))
    expect(scopes).toContain('chat:telegram')
    expect(scopes).toContain('chat:mattermost')
    expect(scopes).not.toContain('tool:x')
    expect(scopes).not.toContain('bot')
  })

  test('exclude wins over include', async () => {
    const res = await fetch(`${base}/logs?include=chat&exclude=chat:telegram`, { headers: cookieHeader() })
    const scopes = (await readJsonArray(res)).map((e) => pick(e, 'scope'))
    expect(scopes).toEqual(['chat:mattermost'])
  })

  test('q substring searches metadata fields', async () => {
    const res = await fetch(`${base}/logs?q=top%20secret`, { headers: cookieHeader() })
    const body = await readJsonArray(res)
    expect(body).toHaveLength(1)
    expect(pick(body[0], 'msg')).toBe('searchTasks called')
  })

  test('/logs/scopes returns distinct scopes with counts', async () => {
    const res = await fetch(`${base}/logs/scopes`, { headers: cookieHeader() })
    const body = await readJsonArray(res)
    const map = new Map(body.map((r) => [pick(r, 'scope'), pick(r, 'count')]))
    expect(map.get('chat:telegram')).toBe(1)
    expect(map.has('bot')).toBe(true)
  })

  test('/logs/stats includes matchingCount for the active filter', async () => {
    const res = await fetch(`${base}/logs/stats?include=chat`, { headers: cookieHeader() })
    const stats: unknown = JSON.parse(await res.text())
    expect(pick(stats, 'matchingCount')).toBe(2)
    expect(typeof pick(stats, 'count')).toBe('number')
  })
})
