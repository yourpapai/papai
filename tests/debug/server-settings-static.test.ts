// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { routeRequestForTest, routeSettingsStatic } from '../../src/debug/server.js'

describe('routeSettingsStatic', () => {
  test('serves the settings shell for /settings', () => {
    const res = routeSettingsStatic('/settings')
    expect(res).not.toBeNull()
    expect(res!.status).toBe(200)
    expect(res!.headers.get('Content-Type')).toContain('html')
  })

  test('serves the settings JS bundle with a JS content type', () => {
    const res = routeSettingsStatic('/settings.js')
    expect(res).not.toBeNull()
    expect(res!.headers.get('Content-Type')).toContain('javascript')
  })

  test('serves the settings CSS bundle', () => {
    const res = routeSettingsStatic('/settings.css')
    expect(res).not.toBeNull()
    expect(res!.status).toBe(200)
    expect(res!.headers.get('Content-Type')).toContain('css')
  })

  test('returns null for non-static settings paths', () => {
    expect(routeSettingsStatic('/settings/api/bootstrap')).toBeNull()
    expect(routeSettingsStatic('/settings/auth/exchange')).toBeNull()
    expect(routeSettingsStatic('/debug')).toBeNull()
  })
})

describe('routeRequestForTest debug gating', () => {
  test('serves settings static routes when debug routes are disabled', async () => {
    const res = await routeRequestForTest(new Request('http://bot.test/settings'), { debugEnabled: false })
    expect(res.status).toBe(200)
  })

  test.each(['/debug', '/debug.js', '/debug.css', '/events', '/logs', '/logs/stats', '/turns/abc123'])(
    'returns 404 for debug-only route %s when debug routes are disabled',
    async (pathname) => {
      const res = await routeRequestForTest(new Request(`http://bot.test${pathname}`), { debugEnabled: false })
      expect(res.status).toBe(404)
      await res.body?.cancel()
    },
  )
})
