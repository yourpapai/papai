// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { memoryFacts, memoryProfiles, memoryRecords, memorySummary } from '../../src/db/schema.js'
import { purgeMemoryRecord } from '../../src/long-term-memory/purge.js'
import { profileScopeCondition } from '../../src/long-term-memory/record-conditions.js'
import {
  getMemoryProfile,
  listProvisionalRecords,
  saveMemoryProfile,
  saveMemoryRecord,
} from '../../src/long-term-memory/store.js'
import type { MemoryRecordInput, MemoryScope } from '../../src/long-term-memory/types.js'
import { loadSummary } from '../../src/memory.js'
import { setupTestDb } from '../utils/test-helpers.js'

const NOW = '2026-07-25T12:00:00.000Z'

const record = (scope: MemoryScope, id: string, content: string): MemoryRecordInput => ({
  id,
  scopeId: scope.scopeId,
  scopeType: scope.scopeType,
  kind: 'fact',
  content,
  summary: null,
  tags: [],
  confidence: 1,
  status: 'active',
  source: 'explicit',
  evidence: {},
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  lastSeenAt: '2026-07-01T00:00:00.000Z',
})

const seedSummary = (key: string, text: string): void => {
  getDrizzleDb()
    .insert(memorySummary)
    .values({ userId: key, summary: text, updatedAt: '2026-07-01T00:00:00.000Z' })
    .run()
}

const summaryRowCount = (key: string): number =>
  getDrizzleDb()
    .select()
    .from(memorySummary)
    .all()
    .filter((row) => row.userId === key).length

describe('purgeMemoryRecord — derived-memory contamination', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('stamps contaminated_at on the scope profile', () => {
    const scope: MemoryScope = { scopeId: 'dm-1', scopeType: 'personal' }
    saveMemoryProfile(scope, 'User lives in Berlin', '2026-07-01T00:00:00.000Z')
    saveMemoryRecord(record(scope, 'mem-1', 'User lives in Berlin'))

    expect(getMemoryProfile(scope)?.contaminatedAt).toBeNull()
    expect(purgeMemoryRecord(scope, 'mem-1', NOW)).toBe(true)
    expect(getMemoryProfile(scope)?.contaminatedAt).toBe(NOW)
  })

  test('does not create a profile row for a scope that has none', () => {
    const scope: MemoryScope = { scopeId: 'dm-2', scopeType: 'personal' }
    saveMemoryRecord(record(scope, 'mem-2', 'User lives in Berlin'))

    expect(purgeMemoryRecord(scope, 'mem-2', NOW)).toBe(true)
    expect(getDrizzleDb().select().from(memoryProfiles).where(profileScopeCondition(scope)).get()).toBeUndefined()
  })

  test('deletes the summary for the scope key and its thread sub-keys', () => {
    const scope: MemoryScope = { scopeId: 'grp-1', scopeType: 'group' }
    seedSummary('grp-1', 'The user lives in Berlin.')
    seedSummary('grp-1:thread:42', 'Berlin came up again in this thread.')
    seedSummary('grp-2', 'A different group entirely.')
    saveMemoryRecord(record(scope, 'mem-3', 'User lives in Berlin'))

    expect(purgeMemoryRecord(scope, 'mem-3', NOW)).toBe(true)

    expect(summaryRowCount('grp-1')).toBe(0)
    expect(summaryRowCount('grp-1:thread:42')).toBe(0)
    // an unrelated scope is untouched
    expect(summaryRowCount('grp-2')).toBe(1)
  })

  test('evicts the summary cache so the next turn cannot serve stale prose', () => {
    const scope: MemoryScope = { scopeId: 'dm-3', scopeType: 'personal' }
    seedSummary('dm-3', 'The user lives in Berlin.')
    saveMemoryRecord(record(scope, 'mem-4', 'User lives in Berlin'))

    // populate the cache from the DB the way a live turn would
    expect(loadSummary('dm-3')).toBe('The user lives in Berlin.')

    expect(purgeMemoryRecord(scope, 'mem-4', NOW)).toBe(true)
    expect(loadSummary('dm-3')).toBeNull()
  })

  test('leaves derived memory alone when no record matched', () => {
    const scope: MemoryScope = { scopeId: 'dm-4', scopeType: 'personal' }
    saveMemoryProfile(scope, 'User lives in Berlin', '2026-07-01T00:00:00.000Z')
    seedSummary('dm-4', 'The user lives in Berlin.')

    expect(purgeMemoryRecord(scope, 'no-such-record', NOW)).toBe(false)
    expect(getMemoryProfile(scope)?.contaminatedAt).toBeNull()
    expect(summaryRowCount('dm-4')).toBe(1)
  })

  test('sweeps a provisional twin of the purged content, case and spacing insensitive', () => {
    const scope: MemoryScope = { scopeId: 'dm-sweep', scopeType: 'personal' }
    saveMemoryRecord(record(scope, 'mem-active', 'User lives in Berlin'))
    saveMemoryRecord({
      ...record(scope, 'mem-provisional', 'user   LIVES in berlin'),
      status: 'provisional',
      source: 'background',
    })

    expect(purgeMemoryRecord(scope, 'mem-active', NOW)).toBe(true)

    // both rows are gone from the canonical table, not merely hidden
    expect(getDrizzleDb().select().from(memoryRecords).all()).toHaveLength(0)
    // ...so the promotion sweep has nothing left to promote back to active
    expect(listProvisionalRecords({ ...scope, limit: 10 })).toHaveLength(0)
  })

  test('leaves records in other scopes alone even when the content matches', () => {
    const mine: MemoryScope = { scopeId: 'dm-mine', scopeType: 'personal' }
    const theirs: MemoryScope = { scopeId: 'grp-theirs', scopeType: 'group' }
    saveMemoryRecord(record(mine, 'mem-mine', 'User lives in Berlin'))
    saveMemoryRecord(record(theirs, 'mem-theirs', 'User lives in Berlin'))

    expect(purgeMemoryRecord(mine, 'mem-mine', NOW)).toBe(true)

    const surviving = getDrizzleDb().select().from(memoryRecords).all()
    expect(surviving.map((row) => row.id)).toEqual(['mem-theirs'])
  })

  test('leaves the web-fetch fact cache alone — it is not derived from memory records', () => {
    const scope: MemoryScope = { scopeId: 'dm-facts', scopeType: 'personal' }
    saveMemoryRecord(record(scope, 'mem-1', 'User lives in Berlin'))
    getDrizzleDb()
      .insert(memoryFacts)
      .values({
        userId: scope.scopeId,
        identifier: 'https://example.com/a',
        title: 'A page the user fetched',
        url: 'https://example.com/a',
        lastSeen: '2026-07-01T00:00:00.000Z',
      })
      .run()

    expect(purgeMemoryRecord(scope, 'mem-1', NOW)).toBe(true)

    expect(getDrizzleDb().select().from(memoryFacts).all()).toHaveLength(1)
  })
})
