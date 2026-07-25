// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { memoryProfiles, memorySummary } from '../../src/db/schema.js'
import { purgeMemoryRecord } from '../../src/long-term-memory/purge.js'
import { profileScopeCondition } from '../../src/long-term-memory/record-conditions.js'
import { getMemoryProfile, saveMemoryProfile, saveMemoryRecord } from '../../src/long-term-memory/store.js'
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
})
