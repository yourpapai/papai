// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { users } from '../../src/db/schema.js'
import {
  BILLING_DETAIL_LIMIT,
  getBillingDetail,
  listBillingSubjects,
  parseWindow,
  windowToMs,
} from '../../src/debug/billing.js'
import { recordUsage, type UsageEvent } from '../../src/usage/recorder.js'
import { getTestDb, mockLogger, setupTestDb } from '../utils/test-helpers.js'

const NOW = 1_700_000_000_000
const ONE_DAY_MS = 24 * 60 * 60 * 1000

const seed = (overrides: Partial<UsageEvent>): void => {
  recordUsage({
    occurredAt: NOW,
    turnId: 'turn',
    storageContextId: 'ctx',
    contextType: 'dm',
    chatUserId: 'user',
    model: 'm',
    modelRole: 'main',
    inputTokens: 10,
    outputTokens: 20,
    stepCount: 1,
    toolCallCount: 0,
    messageCount: 1,
    finishReason: 'stop',
    durationMs: 100,
    responseId: 'resp',
    error: null,
    ...overrides,
  })
}

const insertUser = (platformUserId: string, username: string | null): void => {
  getTestDb()
    .insert(users)
    .values({
      platformUserId,
      username,
      addedBy: 'test',
      addedAt: new Date(NOW).toISOString(),
    })
    .run()
}

describe('parseWindow', () => {
  test('accepts the four whitelisted values', () => {
    expect(parseWindow('24h')).toBe('24h')
    expect(parseWindow('7d')).toBe('7d')
    expect(parseWindow('30d')).toBe('30d')
    expect(parseWindow('all')).toBe('all')
  })

  test('returns 30d as the default when input is null', () => {
    expect(parseWindow(null)).toBe('30d')
  })

  test('returns null for any other value', () => {
    expect(parseWindow('foo')).toBeNull()
    expect(parseWindow('')).toBeNull()
    expect(parseWindow('1d')).toBeNull()
    expect(parseWindow('30D')).toBeNull()
  })
})

describe('windowToMs', () => {
  test('maps the four windows to milliseconds', () => {
    expect(windowToMs('24h')).toBe(24 * 60 * 60 * 1000)
    expect(windowToMs('7d')).toBe(7 * 24 * 60 * 60 * 1000)
    expect(windowToMs('30d')).toBe(30 * 24 * 60 * 60 * 1000)
    expect(windowToMs('all')).toBeNull()
  })
})

describe('listBillingSubjects', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns an empty array when no usage rows exist', () => {
    expect(listBillingSubjects('all')).toEqual([])
  })

  test('resolves display name for DM subjects from users.username', () => {
    insertUser('user-A', 'alice')
    insertUser('user-B', 'bob')
    seed({ storageContextId: 'user-A', contextType: 'dm', chatUserId: 'user-A' })
    seed({ storageContextId: 'user-B', contextType: 'dm', chatUserId: 'user-B' })

    const subjects = listBillingSubjects('all')
    const a = subjects.find((s) => s.storageContextId === 'user-A')
    const b = subjects.find((s) => s.storageContextId === 'user-B')
    expect(a?.displayName).toBe('alice')
    expect(b?.displayName).toBe('bob')
  })

  test('returns null displayName for DM subjects with no matching users row', () => {
    seed({ storageContextId: 'lonely-user', contextType: 'dm', chatUserId: 'lonely-user' })
    const subjects = listBillingSubjects('all')
    expect(subjects).toHaveLength(1)
    expect(subjects[0]?.displayName).toBeNull()
  })

  test('returns null displayName for DM subjects whose username is null', () => {
    insertUser('user-A', null)
    seed({ storageContextId: 'user-A', contextType: 'dm', chatUserId: 'user-A' })
    const subjects = listBillingSubjects('all')
    expect(subjects[0]?.displayName).toBeNull()
  })

  test('returns null displayName for group subjects in v1', () => {
    seed({ storageContextId: 'group-123', contextType: 'group', chatUserId: 'user-A' })
    seed({ storageContextId: 'group-456:thread-1', contextType: 'group', chatUserId: 'user-B' })
    const subjects = listBillingSubjects('all')
    for (const s of subjects) {
      expect(s.displayName).toBeNull()
    }
  })

  test('filters by window', () => {
    const now = Date.now()
    seed({ storageContextId: 'ctx-fresh', occurredAt: now - 1000, chatUserId: 'user-A' })
    seed({ storageContextId: 'ctx-stale', occurredAt: now - 10 * ONE_DAY_MS, chatUserId: 'user-B' })

    const fresh = listBillingSubjects('24h')
    expect(fresh.map((s) => s.storageContextId)).toEqual(['ctx-fresh'])

    const all = listBillingSubjects('all')
    expect(all.map((s) => s.storageContextId).sort()).toEqual(['ctx-fresh', 'ctx-stale'])
  })
})

describe('getBillingDetail', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns null when no rows exist for the subject', () => {
    expect(getBillingDetail('missing', 'all')).toBeNull()
  })

  test('returns subject + requests + truncated=false when row count is within limit', () => {
    seed({ storageContextId: 'ctx-A', occurredAt: NOW - 1000 })
    seed({ storageContextId: 'ctx-A', occurredAt: NOW - 500 })
    seed({ storageContextId: 'ctx-A', occurredAt: NOW })
    // Other subject; should not leak in
    seed({ storageContextId: 'ctx-B', occurredAt: NOW })

    const detail = getBillingDetail('ctx-A', 'all')
    expect(detail).not.toBeNull()
    expect(detail?.subject.storageContextId).toBe('ctx-A')
    expect(detail?.requests).toHaveLength(3)
    expect(detail?.truncated).toBe(false)
  })

  test('orders requests by occurredAt descending', () => {
    seed({ storageContextId: 'ctx-A', occurredAt: 100 })
    seed({ storageContextId: 'ctx-A', occurredAt: 300 })
    seed({ storageContextId: 'ctx-A', occurredAt: 200 })

    const detail = getBillingDetail('ctx-A', 'all')
    expect(detail?.requests.map((r) => r.occurredAt)).toEqual([300, 200, 100])
  })

  test('caps the returned requests at BILLING_DETAIL_LIMIT and sets truncated=true', () => {
    const total = BILLING_DETAIL_LIMIT + 5
    for (let i = 0; i < total; i++) seed({ storageContextId: 'ctx-big', occurredAt: NOW - i })

    const detail = getBillingDetail('ctx-big', 'all')
    expect(detail).not.toBeNull()
    expect(detail?.requests).toHaveLength(BILLING_DETAIL_LIMIT)
    expect(detail?.truncated).toBe(true)
  })

  test('filters by window', () => {
    const now = Date.now()
    seed({ storageContextId: 'ctx-A', occurredAt: now - 1000 })
    seed({ storageContextId: 'ctx-A', occurredAt: now - 10 * ONE_DAY_MS })

    const fresh = getBillingDetail('ctx-A', '24h')
    expect(fresh?.requests).toHaveLength(1)

    const all = getBillingDetail('ctx-A', 'all')
    expect(all?.requests).toHaveLength(2)
  })

  test('resolves displayName on the detail subject', () => {
    insertUser('user-A', 'alice')
    seed({ storageContextId: 'user-A', contextType: 'dm', chatUserId: 'user-A' })

    const detail = getBillingDetail('user-A', 'all')
    expect(detail?.subject.displayName).toBe('alice')
  })
})
