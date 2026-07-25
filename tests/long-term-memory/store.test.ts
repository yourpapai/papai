// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import {
  conversationHistory,
  memoryExtractionState,
  memoryFacts,
  memoryRecallShadowLog,
  memoryRecords,
  memorySummary,
  memoryTombstones,
} from '../../src/db/schema.js'
import type { ShadowLogRow } from '../../src/long-term-memory/shadow-log-row.js'
import {
  archiveMemoryRecord,
  clearMemoryScope,
  getMemoryProfile,
  insertShadowLogRow,
  listMemoryRecords,
  purgeMemoryRecord,
  saveMemoryProfile,
  saveMemoryRecord,
  searchMemoryRecords,
  setMemoryRecordInjectionEnabled,
} from '../../src/long-term-memory/store.js'
import { insertTombstone } from '../../src/long-term-memory/tombstone.testing.js'
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
      injectRecords: false,
      contaminatedAt: null,
      version: 1,
      updatedAt: '2026-06-11T00:00:00.000Z',
    })
  })

  test('a freshly saved profile defaults injectRecords to false', () => {
    const scope = { scopeId: 'ctx-inject-default', scopeType: 'personal' as const }
    saveMemoryProfile(scope, 'hello', '2026-07-24T00:00:00.000Z')
    const profile = getMemoryProfile(scope)
    expect(profile?.injectRecords).toBe(false)
  })

  test('setMemoryRecordInjectionEnabled toggles inject flag without disturbing capture', () => {
    const scope = { scopeId: 'ctx-inject-set', scopeType: 'personal' as const }
    const enabled = setMemoryRecordInjectionEnabled(scope, true, '2026-07-24T00:00:00.000Z')
    expect(enabled.injectRecords).toBe(true)
    // capture default preserved on fresh insert
    expect(enabled.enabled).toBe(true)

    const disabled = setMemoryRecordInjectionEnabled(scope, false, '2026-07-24T00:01:00.000Z')
    expect(disabled.injectRecords).toBe(false)
    expect(disabled.version).toBe(enabled.version + 1)
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
      workingMemoryKeysCleared: 0,
      extractionStateDeleted: 0,
      tombstonesDeleted: 0,
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

  describe('clearMemoryScope completeness', () => {
    test('group clear wipes long-term, working memory (incl. thread keys), watermark, tombstones', () => {
      const db = getDrizzleDb()
      const scopeId = 'pi:inst:ctx:grp'
      const threadKey = 'pi:inst:ctx:grp:thread:t1'

      saveMemoryRecord(memoryRecordInput({ id: 'g1', scopeId, scopeType: 'group', content: 'group fact' }))
      insertTombstone({ scopeId, scopeType: 'group' }, 'old forgotten', '2026-07-24T00:00:00.000Z')
      db.insert(conversationHistory).values({ userId: threadKey, messages: '[]' }).run()
      db.insert(memorySummary).values({ userId: threadKey, summary: 's', updatedAt: '2026-07-24T00:00:00.000Z' }).run()
      db.insert(memoryFacts)
        .values({ userId: threadKey, identifier: 'f1', title: 't', url: '', lastSeen: '2026-07-24T00:00:00.000Z' })
        .run()
      db.insert(memoryExtractionState)
        .values({
          contextId: threadKey,
          contextType: 'group',
          configContextId: scopeId,
          lastActivityAt: '2026-07-24T00:00:00.000Z',
          lastHistoryLen: 0,
        })
        .run()

      const counts = clearMemoryScope({ scopeId, scopeType: 'group' })

      expect(counts.recordsDeleted).toBe(1)
      expect(counts.tombstonesDeleted).toBe(1)
      expect(counts.extractionStateDeleted).toBe(1)
      expect(counts.workingMemoryKeysCleared).toBeGreaterThanOrEqual(1)
      expect(
        db.select().from(conversationHistory).where(eq(conversationHistory.userId, threadKey)).get(),
      ).toBeUndefined()
      expect(db.select().from(memorySummary).where(eq(memorySummary.userId, threadKey)).get()).toBeUndefined()
      expect(db.select().from(memoryFacts).where(eq(memoryFacts.userId, threadKey)).all().length).toBe(0)
      expect(db.select().from(memoryExtractionState).all().length).toBe(0)
      expect(db.select().from(memoryTombstones).all().length).toBe(0)
    })

    test('does not touch another scope sharing a key prefix', () => {
      const db = getDrizzleDb()
      db.insert(conversationHistory).values({ userId: 'pi:inst:ctx:grpX', messages: '[]' }).run()
      clearMemoryScope({ scopeId: 'pi:inst:ctx:grp', scopeType: 'group' })
      expect(
        db.select().from(conversationHistory).where(eq(conversationHistory.userId, 'pi:inst:ctx:grpX')).get(),
      ).toBeDefined()
    })

    test('escapes underscores in scopeId so thread-key LIKE match neither over- nor under-matches', () => {
      const db = getDrizzleDb()
      const scopeId = 'pi:inst:ctx:my_grp'
      const threadKey = 'pi:inst:ctx:my_grp:thread:t1'
      // A sibling scope where the literal `_` of `my_grp` is replaced by another char. If the LIKE pattern's
      // `_` were left unescaped (a SQL single-char wildcard), this row would wrongly match too.
      const siblingThreadKey = 'pi:inst:ctx:myXgrp:thread:t1'

      db.insert(conversationHistory).values({ userId: threadKey, messages: '[]' }).run()
      db.insert(conversationHistory).values({ userId: siblingThreadKey, messages: '[]' }).run()
      db.insert(memoryExtractionState)
        .values({
          contextId: threadKey,
          contextType: 'group',
          configContextId: scopeId,
          lastActivityAt: '2026-07-24T00:00:00.000Z',
          lastHistoryLen: 0,
        })
        .run()

      const counts = clearMemoryScope({ scopeId, scopeType: 'group' })

      expect(counts.workingMemoryKeysCleared).toBeGreaterThanOrEqual(1)
      expect(counts.extractionStateDeleted).toBe(1)
      // The underscore-containing scope's own thread key must be wiped.
      expect(
        db.select().from(conversationHistory).where(eq(conversationHistory.userId, threadKey)).get(),
      ).toBeUndefined()
      // The sibling scope (differing only where `_` sat) must be untouched.
      expect(
        db.select().from(conversationHistory).where(eq(conversationHistory.userId, siblingThreadKey)).get(),
      ).toBeDefined()
    })
  })

  describe('insertShadowLogRow', () => {
    const row: ShadowLogRow = {
      scopeHash: 'hash-scope-1',
      contextHash: 'hash-context-1',
      turnRef: 'turn-77',
      readerModelId: 'gpt-4o-mini',
      activeRecordCount: 3,
      shadowQueryHash: 'hash-query-1',
      shadowQueryLenBucket: 'medium',
      shadowHitCount: 2,
      shadowTopScore: 0.87,
      shadowTopProvenance: 'group',
      shadowTopRecordHash: 'hash-record-1',
      modelPulled: true,
      pullCount: 1,
      pullQueryHash: 'hash-pull-1',
      pullResultCount: 2,
      shadowPullOverlap: 1,
      skippedReason: null,
    }

    test('persists a real row against the drizzle schema, assigning id and createdAt', () => {
      const before = Date.now()

      insertShadowLogRow(row)

      const persisted = getDrizzleDb().select().from(memoryRecallShadowLog).all()
      expect(persisted).toHaveLength(1)
      const inserted = persisted[0]
      expect(inserted).toBeDefined()

      expect(typeof inserted?.id).toBe('string')
      expect(inserted?.id.length).toBeGreaterThan(0)
      expect(inserted?.createdAt).toBeGreaterThanOrEqual(before)
      expect(inserted?.createdAt).toBeLessThanOrEqual(Date.now())

      // Every column mapped through the real drizzle insert, matching what was passed in.
      expect(inserted?.scopeHash).toBe(row.scopeHash)
      expect(inserted?.contextHash).toBe(row.contextHash)
      expect(inserted?.turnRef).toBe(row.turnRef)
      expect(inserted?.readerModelId).toBe(row.readerModelId)
      expect(inserted?.activeRecordCount).toBe(row.activeRecordCount)
      expect(inserted?.shadowQueryHash).toBe(row.shadowQueryHash)
      expect(inserted?.shadowQueryLenBucket).toBe(row.shadowQueryLenBucket)
      expect(inserted?.shadowHitCount).toBe(row.shadowHitCount)
      expect(inserted?.shadowTopScore).toBe(row.shadowTopScore)
      expect(inserted?.shadowTopProvenance).toBe(row.shadowTopProvenance)
      expect(inserted?.shadowTopRecordHash).toBe(row.shadowTopRecordHash)
      expect(inserted?.modelPulled).toBe(row.modelPulled)
      expect(inserted?.pullCount).toBe(row.pullCount)
      expect(inserted?.pullQueryHash).toBe(row.pullQueryHash)
      expect(inserted?.pullResultCount).toBe(row.pullResultCount)
      expect(inserted?.shadowPullOverlap).toBe(row.shadowPullOverlap)
      expect(inserted?.skippedReason).toBe(row.skippedReason)
    })

    test('assigns a distinct id per call, so repeated inserts do not collide', () => {
      insertShadowLogRow(row)
      insertShadowLogRow(row)

      const persisted = getDrizzleDb().select().from(memoryRecallShadowLog).all()
      expect(persisted).toHaveLength(2)
      expect(persisted[0]?.id).not.toBe(persisted[1]?.id)
    })
  })
})
