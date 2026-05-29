// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { routeSettingsStatic } from '../../src/debug/server.js'

describe('routeSettingsStatic', () => {
  test('serves the settings shell for /settings', () => {
    const res = routeSettingsStatic('/settings')
    expect(res).not.toBeNull()
    expect(res!.status).toBe(200)
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
  })

  test('returns null for non-static settings paths', () => {
    expect(routeSettingsStatic('/settings/api/bootstrap')).toBeNull()
    expect(routeSettingsStatic('/settings/auth/exchange')).toBeNull()
    expect(routeSettingsStatic('/debug')).toBeNull()
  })
})
