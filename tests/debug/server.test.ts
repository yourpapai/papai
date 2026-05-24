// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { logBuffer, logBufferStream } from '../../src/debug/log-buffer.js'
import { startDebugServer, stopDebugServer } from '../../src/debug/server.js'
import { getLogLevel, logMultistream } from '../../src/logger.js'
import { restoreFetch, setupTestDb } from '../utils/test-helpers.js'

const PINO_LEVEL_VALUES: Record<string, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: Infinity,
}

const TEST_PORT = 19100
const PUBLIC_DIR = path.resolve(import.meta.dir, '../../public')

function ensurePublicBuilt(): void {
  const required = ['debug.js', 'debug.html', 'debug.css', 'admin.js', 'admin.html', 'admin.css']
  const missing = required.some((f) => !fs.existsSync(path.join(PUBLIC_DIR, f)))
  if (!missing) return

  const proc = Bun.spawnSync(['bun', 'scripts/build-client.ts'], {
    cwd: path.resolve(import.meta.dir, '../..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (proc.exitCode !== 0) {
    throw new Error(`Build failed: ${proc.stderr.toString()}`)
  }
}

/** Narrow a parsed JSON body to an array, throwing if it is not one. */
function assertArray(value: unknown): unknown[] {
  assert.ok(Array.isArray(value), 'expected array')
  return value
}

async function cancelBody(res: Response): Promise<void> {
  if (res.body === null) return
  await res.body.cancel()
}

/**
 * Narrow a log entry to an object that has the given key; return the value at
 * that key so callers never need to use index-signature dot access.
 */
function assertLogEntryKey(entry: unknown, key: string): unknown {
  assert.ok(typeof entry === 'object' && entry !== null, 'expected log entry to be an object')
  assert.ok(key in entry, `expected log entry to have key "${key}"`)
  return Reflect.get(entry, key)
}

/**
 * Find the level value registered for logBufferStream inside logMultistream.
 * Returns `undefined` if the stream is not present.
 */
function findBufferStreamLevel(multistream: unknown, target: unknown): unknown {
  assert.ok(typeof multistream === 'object' && multistream !== null, 'expected multistream to be an object')
  const streams = assertArray(Reflect.get(multistream, 'streams'))
  for (const entry of streams) {
    assert.ok(typeof entry === 'object' && entry !== null, 'expected stream entry to be an object')
    if (Reflect.get(entry, 'stream') === target) {
      return Reflect.get(entry, 'level')
    }
  }
  return undefined
}

/**
 * Seed the log buffer with known entries so route tests are self-sufficient
 * and don't depend on pino's multistream pipeline (which can be broken by
 * logger mock pollution from other test files in the full suite).
 */
function seedLogBuffer(): void {
  logBuffer.push({ level: 30, time: '2026-03-28T10:00:00.000Z', scope: 'debug-server', msg: 'Debug server started' })
  logBuffer.push({ level: 50, time: '2026-03-28T10:00:01.000Z', scope: 'bot', msg: 'Something failed' })
}

function mockDebugServerDependencies(): void {
  void mock.module('../../src/recurring.js', () => ({
    listRecurringTasks: (): unknown[] => [],
  }))
  void mock.module('../../src/deferred-prompts/scheduled.js', () => ({
    listScheduledPrompts: (): unknown[] => [],
  }))
  void mock.module('../../src/memos.js', () => ({
    listMemos: (): unknown[] => [],
  }))
  void mock.module('../../src/identity/mapping.js', () => ({
    getIdentityMapping: (): null => null,
  }))
  void mock.module('../../src/authorized-groups.js', () => ({
    listAuthorizedGroups: (): unknown[] => [],
  }))
}

describe('debug-server', () => {
  let capturedLogLevel: string

  beforeAll(async () => {
    mockDebugServerDependencies()
    await setupTestDb()
    ensurePublicBuilt()
    restoreFetch()
    process.env['DEBUG_PORT'] = String(TEST_PORT)
    // Capture the log level and pass it explicitly to avoid mock-binding interference
    capturedLogLevel = getLogLevel()
    startDebugServer('test-admin', capturedLogLevel)
    seedLogBuffer()
  })

  beforeEach(() => {
    mockDebugServerDependencies()
  })

  afterAll(() => {
    mock.restore()
    stopDebugServer()
    logBuffer.clear()
    delete process.env['DEBUG_PORT']
  })

  test('GET /debug returns debug HTML', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/debug`)
    expect(res.status).toBe(200)
    const ct = res.headers.get('content-type')
    expect(ct).toContain('text/html')
    const body = await res.text()
    expect(body).toContain('<html')
    expect(body).toContain('papai debug')
  })

  test('GET /debug.css returns CSS', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/debug.css`)
    expect(res.status).toBe(200)
    const ct = res.headers.get('content-type')
    expect(ct).toContain('text/css')
    const body = await res.text()
    expect(body).toContain('#log-explorer')
  })

  test('GET /debug.js returns JavaScript bundle from public/', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/debug.js`)
    expect(res.status).toBe(200)
    const ct = res.headers.get('content-type')
    expect(ct).toContain('javascript')
    const body = await res.text()
    expect(body.length).toBeGreaterThan(0)
  })

  test.each([
    ['/admin', 'text/html'],
    ['/admin.js', 'javascript'],
    ['/admin.css', 'text/css'],
  ])('GET %s returns admin asset', async (assetPath, contentType) => {
    const res = await fetch(`http://localhost:${TEST_PORT}${assetPath}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain(contentType)
    const body = await res.text()
    expect(body.length).toBeGreaterThan(0)
  })

  test('GET /dashboard returns 301 redirect to /debug', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/dashboard`, { redirect: 'manual' })
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('/debug')
    await cancelBody(res)
  })

  test('GET /dashboard-state.js returns 404 (legacy route removed)', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/dashboard-state.js`)
    expect(res.status).toBe(404)
    await cancelBody(res)
  })

  test('GET /dashboard-ui.js returns 404 (legacy route removed)', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/dashboard-ui.js`)
    expect(res.status).toBe(404)
    await cancelBody(res)
  })

  test('GET /dashboard.xyz returns 404', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/dashboard.xyz`)
    expect(res.status).toBe(404)
    await cancelBody(res)
  })

  test('GET /events returns SSE headers', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/events`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    expect(res.headers.get('cache-control')).toBe('no-cache')
    // Abort the stream to clean up
    await cancelBody(res)
  })

  test('unknown route returns 404', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/nonexistent`)
    expect(res.status).toBe(404)
    await cancelBody(res)
  })

  test('GET /logs returns JSON array', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/logs`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/json')
    const entries = assertArray(JSON.parse(await res.text()))
    expect(entries.length).toBeGreaterThan(0)
  })

  test('GET /logs supports level filter', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/logs?level=50`)
    expect(res.status).toBe(200)
    const entries = assertArray(JSON.parse(await res.text()))
    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      expect(assertLogEntryKey(entry, 'level')).toBeGreaterThanOrEqual(50)
    }
  })

  test('GET /logs supports scope filter', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/logs?scope=debug-server`)
    expect(res.status).toBe(200)
    const entries = assertArray(JSON.parse(await res.text()))
    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      expect(assertLogEntryKey(entry, 'scope')).toBe('debug-server')
    }
  })

  test('GET /logs supports text search', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/logs?q=Debug%20server`)
    expect(res.status).toBe(200)
    const entries = assertArray(JSON.parse(await res.text()))
    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      expect(String(assertLogEntryKey(entry, 'msg')).toLowerCase()).toContain('debug server')
    }
  })

  test('GET /logs supports limit', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/logs?limit=1`)
    expect(res.status).toBe(200)
    const entries = assertArray(JSON.parse(await res.text()))
    expect(entries).toHaveLength(1)
  })

  test('GET /logs supports turnId filter', async () => {
    logBuffer.push({ level: 30, time: '2026-03-28T10:00:02.000Z', msg: 'turn msg', turnId: 'turn-test-123' })
    const res = await fetch(`http://localhost:${TEST_PORT}/logs?turnId=turn-test-123`)
    expect(res.status).toBe(200)
    const entries = assertArray(JSON.parse(await res.text()))
    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      expect(assertLogEntryKey(entry, 'turnId')).toBe('turn-test-123')
    }
  })

  test('GET /logs/stats returns buffer metadata', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/logs/stats`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/json')
    const body: unknown = JSON.parse(await res.text())
    expect(body).toHaveProperty('count')
    expect(body).toHaveProperty('capacity', 65535)
    expect(body).toHaveProperty('oldest')
    expect(body).toHaveProperty('newest')
  })

  test('buffer stream is registered with level matching LOG_LEVEL', () => {
    const foundLevel = findBufferStreamLevel(logMultistream, logBufferStream)
    expect(foundLevel).toBeDefined()
    // Use the captured log level from when the server started, not current env
    // (other tests may have modified LOG_LEVEL after server start)
    const expectedLevel = PINO_LEVEL_VALUES[capturedLogLevel]
    expect(expectedLevel).toBeDefined()
    expect(foundLevel).toBe(expectedLevel!)
  })

  test('SSE client receives state:init on connect', async () => {
    const controller = new AbortController()
    const res = await fetch(`http://localhost:${TEST_PORT}/events`, { signal: controller.signal })
    const body = res.body
    expect(body).not.toBeNull()

    const chunks: string[] = []
    const decoder = new TextDecoder()
    const writable = new WritableStream<Uint8Array>({
      write(chunk): void {
        chunks.push(decoder.decode(chunk))
        controller.abort()
      },
    })

    try {
      await body!.pipeTo(writable, { signal: controller.signal })
    } catch {
      // Expected: AbortError from controller.abort()
    }

    const text = chunks.join('')
    expect(text).toContain('event: state:init')
    expect(text).toContain('"type":"state:init"')
  })

  test('GET /turns/:id returns 404 for unknown turnId', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/turns/nonexistent`)
    expect(res.status).toBe(404)
    await cancelBody(res)
  })

  test('GET /recurring returns 400 when userId is missing', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/recurring`)
    expect(res.status).toBe(400)
    const body = await res.text()
    expect(body).toContain('userId')
  })

  test('GET /recurring returns JSON array for valid userId', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/recurring?userId=test-user`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/json')
    const entries = assertArray(JSON.parse(await res.text()))
    expect(entries).toBeArray()
  })

  test('GET /deferred returns 400 when userId is missing', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/deferred`)
    expect(res.status).toBe(400)
    const body = await res.text()
    expect(body).toContain('userId')
  })

  test('GET /deferred returns JSON array for valid userId', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/deferred?userId=test-user`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/json')
    const entries = assertArray(JSON.parse(await res.text()))
    expect(entries).toBeArray()
  })

  test('GET /memos returns 400 when userId is missing', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/memos`)
    expect(res.status).toBe(400)
    const body = await res.text()
    expect(body).toContain('userId')
  })

  test('GET /memos returns JSON array for valid userId', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/memos?userId=test-user`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/json')
    const entries = assertArray(JSON.parse(await res.text()))
    expect(entries).toBeArray()
  })

  test('GET /memos supports state parameter', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/memos?userId=test-user&state=archived`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/json')
    const entries = assertArray(JSON.parse(await res.text()))
    expect(entries).toBeArray()
  })

  test('GET /identity returns 400 when userId is missing', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/identity`)
    expect(res.status).toBe(400)
    const body = await res.text()
    expect(body).toContain('userId')
  })

  test('GET /identity returns 404 for unknown user', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/identity?userId=nonexistent-user`)
    expect(res.status).toBe(404)
    await cancelBody(res)
  })

  test('GET /auth/groups returns JSON array', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/auth/groups`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/json')
    const entries = assertArray(JSON.parse(await res.text()))
    expect(entries).toBeArray()
  })

  test('POST /api/platform-instances is dispatched by debug server write gate when DEBUG_TOKEN is unset', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/platform-instances`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'telegram-main', type: 'telegram', config: { token: 'secret' } }),
    })

    expect(res.status).toBe(401)
    await cancelBody(res)
  })

  test('GET /api/platform-instances keeps server bearer gate when DEBUG_TOKEN is configured', async () => {
    process.env['DEBUG_TOKEN'] = 'server-test-token'

    const res = await fetch(`http://localhost:${TEST_PORT}/api/platform-instances`)

    expect(res.status).toBe(401)
    await cancelBody(res)
    delete process.env['DEBUG_TOKEN']
  })
})
