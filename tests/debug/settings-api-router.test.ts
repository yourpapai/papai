// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { routeSettingsApi } from '../../src/debug/settings-api-router.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('routeSettingsApi', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns null for an unowned subpath', async () => {
    const res = await routeSettingsApi(
      new Request('https://x/settings/api/nope'),
      new URL('https://x/settings/api/nope'),
    )
    expect(res).toBeNull()
  })

  test('returns 401 for an owned route without a session', async () => {
    const res = await routeSettingsApi(
      new Request('https://x/settings/api/config?contextId=c'),
      new URL('https://x/settings/api/config?contextId=c'),
    )
    expect(res).not.toBeNull()
    expect(res?.status).toBe(401)
  })

  test('routes /settings/api/context/task-instance (401 without a session)', async () => {
    const res = await routeSettingsApi(
      new Request('https://x/settings/api/context/task-instance'),
      new URL('https://x/settings/api/context/task-instance'),
    )
    expect(res).not.toBeNull()
    expect(res?.status).toBe(401)
  })
})
