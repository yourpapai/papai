// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  BUILTIN_HTTP_ROUTES,
  DEFAULT_WEB_SERVER_ROUTE_OPTIONS,
  isDebugOnlyPath,
  listRoutes,
  resolveWebServerStartOptions,
} from '../../src/debug/server-route-options.js'

describe('server-route-options', () => {
  test('resolveWebServerStartOptions accepts a string shorthand as the log level with debug enabled', () => {
    const resolved = resolveWebServerStartOptions('debug', 'info')
    expect(resolved).toEqual({ debugEnabled: true, logLevel: 'debug' })
  })

  test('resolveWebServerStartOptions falls back to defaults when options are absent', () => {
    const resolved = resolveWebServerStartOptions(undefined, 'info')
    expect(resolved).toEqual({ debugEnabled: true, logLevel: 'info' })
  })

  test('isDebugOnlyPath matches the static debug-only path set and /turns/ prefix', () => {
    expect(isDebugOnlyPath('/debug')).toBe(true)
    expect(isDebugOnlyPath('/turns/abc')).toBe(true)
    expect(isDebugOnlyPath('/settings')).toBe(false)
  })

  test('DEFAULT_WEB_SERVER_ROUTE_OPTIONS enables debug by default', () => {
    expect(DEFAULT_WEB_SERVER_ROUTE_OPTIONS.debugEnabled).toBe(true)
  })
})

describe('BUILTIN_HTTP_ROUTES', () => {
  test('is a non-empty array of pathnames', () => {
    expect(Array.isArray(BUILTIN_HTTP_ROUTES)).toBe(true)
    expect(BUILTIN_HTTP_ROUTES.length).toBeGreaterThan(0)
  })

  test('covers the SSE / log surface the LLM commonly references', () => {
    for (const path of ['/events', '/logs', '/logs/stats', '/logs/scopes']) {
      expect(BUILTIN_HTTP_ROUTES).toContain(path)
    }
  })

  test('covers MCP / billing / stats / admin routes', () => {
    for (const path of ['/mcp/status', '/billing/subjects', '/stats/global', '/admin/identity/mappings']) {
      expect(BUILTIN_HTTP_ROUTES).toContain(path)
    }
  })

  test('covers the surface shells served to operators and users', () => {
    for (const path of ['/debug', '/admin', '/settings']) {
      expect(BUILTIN_HTTP_ROUTES).toContain(path)
    }
  })

  test('covers the recurring / deferred / memos / identity data routes', () => {
    for (const path of ['/recurring', '/deferred', '/memos', '/identity']) {
      expect(BUILTIN_HTTP_ROUTES).toContain(path)
    }
  })

  test('every entry starts with /', () => {
    for (const path of BUILTIN_HTTP_ROUTES) {
      expect(path.startsWith('/')).toBe(true)
    }
  })
})

describe('listRoutes', () => {
  test('returns a non-empty readonly string array for the closure verifier', () => {
    const routes = listRoutes()
    expect(Array.isArray(routes)).toBe(true)
    expect(routes.length).toBeGreaterThan(0)
  })

  test('includes the spot-checked pathnames', () => {
    const routes = listRoutes()
    expect(routes).toContain('/events')
    expect(routes).toContain('/logs')
    expect(routes).toContain('/mcp/status')
  })

  test('returns the same contents as BUILTIN_HTTP_ROUTES', () => {
    expect(listRoutes()).toEqual(BUILTIN_HTTP_ROUTES)
  })
})
