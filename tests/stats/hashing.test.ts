// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { sql } from 'drizzle-orm'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { systemConfig } from '../../src/db/schema.js'
import {
  STATS_ANONYMITY_SALT_KEY,
  getStatsAnonymitySalt,
  keyedHash,
  resetStatsSaltCacheForTesting,
} from '../../src/stats/hashing.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('stats hashing', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    resetStatsSaltCacheForTesting()
  })

  test('getStatsAnonymitySalt lazily creates a salt on first call', () => {
    const before = getDrizzleDb()
      .select()
      .from(systemConfig)
      .where(sql`${systemConfig.key} = ${STATS_ANONYMITY_SALT_KEY}`)
      .all()
    expect(before).toHaveLength(0)

    const salt = getStatsAnonymitySalt()

    expect(salt).toBeTruthy()
    expect(salt.length).toBeGreaterThanOrEqual(32)

    const after = getDrizzleDb()
      .select()
      .from(systemConfig)
      .where(sql`${systemConfig.key} = ${STATS_ANONYMITY_SALT_KEY}`)
      .all()
    expect(after).toHaveLength(1)
    expect(after[0]?.value).toBe(salt)
  })

  test('getStatsAnonymitySalt returns the same salt across calls', () => {
    const first = getStatsAnonymitySalt()
    const second = getStatsAnonymitySalt()

    expect(second).toBe(first)
  })

  test('keyedHash is deterministic for the same input', () => {
    const a = keyedHash('hostname:example.com')
    const b = keyedHash('hostname:example.com')

    expect(a).toBe(b)
  })

  test('keyedHash returns different values for different inputs', () => {
    const a = keyedHash('hostname:example.com')
    const b = keyedHash('hostname:other.com')

    expect(a).not.toBe(b)
  })

  test('keyedHash output is a hex string of length 64 (SHA-256)', () => {
    const hash = keyedHash('any-input')

    expect(hash).toMatch(/^[0-9a-f]{64}$/u)
  })

  test('keyedHash output depends on the salt', () => {
    const beforeSalt = getStatsAnonymitySalt()
    const beforeHash = keyedHash('hostname:example.com')

    // Rotate the salt by clearing and reseeding.
    getDrizzleDb()
      .delete(systemConfig)
      .where(sql`${systemConfig.key} = ${STATS_ANONYMITY_SALT_KEY}`)
      .run()
    resetStatsSaltCacheForTesting()

    const afterSalt = getStatsAnonymitySalt()
    const afterHash = keyedHash('hostname:example.com')

    expect(afterSalt).not.toBe(beforeSalt)
    expect(afterHash).not.toBe(beforeHash)
  })
})
