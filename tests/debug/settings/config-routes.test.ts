// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// NOTE: This file is a placeholder for Task 2's stub. The full test suite for
// config-routes is written in Task 4, which replaces the stub with the real handler.

import { beforeEach, describe, expect, test } from 'bun:test'

import { handleConfigRoutes } from '../../../src/debug/settings/config-routes.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'

describe('settings config routes (stub)', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns 401 without a session', async () => {
    const res = await handleConfigRoutes(
      new Request('https://x/settings/api/config'),
      new URL('https://x/settings/api/config'),
    )
    expect(res.status).toBe(401)
  })
})
