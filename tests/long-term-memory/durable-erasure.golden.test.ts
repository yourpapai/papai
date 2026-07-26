// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import type { MemoryProfileRow } from '../../src/db/long-term-memory-schema.js'
import { conversationHistory, memoryProfiles, memoryRecords, memorySummary } from '../../src/db/schema.js'
import { searchLexical } from '../../src/long-term-memory/lexical-search.js'
import { visibleProfileText } from '../../src/long-term-memory/profile-visibility.js'
import { runRecallCascade, type RunRecallCascadeDeps } from '../../src/long-term-memory/recall-cascade.js'
import { profileScopeCondition } from '../../src/long-term-memory/record-conditions.js'
import { rowToProfile } from '../../src/long-term-memory/serialization.js'
import {
  getMemoryProfile,
  listMemoryRecords,
  purgeMemoryRecord,
  saveMemoryProfile,
  saveMemoryRecord,
  searchMemoryRecords,
} from '../../src/long-term-memory/store.js'
import { isContentTombstoned } from '../../src/long-term-memory/tombstone.js'
import type { MemoryRecordInput, MemoryStatus } from '../../src/long-term-memory/types.js'
import { setupTestDb } from '../utils/test-helpers.js'

const MODEL = 'model-a'
const VEC = [1, 0, 0]
const VERSION = `${MODEL}:${VEC.length}`
const scope = { scopeId: 'dm-ctx-1', scopeType: 'personal' as const }
const ALL_STATUSES: readonly MemoryStatus[] = ['active', 'stale', 'archived', 'contradicted', 'provisional']

const deps: RunRecallCascadeDeps = {
  getEmbedding: () => Promise.resolve(VEC),
  resolveEmbeddingModel: () => MODEL,
  schedulePromotion: () => undefined,
}

const record = (overrides: Partial<MemoryRecordInput>): MemoryRecordInput => ({
  id: 'seed',
  scopeId: scope.scopeId,
  scopeType: scope.scopeType,
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
  embedding: new Float32Array(VEC),
  embeddingModel: MODEL,
  embeddingDimension: VEC.length,
  embeddingVersion: VERSION,
  embeddedAt: '2026-07-01T00:00:00.000Z',
  ...overrides,
})

const recallIds = async (query: string): Promise<readonly string[]> => {
  const { records } = await runRecallCascade(
    { storageContextId: scope.scopeId, configContextId: 'cfg-1', contextType: 'dm', query, limit: 8 },
    deps,
  )
  return records.map((r) => r.id)
}

/** Narrows the optional rows outside the test body (oxlint forbids conditionals inside `test()`). */
const historyMessages = (row: { messages: string } | undefined): string => {
  if (row === undefined) throw new Error('conversation history row missing')
  return row.messages
}

const contaminatedAtOf = (row: MemoryProfileRow | undefined): string | null => {
  if (row === undefined) throw new Error('profile row missing after purge')
  return rowToProfile(row).contaminatedAt
}

describe('durable erasure golden set', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  for (const lang of [
    { name: 'EN', id: 'en-1', content: 'User lives in Berlin', term: 'Berlin' },
    { name: 'RU', id: 'ru-1', content: 'Пользователь живёт в Берлине', term: 'Берлине' },
  ] as const) {
    test(`${lang.name}: purged record is unreachable by every channel`, async () => {
      saveMemoryRecord(record({ id: lang.id, content: lang.content }))

      // sanity: reachable before forget (fused cascade)
      expect(await recallIds(lang.term)).toContain(lang.id)
      // sanity: reachable before forget (lexical channel alone, proving FTS tokenization)
      expect(
        searchLexical({ ...scope, query: lang.term, statuses: ALL_STATUSES, limit: 8 }).map((r) => r.id),
      ).toContain(lang.id)

      const purged = purgeMemoryRecord(scope, lang.id, '2026-07-24T00:00:00.000Z')
      expect(purged).toBe(true)

      // recall cascade (fusion of lexical + dense)
      expect(await recallIds(lang.term)).not.toContain(lang.id)
      // lexical channel
      expect(
        searchLexical({ ...scope, query: lang.term, statuses: ALL_STATUSES, limit: 8 }).map((r) => r.id),
      ).not.toContain(lang.id)
      // forget-by-query search
      expect(searchMemoryRecords({ ...scope, query: lang.term, includeStale: true }).map((r) => r.id)).not.toContain(
        lang.id,
      )
      // list under every status
      for (const status of ALL_STATUSES) {
        expect(listMemoryRecords({ ...scope, status }).map((r) => r.id)).not.toContain(lang.id)
      }
      // canonical row + FTS gone
      expect(getDrizzleDb().select().from(memoryRecords).where(eq(memoryRecords.id, lang.id)).get()).toBeUndefined()
      // tombstone present -> recapture suppressed
      expect(isContentTombstoned(scope, lang.content)).toBe(true)
    })

    test(`${lang.name}: purge erases derived prose but leaves the conversation intact`, () => {
      const key = scope.scopeId
      saveMemoryProfile(scope, lang.content, '2026-07-01T00:00:00.000Z')
      getDrizzleDb()
        .insert(memorySummary)
        .values({ userId: key, summary: lang.content, updatedAt: '2026-07-01T00:00:00.000Z' })
        .run()
      getDrizzleDb()
        .insert(conversationHistory)
        .values({ userId: key, messages: JSON.stringify([{ role: 'user', content: lang.content }]) })
        .run()
      saveMemoryRecord(record({ id: lang.id, content: lang.content }))

      // sanity: the profile is visible before the forget
      expect(visibleProfileText(getMemoryProfile(scope))).toBe(lang.content)

      expect(purgeMemoryRecord(scope, lang.id, '2026-07-25T12:00:00.000Z')).toBe(true)

      // profile prose is withheld from every reader
      expect(visibleProfileText(getMemoryProfile(scope))).toBeNull()
      // ...and the raw row still exists but is flagged, so a rewrite can restore quality
      const profileRow = getDrizzleDb().select().from(memoryProfiles).where(profileScopeCondition(scope)).get()
      expect(contaminatedAtOf(profileRow)).toBe('2026-07-25T12:00:00.000Z')

      // the rolling summary is gone outright — it cannot be regenerated
      expect(getDrizzleDb().select().from(memorySummary).all()).toHaveLength(0)

      // BOUNDARY (intended, see spec section 4): what the user actually said is untouched.
      const history = getDrizzleDb().select().from(conversationHistory).where(eq(conversationHistory.userId, key)).get()
      expect(historyMessages(history)).toContain(lang.content)
    })
  }
})
