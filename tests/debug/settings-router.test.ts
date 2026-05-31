// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { routeSettingsPaths } from '../../src/debug/settings-router.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('routeSettingsPaths', () => {
  const original = process.env['SETTINGS_PUBLIC_BASE_URL']

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    process.env['SETTINGS_PUBLIC_BASE_URL'] = 'https://bot.example.com'
  })

  afterEach(() => {
    if (original === undefined) delete process.env['SETTINGS_PUBLIC_BASE_URL']
    else process.env['SETTINGS_PUBLIC_BASE_URL'] = original
  })

  test('returns null for non-settings paths', async () => {
    const req = new Request('https://x/debug')
    expect(await routeSettingsPaths(req, new URL(req.url))).toBeNull()
  })

  test('GET /settings/api/session is 401 without a session, even with a DEBUG_TOKEN bearer', async () => {
    process.env['DEBUG_TOKEN'] = 'operator-secret'
    const req = new Request('https://x/settings/api/session', {
      headers: { Authorization: 'Bearer operator-secret' },
    })
    const res = await routeSettingsPaths(req, new URL(req.url))
    expect(res?.status).toBe(401)
    delete process.env['DEBUG_TOKEN']
  })

  test('wrong method on a settings route returns 405', async () => {
    const req = new Request('https://x/settings/auth/exchange', { method: 'GET' })
    const res = await routeSettingsPaths(req, new URL(req.url))
    expect(res?.status).toBe(405)
  })

  test('unknown /settings subpath returns 404', async () => {
    const req = new Request('https://x/settings/nope')
    const res = await routeSettingsPaths(req, new URL(req.url))
    expect(res?.status).toBe(404)
  })
})
