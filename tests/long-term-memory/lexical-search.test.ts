// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { searchLexical } from '../../src/long-term-memory/lexical-search.js'
import { saveMemoryRecord } from '../../src/long-term-memory/store.js'
import type { MemoryRecordInput } from '../../src/long-term-memory/types.js'
import { setupTestDb } from '../utils/test-helpers.js'

const NOW = '2026-07-15T12:00:00.000Z'
const SCOPE = { scopeId: 'user-1', scopeType: 'personal' } as const

const record = (overrides: Partial<MemoryRecordInput>): MemoryRecordInput => ({
  id: 'mem-1',
  scopeId: 'user-1',
  scopeType: 'personal',
  kind: 'fact',
  content: 'placeholder',
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

describe('searchLexical', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('finds an inflected Cyrillic record from an uninflected query', () => {
    saveMemoryRecord(record({ id: 'ru', content: 'Маршруты доставки согласованы' }))

    const hits = searchLexical({ ...SCOPE, query: 'маршрут', statuses: ['active'], now: NOW })

    expect(ids(hits)).toEqual(['ru'])
  })

  test('returns nothing when the query has no tokens', () => {
    saveMemoryRecord(record({ id: 'any', content: 'anything at all' }))

    expect(searchLexical({ ...SCOPE, query: '?!.,', statuses: ['active'], now: NOW })).toEqual([])
  })

  test('excludes other scopes', () => {
    saveMemoryRecord(record({ id: 'mine', content: 'shared secret plan' }))
    saveMemoryRecord(record({ id: 'theirs', scopeId: 'user-2', content: 'shared secret plan' }))

    expect(ids(searchLexical({ ...SCOPE, query: 'secret', statuses: ['active'], now: NOW }))).toEqual(['mine'])
  })

  test('excludes an expired record', () => {
    saveMemoryRecord(record({ id: 'gone', content: 'expired plan', expiresAt: '2026-07-01T00:00:00.000Z' }))

    expect(searchLexical({ ...SCOPE, query: 'plan', statuses: ['active'], now: NOW })).toEqual([])
  })

  test('filters by status and kind', () => {
    saveMemoryRecord(record({ id: 'act', content: 'rollout plan', status: 'active', kind: 'fact' }))
    saveMemoryRecord(record({ id: 'prov', content: 'rollout plan', status: 'provisional', kind: 'fact' }))
    saveMemoryRecord(record({ id: 'pref', content: 'rollout plan', status: 'active', kind: 'preference' }))

    expect(ids(searchLexical({ ...SCOPE, query: 'rollout', statuses: ['active'], kind: 'fact', now: NOW }))).toEqual([
      'act',
    ])
    expect(ids(searchLexical({ ...SCOPE, query: 'rollout', statuses: ['provisional'], now: NOW }))).toEqual(['prov'])
  })

  test('excludes a named thread when excludeThreadContextId is set', () => {
    saveMemoryRecord(record({ id: 'here', content: 'thread note', status: 'provisional', threadContextId: 't1' }))
    saveMemoryRecord(record({ id: 'there', content: 'thread note', status: 'provisional', threadContextId: 't2' }))

    const hits = searchLexical({
      ...SCOPE,
      query: 'thread',
      statuses: ['provisional'],
      excludeThreadContextId: 't1',
      now: NOW,
    })

    expect(ids(hits)).toEqual(['there'])
  })

  test('ranks the denser match first', () => {
    saveMemoryRecord(record({ id: 'weak', content: 'a long note about many unrelated topics and one plan mention' }))
    saveMemoryRecord(record({ id: 'strong', content: 'plan' }))

    const hits = searchLexical({ ...SCOPE, query: 'plan', statuses: ['active'], now: NOW })

    expect(hits[0]?.id).toBe('strong')
  })
})
