// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { userIdentityMappings } from '../../src/db/schema.js'
import { identityForSubject } from '../../src/stats/per-table-subject.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('identityForSubject', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns empty record when subject has no mappings', () => {
    expect(identityForSubject('nobody')).toEqual({})
  })

  test('returns mapping counts grouped by provider name', () => {
    getDrizzleDb()
      .insert(userIdentityMappings)
      .values([
        { contextId: 'u1', providerName: 'kaneo', providerUserId: 'k1', matchedAt: '2026-01-01T00:00:00Z' },
        { contextId: 'u1', providerName: 'youtrack', providerUserId: 'y1', matchedAt: '2026-01-02T00:00:00Z' },
        { contextId: 'other', providerName: 'kaneo', providerUserId: 'k2', matchedAt: '2026-01-03T00:00:00Z' },
      ])
      .run()

    const result = identityForSubject('u1')

    expect(result).toEqual({ kaneo: 1, youtrack: 1 })
  })
})
