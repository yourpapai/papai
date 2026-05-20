// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { systemConfig } from '../../src/db/schema.js'
import { startDebugServer, stopDebugServer } from '../../src/debug/server.js'
import { getLogLevel } from '../../src/logger.js'
import { getSystemConfig, resetSystemConfigCacheForTesting, setSystemConfig } from '../../src/system-config.js'
import { getTestDb, mockLogger, restoreFetch, setupTestDb } from '../utils/test-helpers.js'

const TEST_PORT = 19112
const TOKEN = 'admin-route-token'
const ADMIN = 'admin-1'

const readJson = async (res: Response): Promise<object> => {
  const parsed: unknown = JSON.parse(await res.text())
  assert(typeof parsed === 'object' && parsed !== null, 'expected JSON object')
  return parsed
}

const pick = (obj: object, key: string): unknown => Reflect.get(obj, key)

const pickObject = (obj: object, key: string): object => {
  const v = pick(obj, key)
  assert(typeof v === 'object' && v !== null, `expected ${key} to be an object`)
  return v
}

const authHeaders: HeadersInit = {
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
}

describe('debug-server admin/llm routes', () => {
  beforeAll(async () => {
    mockLogger()
    await setupTestDb()
    restoreFetch()
    process.env['DEBUG_PORT'] = String(TEST_PORT)
    process.env['DEBUG_TOKEN'] = TOKEN
    process.env['ADMIN_USER_ID'] = ADMIN
    startDebugServer('test-admin', getLogLevel())
  })

  beforeEach(async () => {
    await setupTestDb()
    resetSystemConfigCacheForTesting()
    process.env['DEBUG_TOKEN'] = TOKEN
    process.env['ADMIN_USER_ID'] = ADMIN
  })

  afterEach(() => {
    process.env['DEBUG_TOKEN'] = TOKEN
    process.env['ADMIN_USER_ID'] = ADMIN
  })

  afterAll(() => {
    stopDebugServer()
    delete process.env['DEBUG_PORT']
    delete process.env['DEBUG_TOKEN']
    delete process.env['ADMIN_USER_ID']
  })

  test('GET /admin/llm requires the bearer token', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/admin/llm`)
    expect(res.status).toBe(401)
    await res.body?.cancel()
  })

  test('GET /admin/llm returns the snapshot with llm_apikey masked', async () => {
    setSystemConfig('llm_apikey', 'sk-abcd1234', ADMIN)
    setSystemConfig('main_model', 'gpt-9', ADMIN)
    const res = await fetch(`http://localhost:${TEST_PORT}/admin/llm`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await readJson(res)
    const apikey = pickObject(body, 'llm_apikey')
    expect(pick(apikey, 'value')).toBe('****1234')
    expect(pick(apikey, 'updatedBy')).toBe(ADMIN)
    const main = pickObject(body, 'main_model')
    expect(pick(main, 'value')).toBe('gpt-9')
    const small = pickObject(body, 'small_model')
    expect(pick(small, 'value')).toBeNull()
  })

  test('POST /admin/llm with valid body persists and returns 200', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/admin/llm`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ key: 'main_model', value: 'gpt-6' }),
    })
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(pick(body, 'ok')).toBe(true)
    expect(pick(body, 'key')).toBe('main_model')
    expect(getSystemConfig('main_model')).toBe('gpt-6')

    // updatedBy is ADMIN_USER_ID
    const row = getTestDb()
      .select()
      .from(systemConfig)
      .all()
      .find((r) => r.key === 'main_model')
    expect(row?.updatedBy).toBe(ADMIN)
  })

  test('POST /admin/llm rejects unknown key with 400', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/admin/llm`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ key: 'unknown', value: 'x' }),
    })
    expect(res.status).toBe(400)
    await res.body?.cancel()
  })

  test('POST /admin/llm rejects empty value with 400', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/admin/llm`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ key: 'main_model', value: '' }),
    })
    expect(res.status).toBe(400)
    await res.body?.cancel()
  })

  test('POST /admin/llm rejects malformed JSON with 400', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/admin/llm`, {
      method: 'POST',
      headers: authHeaders,
      body: 'not-json',
    })
    expect(res.status).toBe(400)
    await res.body?.cancel()
  })

  test('POST /admin/llm requires the bearer token', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/admin/llm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'main_model', value: 'gpt-6' }),
    })
    expect(res.status).toBe(401)
    await res.body?.cancel()
  })

  test('POST /admin/llm refuses with 401 when DEBUG_TOKEN is unset in env', async () => {
    delete process.env['DEBUG_TOKEN']
    const res = await fetch(`http://localhost:${TEST_PORT}/admin/llm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'main_model', value: 'gpt-6' }),
    })
    expect(res.status).toBe(401)
    await res.body?.cancel()
  })

  test('POST /admin/llm returns 503 when ADMIN_USER_ID is unset', async () => {
    delete process.env['ADMIN_USER_ID']
    const res = await fetch(`http://localhost:${TEST_PORT}/admin/llm`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ key: 'main_model', value: 'gpt-6' }),
    })
    expect(res.status).toBe(503)
    await res.body?.cancel()
  })
})
