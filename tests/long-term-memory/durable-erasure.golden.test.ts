// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { memoryRecords } from '../../src/db/schema.js'
import { searchLexical } from '../../src/long-term-memory/lexical-search.js'
import { runRecallCascade, type RunRecallCascadeDeps } from '../../src/long-term-memory/recall-cascade.js'
import {
  listMemoryRecords,
  purgeMemoryRecord,
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
  }
})
