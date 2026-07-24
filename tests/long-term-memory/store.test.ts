// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { memoryRecords, memoryTombstones } from '../../src/db/schema.js'
import {
  archiveMemoryRecord,
  clearMemoryScope,
  getMemoryProfile,
  listMemoryRecords,
  purgeMemoryRecord,
  saveMemoryProfile,
  saveMemoryRecord,
  searchMemoryRecords,
} from '../../src/long-term-memory/store.js'
import type { MemoryRecordInput } from '../../src/long-term-memory/types.js'
import { setupTestDb } from '../utils/test-helpers.js'

const memoryRecordInput = (overrides: Partial<MemoryRecordInput>): MemoryRecordInput => ({
  id: 'mem-1',
  scopeId: 'user-1',
  scopeType: 'personal',
  kind: 'preference',
  content: 'User prefers concise implementation plans.',
  summary: 'Concise plans',
  tags: ['style'],
  confidence: 1,
  status: 'active',
  source: 'explicit',
  evidence: {},
  createdAt: '2026-06-11T00:00:00.000Z',
  updatedAt: '2026-06-11T00:00:00.000Z',
  lastSeenAt: '2026-06-11T00:00:00.000Z',
  ...overrides,
})

describe('long-term memory store', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('saves and loads a profile for one scope', () => {
    saveMemoryProfile(
      { scopeId: 'user-1', scopeType: 'personal' },
      '## Communication\n- Concise replies',
      '2026-06-11T00:00:00.000Z',
    )

    expect(getMemoryProfile({ scopeId: 'user-1', scopeType: 'personal' })).toEqual({
      scopeId: 'user-1',
      scopeType: 'personal',
      profile: '## Communication\n- Concise replies',
      enabled: true,
      version: 1,
      updatedAt: '2026-06-11T00:00:00.000Z',
    })
  })

  test('keeps memory profiles isolated by full scope identity', () => {
    saveMemoryProfile(
      { scopeId: 'shared-profile', scopeType: 'personal' },
      'Personal profile',
      '2026-06-11T00:00:00.000Z',
    )
    saveMemoryProfile({ scopeId: 'shared-profile', scopeType: 'group' }, 'Group profile', '2026-06-12T00:00:00.000Z')

    expect(getMemoryProfile({ scopeId: 'shared-profile', scopeType: 'personal' })?.profile).toBe('Personal profile')
    expect(getMemoryProfile({ scopeId: 'shared-profile', scopeType: 'group' })?.profile).toBe('Group profile')
  })

  test('stores records and lists only requested scope/status', () => {
    saveMemoryRecord(
      memoryRecordInput({
        id: 'mem-1',
        scopeId: 'group-1',
        scopeType: 'group',
        kind: 'decision',
        content: 'The group decided to release on Fridays.',
        summary: 'Friday releases',
        tags: ['release'],
        confidence: 0.9,
        status: 'active',
        source: 'background',
        evidence: { messageIds: ['m1'] },
        createdAt: '2026-06-11T00:00:00.000Z',
        updatedAt: '2026-06-11T00:00:00.000Z',
        lastSeenAt: '2026-06-11T00:00:00.000Z',
      }),
    )

    expect(listMemoryRecords({ scopeId: 'group-1', scopeType: 'group', status: 'active' }).map((r) => r.id)).toEqual([
      'mem-1',
    ])
    expect(listMemoryRecords({ scopeId: 'user-1', scopeType: 'personal', status: 'active' })).toEqual([])
  })

  test('searches active records with FTS', () => {
    saveMemoryRecord(
      memoryRecordInput({
        id: 'mem-2',
        scopeId: 'user-1',
        scopeType: 'personal',
        kind: 'preference',
        content: 'User prefers concise implementation plans.',
        summary: 'Concise plans',
        tags: ['style'],
        confidence: 1,
        status: 'active',
        source: 'explicit',
        evidence: {},
        createdAt: '2026-06-11T00:00:00.000Z',
        updatedAt: '2026-06-11T00:00:00.000Z',
        lastSeenAt: '2026-06-11T00:00:00.000Z',
      }),
    )

    expect(
      searchMemoryRecords({ scopeId: 'user-1', scopeType: 'personal', query: 'concise', includeStale: false }).map(
        (r) => r.id,
      ),
    ).toEqual(['mem-2'])
  })

  test('archives a record and clears a scope', () => {
    saveMemoryRecord(
      memoryRecordInput({
        id: 'mem-3',
        scopeId: 'user-1',
        scopeType: 'personal',
        kind: 'reference',
        content: 'User shared a reusable setup link.',
        summary: null,
        tags: [],
        confidence: 0.7,
        status: 'active',
        source: 'explicit',
        evidence: {},
        createdAt: '2026-06-11T00:00:00.000Z',
        updatedAt: '2026-06-11T00:00:00.000Z',
        lastSeenAt: '2026-06-11T00:00:00.000Z',
      }),
    )

    expect(archiveMemoryRecord({ scopeId: 'user-1', scopeType: 'personal' }, 'mem-3', '2026-06-12T00:00:00.000Z')).toBe(
      true,
    )
    expect(listMemoryRecords({ scopeId: 'user-1', scopeType: 'personal', status: 'active' })).toEqual([])
    expect(clearMemoryScope({ scopeId: 'user-1', scopeType: 'personal' })).toEqual({
      recordsDeleted: 1,
      profileDeleted: 0,
    })
  })

  test('keeps list and search isolated by scope type when scope ids match', () => {
    saveMemoryRecord(
      memoryRecordInput({
        id: 'mem-personal',
        scopeId: 'shared-1',
        scopeType: 'personal',
        content: 'Shared identifier personal concise preference.',
      }),
    )
    saveMemoryRecord(
      memoryRecordInput({
        id: 'mem-group',
        scopeId: 'shared-1',
        scopeType: 'group',
        content: 'Shared identifier group concise decision.',
        kind: 'decision',
      }),
    )

    expect(listMemoryRecords({ scopeId: 'shared-1', scopeType: 'personal' }).map((r) => r.id)).toEqual(['mem-personal'])
    expect(searchMemoryRecords({ scopeId: 'shared-1', scopeType: 'group', query: 'concise' }).map((r) => r.id)).toEqual(
      ['mem-group'],
    )
  })

  test('archives records only in the requested scope type', () => {
    saveMemoryRecord(memoryRecordInput({ id: 'mem-personal', scopeId: 'shared-2', scopeType: 'personal' }))
    saveMemoryRecord(memoryRecordInput({ id: 'mem-group', scopeId: 'shared-2', scopeType: 'group' }))

    expect(
      archiveMemoryRecord({ scopeId: 'shared-2', scopeType: 'personal' }, 'mem-personal', '2026-06-12T00:00:00.000Z'),
    ).toBe(true)

    expect(listMemoryRecords({ scopeId: 'shared-2', scopeType: 'personal', status: 'active' })).toEqual([])
    expect(listMemoryRecords({ scopeId: 'shared-2', scopeType: 'group', status: 'active' }).map((r) => r.id)).toEqual([
      'mem-group',
    ])
  })

  test('degrades malformed tags and evidence without throwing', () => {
    saveMemoryRecord(memoryRecordInput({ id: 'mem-bad-json' }))
    getDrizzleDb()
      .update(memoryRecords)
      .set({ tags: 'not-json', evidence: 'not-json' })
      .where(eq(memoryRecords.id, 'mem-bad-json'))
      .run()

    const records = listMemoryRecords({ scopeId: 'user-1', scopeType: 'personal' })

    expect(records[0]?.tags).toEqual([])
    expect(records[0]?.evidence).toEqual({})
  })

  describe('purgeMemoryRecord', () => {
    test('deletes the row, its FTS entry, and writes a tombstone', () => {
      saveMemoryRecord(memoryRecordInput({ id: 'mem-p1', content: 'User lives in Berlin' }))

      const purged = purgeMemoryRecord(
        { scopeId: 'user-1', scopeType: 'personal' },
        'mem-p1',
        '2026-07-24T00:00:00.000Z',
      )
      expect(purged).toBe(true)

      const db = getDrizzleDb()
      // canonical row gone
      expect(db.select().from(memoryRecords).where(eq(memoryRecords.id, 'mem-p1')).get()).toBeUndefined()
      // FTS entry gone (raw MATCH probe)
      const ftsHits = db.$client
        .query("SELECT rowid FROM memory_records_fts WHERE memory_records_fts MATCH 'Berlin'")
        .all()
      expect(ftsHits.length).toBe(0)
      // tombstone written
      const tomb = db.select().from(memoryTombstones).where(eq(memoryTombstones.scopeId, 'user-1')).all()
      expect(tomb.length).toBe(1)
    })

    test('scope-guarded: wrong scope does not purge', () => {
      saveMemoryRecord(memoryRecordInput({ id: 'mem-p2', content: 'scoped' }))
      const purged = purgeMemoryRecord(
        { scopeId: 'other', scopeType: 'personal' },
        'mem-p2',
        '2026-07-24T00:00:00.000Z',
      )
      expect(purged).toBe(false)
      expect(getDrizzleDb().select().from(memoryRecords).where(eq(memoryRecords.id, 'mem-p2')).get()).toBeDefined()
    })

    test('unknown id returns false and writes no tombstone', () => {
      const purged = purgeMemoryRecord({ scopeId: 'user-1', scopeType: 'personal' }, 'nope', '2026-07-24T00:00:00.000Z')
      expect(purged).toBe(false)
      expect(getDrizzleDb().select().from(memoryTombstones).all().length).toBe(0)
    })
  })
})
