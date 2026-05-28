// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

import { SESSION_COOKIE_NAME } from '../../src/dashboard-auth/cookie.js'
import { mintSession } from '../../src/dashboard-auth/index.js'
import { setStoreDb } from '../../src/dashboard-auth/store.js'
import { migration046DashboardSessions } from '../../src/db/migrations/046_dashboard_sessions.js'
import { logBuffer } from '../../src/debug/log-buffer.js'
import { startDebugServer, stopDebugServer } from '../../src/debug/server.js'
import { restoreFetch } from '../utils/test-helpers.js'

const TEST_PORT = 19101
const PUBLIC_DIR = path.resolve(import.meta.dir, '../../public')

function ensurePublicBuilt(): void {
  const required = ['debug.js', 'debug.html', 'debug.css']
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

describe('debug-smoke', () => {
  let db: Database
  let cookieValue: string

  beforeAll(() => {
    ensurePublicBuilt()
    restoreFetch()
    db = new Database(':memory:')
    migration046DashboardSessions.up(db)
    setStoreDb(db)
    cookieValue = mintSession('test-admin', { secure: false }).cookieValue
    process.env['DEBUG_PORT'] = String(TEST_PORT)
    process.env['DEBUG_HOSTNAME'] = 'localhost'
    startDebugServer('test-admin')
  })

  afterAll(() => {
    stopDebugServer()
    setStoreDb(null)
    db.close()
    logBuffer.clear()
    delete process.env['DEBUG_PORT']
    delete process.env['DEBUG_HOSTNAME']
  })

  const authHeaders = (): Record<string, string> => ({ Cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` })

  describe('debug.js', () => {
    test('returns single IIFE bundle with JavaScript content type', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/debug.js`, { headers: authHeaders() })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('javascript')

      const body = await res.text()
      expect(body.length).toBeGreaterThan(0)

      // Should not contain ES module export/import statements that fail in browser
      expect(body).not.toContain('export *')
      expect(body).not.toContain('export {')
      expect(body).not.toContain('export default')
      expect(body).not.toMatch(/^import /mu)
      expect(body).not.toMatch(/^export /mu)
    })

    test('contains dashboard initialization code', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/debug.js`, { headers: authHeaders() })
      const body = await res.text()

      // Should mount the Svelte app and render the top-level panels
      expect(body).toContain('getElementById')
      expect(body).toContain('papai')
      expect(body).toContain('ui-topbar')
      expect(body).toContain('debug-grid')
      expect(body).toContain('log-explorer')
    })

    test('contains state management and SSE setup', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/debug.js`, { headers: authHeaders() })
      const body = await res.text()

      // Should have EventSource for SSE and handle state events
      expect(body).toContain('EventSource')
      expect(body).toContain('state:init')
      expect(body).toContain('log:entry')
    })
  })

  describe('debug.html', () => {
    test('loads the debug page with a Svelte mount point and bundle reference', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/debug`, { headers: authHeaders() })
      expect(res.status).toBe(200)

      const body = await res.text()

      // Should reference the single bundle and not the legacy split files
      expect(body).toContain('debug.js')
      expect(body).not.toContain('dashboard-ui.js')
      expect(body).not.toContain('dashboard-state.js')

      // Should contain the Svelte mount point
      expect(body).toContain('id="app"')
    })

    test('includes Content-Security-Policy meta tag', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/debug`, { headers: authHeaders() })
      const body = await res.text()

      expect(body).toContain('http-equiv="Content-Security-Policy"')
      expect(body).toContain("default-src 'self'")
    })
  })

  describe('debug.css', () => {
    test('returns CSS styling', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/debug.css`, { headers: authHeaders() })
      expect(res.status).toBe(200)

      const body = await res.text()

      // Should have basic CSS
      expect(body).toContain('{')
      expect(body).toContain('}')
    })
  })

  describe('JavaScript syntax validation', () => {
    test('debug.js can be parsed without syntax errors', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/debug.js`, { headers: authHeaders() })
      const body = await res.text()

      // Should be an IIFE (starts with `(` or `!`)
      expect(body).toMatch(/^[(!]/u)

      // Should not have ES module import/export statements that would fail in browser
      expect(body).not.toMatch(/^import /mu)
      expect(body).not.toMatch(/^export /mu)
      expect(body).not.toContain('export *')
      expect(body).not.toContain('export {')
      expect(body).not.toContain('export default')
    })
  })
})
