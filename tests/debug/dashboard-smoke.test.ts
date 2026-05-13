import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

import { logBuffer } from '../../src/debug/log-buffer.js'
import { startDebugServer, stopDebugServer } from '../../src/debug/server.js'
import { restoreFetch } from '../utils/test-helpers.js'

const TEST_PORT = 19101
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

describe('dashboard-smoke', () => {
  beforeAll(() => {
    ensurePublicBuilt()
    restoreFetch()
    process.env['DEBUG_PORT'] = String(TEST_PORT)
    startDebugServer('test-admin')
  })

  afterAll(() => {
    stopDebugServer()
    logBuffer.clear()
    delete process.env['DEBUG_PORT']
  })

  describe('dashboard.js', () => {
    test('returns single IIFE bundle with JavaScript content type', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/dashboard.js`)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('javascript')

      const body = await res.text()
      expect(body.length).toBeGreaterThan(0)

      // Should not contain ES module export/import statements that fail in browser
      expect(body).not.toContain('export *')
      expect(body).not.toContain('export {')
      expect(body).not.toContain('export default')
      expect(body).not.toMatch(/^import /m)
      expect(body).not.toMatch(/^export /m)
    })

    test('contains dashboard initialization code', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/dashboard.js`)
      const body = await res.text()

      // Should expose the dashboard global and wire DOM
      expect(body).toContain('window.dashboard')
      expect(body).toContain('getElementById')
      expect(body).toContain('connection-status')
      expect(body).toContain('renderLogs')
    })

    test('contains state management and SSE setup', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/dashboard.js`)
      const body = await res.text()

      // Should have EventSource for SSE and handle state events
      expect(body).toContain('EventSource')
      expect(body).toContain('state:init')
      expect(body).toContain('log:entry')
    })
  })

  describe('dashboard.html', () => {
    test('loads the dashboard page with single script reference', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/dashboard`)
      expect(res.status).toBe(200)

      const body = await res.text()

      // Should reference the single bundle and not the legacy split files
      expect(body).toContain('dashboard.js')
      expect(body).not.toContain('dashboard-ui.js')
      expect(body).not.toContain('dashboard-state.js')

      // Should have all required DOM elements
      expect(body).toContain('id="connection-status"')
      expect(body).toContain('id="session-list"')
      expect(body).toContain('id="log-entries"')
      expect(body).toContain('id="trace-list"')
    })
  })

  describe('dashboard.css', () => {
    test('returns CSS styling', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/dashboard.css`)
      expect(res.status).toBe(200)

      const body = await res.text()

      // Should have basic CSS
      expect(body).toContain('{')
      expect(body).toContain('}')
    })
  })

  describe('JavaScript syntax validation', () => {
    test('dashboard.js can be parsed without syntax errors', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/dashboard.js`)
      const body = await res.text()

      // Should be an IIFE (starts with `(` or `!`)
      expect(body).toMatch(/^[(!]/)

      // Should not have ES module import/export statements that would fail in browser
      expect(body).not.toMatch(/^import /m)
      expect(body).not.toMatch(/^export /m)
      expect(body).not.toContain('export *')
      expect(body).not.toContain('export {')
      expect(body).not.toContain('export default')
    })
  })
})
