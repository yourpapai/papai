// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  listProvisionalRecords,
  listMemoryRecords,
  saveMemoryRecord,
  searchMemoryRecords,
} from '../../src/long-term-memory/store.js'
import type { MemoryRecordInput } from '../../src/long-term-memory/types.js'
import { setupTestDb } from '../utils/test-helpers.js'

const NOW = '2026-07-15T12:00:00.000Z'

const record = (overrides: Partial<MemoryRecordInput>): MemoryRecordInput => ({
  id: 'mem-1',
  scopeId: 'user-1',
  scopeType: 'personal',
  kind: 'fact',
  content: 'deployment window is Tuesday',
  summary: null,
  tags: [],
  confidence: 1,
  status: 'active',
  source: 'explicit',
  evidence: {},
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  lastSeenAt: '2026-07-01T00:00:00.000Z',
  ...overrides,
})

const ids = (records: readonly { id: string }[]): readonly string[] => records.map((r) => r.id)

describe('query-time validity', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('excludes an expired but still-active record from listing', () => {
    saveMemoryRecord(record({ id: 'expired', expiresAt: '2026-07-15T11:59:59.999Z' }))
    saveMemoryRecord(record({ id: 'live', expiresAt: '2026-07-15T12:00:00.001Z' }))

    expect(ids(listMemoryRecords({ scopeId: 'user-1', scopeType: 'personal', status: 'active', now: NOW }))).toEqual([
      'live',
    ])
  })

  test('treats expiresAt exactly equal to now as expired', () => {
    saveMemoryRecord(record({ id: 'boundary', expiresAt: NOW }))

    expect(listMemoryRecords({ scopeId: 'user-1', scopeType: 'personal', status: 'active', now: NOW })).toEqual([])
  })

  test('validity is half-open: validFrom equal to now is included, validUntil equal to now is not', () => {
    saveMemoryRecord(record({ id: 'from-now', validFrom: NOW }))
    saveMemoryRecord(record({ id: 'until-now', validUntil: NOW }))
    saveMemoryRecord(record({ id: 'not-yet', validFrom: '2026-07-15T12:00:00.001Z' }))

    expect(ids(listMemoryRecords({ scopeId: 'user-1', scopeType: 'personal', status: 'active', now: NOW }))).toEqual([
      'from-now',
    ])
  })

  test('excludes an expired record from FTS search', () => {
    saveMemoryRecord(record({ id: 'expired', content: 'deployment window', expiresAt: '2026-07-01T00:00:00.000Z' }))

    expect(searchMemoryRecords({ scopeId: 'user-1', scopeType: 'personal', query: 'deployment', now: NOW })).toEqual([])
  })

  test('excludes an expired provisional record from provisional listing', () => {
    saveMemoryRecord(
      record({ id: 'prov', status: 'provisional', threadContextId: 't1', expiresAt: '2026-07-01T00:00:00.000Z' }),
    )

    expect(listProvisionalRecords({ scopeId: 'user-1', scopeType: 'personal', now: NOW })).toEqual([])
  })
})
