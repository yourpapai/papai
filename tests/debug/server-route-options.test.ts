// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
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

  test('listRoutes returns a readonly string array (currently empty) for the closure verifier', () => {
    const routes = listRoutes()
    expect(Array.isArray(routes)).toBe(true)
    expect(routes.length).toBe(0)
  })
})
