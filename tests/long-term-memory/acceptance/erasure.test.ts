// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../../src/db/drizzle.js'
import { memoryProfiles, memorySummary } from '../../../src/db/schema.js'
import { searchLexical } from '../../../src/long-term-memory/lexical-search.js'
import { visibleProfileText } from '../../../src/long-term-memory/profile-visibility.js'
import { purgeMemoryRecord } from '../../../src/long-term-memory/purge.js'
import { profileScopeCondition } from '../../../src/long-term-memory/record-conditions.js'
import { rankRecordsBySimilarity } from '../../../src/long-term-memory/semantic-search.js'
import { rowToProfile } from '../../../src/long-term-memory/serialization.js'
import {
  getMemoryProfile,
  listMemoryRecords,
  saveMemoryProfile,
  saveMemoryRecord,
} from '../../../src/long-term-memory/store.js'
import { isContentTombstoned } from '../../../src/long-term-memory/tombstone.js'
import { setupTestDb } from '../../utils/test-helpers.js'
import { ALL_STATUSES, BILINGUAL, PERSONAL, VEC, VERSION, acceptanceRecord, seedAdversarialErasure } from './corpus.js'
import { CASES } from './erasure.cases.js'

const PURGE_TIME = '2026-07-24T00:00:00.000Z'

/** Dense channel with every masking filter disarmed, so a miss means the row is gone. */
const semanticIds = (): readonly string[] =>
  rankRecordsBySimilarity(PERSONAL, VEC, {
    statuses: ALL_STATUSES,
    embeddingVersion: VERSION,
    threshold: 0,
    limit: 8,
  }).map((r) => r.id)

const lexicalIds = (query: string): readonly string[] =>
  searchLexical({ ...PERSONAL, query, statuses: ALL_STATUSES, limit: 8 }).map((r) => r.id)

const listedIds = (): readonly string[] =>
  ALL_STATUSES.flatMap((status) => listMemoryRecords({ ...PERSONAL, status }).map((r) => r.id))

/** `??` is banned inside `test()` bodies, so the id default lives here. */
const purge = (id: string | undefined): boolean => purgeMemoryRecord(PERSONAL, id ?? '', PURGE_TIME)

/**
 * `seedAdversarialErasure` returns `readonly string[]`, so destructuring loses definiteness.
 * Narrowing lives here (module scope) rather than in the test body, per the same
 * no-conditional-in-test constraint that shapes `purge` above.
 */
const requireId = (id: string | undefined): string => {
  if (id === undefined) throw new Error('seedAdversarialErasure returned fewer ids than expected')
  return id
}

/**
 * Reads and narrows the raw profile row outside the test body (oxlint forbids conditionals
 * inside `test()`), mirroring `contaminatedAtOf` in the durable-erasure golden.
 */
const profileContaminatedAt = (): string | null => {
  const row = getDrizzleDb().select().from(memoryProfiles).where(profileScopeCondition(PERSONAL)).get()
  if (row === undefined) throw new Error('profile row missing after purge')
  return rowToProfile(row).contaminatedAt
}

describe('acceptance: erasure', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  for (const entry of BILINGUAL) {
    test(`multilingual/${entry.lang} — ${CASES.multilingual}`, () => {
      const id = `${PERSONAL.scopeId}-${entry.id}`
      saveMemoryRecord(acceptanceRecord({ ...PERSONAL, id, content: entry.content }))

      expect(lexicalIds(entry.term)).toContain(id)
      expect(semanticIds()).toContain(id)
      // positive control for the listMemoryRecords channel, so the post-purge absence below
      // proves the purge, not an unrelated reason listMemoryRecords never saw this id
      expect(listedIds()).toContain(id)

      expect(purge(id)).toBe(true)

      expect(lexicalIds(entry.term)).not.toContain(id)
      expect(semanticIds()).not.toContain(id)
      expect(listedIds()).not.toContain(id)
    })
  }

  test('multilingual/EN — purge withholds profile prose and deletes the rolling summary', () => {
    const entry = BILINGUAL[0]
    const id = `${PERSONAL.scopeId}-${entry.id}`
    saveMemoryProfile(PERSONAL, entry.content, '2026-07-01T00:00:00.000Z')
    getDrizzleDb()
      .insert(memorySummary)
      .values({ userId: PERSONAL.scopeId, summary: entry.content, updatedAt: '2026-07-01T00:00:00.000Z' })
      .run()
    saveMemoryRecord(acceptanceRecord({ ...PERSONAL, id, content: entry.content }))

    // positive control: the profile is visible before the purge
    expect(visibleProfileText(getMemoryProfile(PERSONAL))).toBe(entry.content)
    // positive control: the rolling summary exists before the purge
    expect(getDrizzleDb().select().from(memorySummary).all()).toHaveLength(1)

    expect(purge(id)).toBe(true)

    // profile channel: prose is withheld from every reader, but the raw row survives, flagged
    expect(visibleProfileText(getMemoryProfile(PERSONAL))).toBeNull()
    expect(profileContaminatedAt()).toBe(PURGE_TIME)

    // summary channel: the rolling summary is deleted outright
    expect(getDrizzleDb().select().from(memorySummary).all()).toHaveLength(0)
  })

  test(`adversarial-erasure — ${CASES['adversarial-erasure']}`, () => {
    const [rawActiveId, rawTwinId] = seedAdversarialErasure(PERSONAL)
    const activeId = requireId(rawActiveId)
    const twinId = requireId(rawTwinId)
    const content = 'User banks with Sparkasse'

    expect(listedIds()).toContain(twinId)
    // positive control for the dense channel: the twin's embedding identity matches, so it
    // must be reachable before the purge, or the post-purge absence below proves nothing
    expect(semanticIds()).toContain(twinId)

    expect(purge(activeId)).toBe(true)

    // the content-hash sweep takes the provisional twin with it
    expect(listedIds()).not.toContain(twinId)
    expect(semanticIds()).not.toContain(twinId)
    // and the write boundary refuses to re-materialize it.
    // Source MUST be non-explicit: saveMemoryRecord deliberately lets an explicit user
    // re-assertion through the gate (store.ts:179), so 'explicit' here would prove nothing.
    expect(isContentTombstoned(PERSONAL, content)).toBe(true)
    expect(
      saveMemoryRecord(acceptanceRecord({ ...PERSONAL, id: 'acc-adv-recapture', content, source: 'background' })),
    ).toBeNull()
  })
})
