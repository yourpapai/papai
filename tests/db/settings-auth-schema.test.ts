// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { settingsAuthCodes, settingsRateLimit, settingsSessions } from '../../src/db/settings-auth-schema.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('settings auth schema (migration 047)', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('settings_auth_codes round-trips a row', () => {
    const db = getDrizzleDb()
    db.insert(settingsAuthCodes)
      .values({
        codeHash: 'hash-1',
        platformInstanceId: 'pi-1',
        platformUserId: 'u-1',
        createdAt: 1,
        expiresAt: 2,
        usedAt: null,
      })
      .run()
    const row = db.select().from(settingsAuthCodes).get()
    expect(row?.platformUserId).toBe('u-1')
    expect(row?.usedAt).toBeNull()
  })

  test('settings_sessions round-trips a row', () => {
    const db = getDrizzleDb()
    db.insert(settingsSessions)
      .values({
        sessionIdHash: 'sid-1',
        platformInstanceId: 'pi-1',
        platformUserId: 'u-1',
        createdAt: 1,
        expiresAt: 2,
        csrfTokenHash: 'csrf-1',
      })
      .run()
    const row = db.select().from(settingsSessions).get()
    expect(row?.csrfTokenHash).toBe('csrf-1')
  })

  test('settings_rate_limit round-trips a row', () => {
    const db = getDrizzleDb()
    db.insert(settingsRateLimit).values({ bucket: 'issue', actorId: 'a-1', windowStart: 0, count: 1 }).run()
    const row = db.select().from(settingsRateLimit).get()
    expect(row?.count).toBe(1)
  })
})
