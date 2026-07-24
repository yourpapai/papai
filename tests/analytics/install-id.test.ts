// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  getOrCreateAnalyticsInstallId,
  resetInstallIdCacheForTesting,
} from '../../src/analytics/identity/install-id.js'
import * as schema from '../../src/db/schema.js'
import { setupTestDb } from '../utils/test-helpers.js'

describe('analytics install id', () => {
  beforeEach(async () => {
    await setupTestDb()
    resetInstallIdCacheForTesting()
  })

  test('creates a UUID on first call', () => {
    const id = getOrCreateAnalyticsInstallId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u)
  })

  test('returns the same UUID after restart', () => {
    const first = getOrCreateAnalyticsInstallId()
    resetInstallIdCacheForTesting()
    const second = getOrCreateAnalyticsInstallId()
    expect(second).toBe(first)
  })

  test('concurrent creation returns a single stable value', async () => {
    const values = await Promise.all(Array.from({ length: 10 }, () => Promise.resolve(getOrCreateAnalyticsInstallId())))
    const unique = new Set(values)
    expect(unique.size).toBe(1)
  })

  test('rejects a malformed stored value', async () => {
    const { getTestDb } = await import('../utils/test-helpers.js')
    const db = getTestDb()
    db.insert(schema.systemConfig)
      .values({ key: 'analytics_install_id', value: 'not-a-uuid', updatedAt: 1, updatedBy: 'test' })
      .run()

    expect(() => getOrCreateAnalyticsInstallId()).toThrow()
  })

  test('does not use hostname or database path as input', () => {
    const id = getOrCreateAnalyticsInstallId()
    expect(id).not.toContain('localhost')
    expect(id).not.toContain(':memory:')
  })
})
