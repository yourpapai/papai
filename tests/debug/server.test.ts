import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { logBuffer, logBufferStream } from '../../src/debug/log-buffer.js'
import { startDebugServer, stopDebugServer } from '../../src/debug/server.js'
import { getLogLevel, logMultistream } from '../../src/logger.js'
import { restoreFetch } from '../utils/test-helpers.js'

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
  const required = ['dashboard.js', 'dashboard.html', 'dashboard.css']
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
  assert(Array.isArray(value), 'expected array')
  return value
}

/**
 * Narrow a log entry to an object that has the given key; return the value at
 * that key so callers never need to use index-signature dot access.
 */
function assertLogEntryKey(entry: unknown, key: string): unknown {
  assert(typeof entry === 'object' && entry !== null, 'expected log entry to be an object')
  assert(key in entry, `expected log entry to have key "${key}"`)
  return Reflect.get(entry, key)
}

/**
 * Find the level value registered for logBufferStream inside logMultistream.
 * Returns `undefined` if the stream is not present.
 */
function findBufferStreamLevel(multistream: unknown, target: unknown): unknown {
  assert(typeof multistream === 'object' && multistream !== null, 'expected multistream to be an object')
  const streams = assertArray(Reflect.get(multistream, 'streams'))
  for (const entry of streams) {
    assert(typeof entry === 'object' && entry !== null, 'expected stream entry to be an object')
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

describe('debug-server', () => {
  let capturedLogLevel: string

  beforeAll(() => {
    ensurePublicBuilt()
    restoreFetch()
    process.env['DEBUG_PORT'] = String(TEST_PORT)
    // Capture the log level and pass it explicitly to avoid mock-binding interference
    capturedLogLevel = getLogLevel()
    startDebugServer('test-admin', capturedLogLevel)
    seedLogBuffer()
  })

  afterAll(() => {
    stopDebugServer()
    logBuffer.clear()
    delete process.env['DEBUG_PORT']
  })

  test('GET /dashboard returns dashboard HTML', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/dashboard`)
    expect(res.status).toBe(200)
    const ct = res.headers.get('content-type')
    expect(ct).toContain('text/html')
    const body = await res.text()
    expect(body).toContain('<html')
    expect(body).toContain('papai debug')
  })

  test('GET /dashboard.css returns CSS', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/dashboard.css`)
    expect(res.status).toBe(200)
    const ct = res.headers.get('content-type')
    expect(ct).toContain('text/css')
    const body = await res.text()
    expect(body).toContain('#log-explorer')
  })

  test('GET /dashboard.js returns JavaScript bundle from public/', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/dashboard.js`)
    expect(res.status).toBe(200)
    const ct = res.headers.get('content-type')
    expect(ct).toContain('javascript')
    const body = await res.text()
    expect(body.length).toBeGreaterThan(0)
  })

  test('GET /dashboard-state.js returns 404 (legacy route removed)', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/dashboard-state.js`)
    expect(res.status).toBe(404)
    await res.body?.cancel()
  })

  test('GET /dashboard-ui.js returns 404 (legacy route removed)', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/dashboard-ui.js`)
    expect(res.status).toBe(404)
    await res.body?.cancel()
  })

  test('GET /dashboard.xyz returns 404', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/dashboard.xyz`)
    expect(res.status).toBe(404)
    await res.body?.cancel()
  })

  test('GET /events returns SSE headers', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/events`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    expect(res.headers.get('cache-control')).toBe('no-cache')
    // Abort the stream to clean up
    await res.body?.cancel()
  })

  test('unknown route returns 404', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/nonexistent`)
    expect(res.status).toBe(404)
    await res.body?.cancel()
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
})
