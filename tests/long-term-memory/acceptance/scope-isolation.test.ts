// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { searchLexical } from '../../../src/long-term-memory/lexical-search.js'
import { rankRecordsBySimilarity } from '../../../src/long-term-memory/semantic-search.js'
import { listMemoryRecords } from '../../../src/long-term-memory/store.js'
import { setupTestDb } from '../../utils/test-helpers.js'
import {
  ALL_STATUSES,
  BILINGUAL,
  GROUP,
  OTHER_PERSONAL,
  PERSONAL,
  VEC,
  VERSION,
  seedMultiParty,
  seedMultilingual,
} from './corpus.js'
import { CASES } from './scope-isolation.cases.js'

const lexicalIds = (scope: typeof PERSONAL, query: string): readonly string[] =>
  searchLexical({ ...scope, query, statuses: ALL_STATUSES, limit: 8 }).map((r) => r.id)

const denseIds = (scope: typeof PERSONAL): readonly string[] =>
  rankRecordsBySimilarity(scope, VEC, {
    statuses: ALL_STATUSES,
    embeddingVersion: VERSION,
    threshold: 0,
    limit: 8,
  }).map((r) => r.id)

const listedIds = (scope: typeof PERSONAL): readonly string[] =>
  ALL_STATUSES.flatMap((status) => listMemoryRecords({ ...scope, status }).map((r) => r.id))

const scopedId = (scope: typeof PERSONAL, entryId: string): string => `${scope.scopeId}-${entryId}`

const threadScopedGroupIds = (threadContextId: string): readonly string[] =>
  searchLexical({ ...GROUP, query: 'release', statuses: ALL_STATUSES, threadContextId, limit: 8 }).map((r) => r.id)

describe('acceptance: scope-isolation', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test(`multilingual — ${CASES.multilingual}`, () => {
    const seeded = seedMultilingual(PERSONAL)
    seedMultilingual(OTHER_PERSONAL)

    expect(seeded).toHaveLength(BILINGUAL.length)
    for (const entry of BILINGUAL) {
      const id = scopedId(PERSONAL, entry.id)
      expect(seeded).toContain(id)
      expect(listedIds(PERSONAL)).toContain(id)
      expect(listedIds(OTHER_PERSONAL)).not.toContain(id)

      // Query each record in its own language. A single ASCII query would never match the
      // Cyrillic record in any scope, making its isolation assertion pass vacuously.
      const otherHits = lexicalIds(OTHER_PERSONAL, entry.term)
      expect(otherHits).not.toContain(id)
      // Positive control: the query does reach the other scope's own twin, so the negative
      // assertion above is load-bearing rather than an assertion against an empty result.
      expect(otherHits).toContain(scopedId(OTHER_PERSONAL, entry.id))

      // Dense channel: semantic-search.ts implements its own scope filter, separate from
      // lexical-search.ts's and store.ts's, so it needs its own isolation proof.
      expect(denseIds(PERSONAL)).toContain(id)
      const otherDenseHits = denseIds(OTHER_PERSONAL)
      expect(otherDenseHits).not.toContain(id)
      // Positive control: the other scope's own twin is dense-reachable, so the miss above is
      // a scope filter, not a dead query.
      expect(otherDenseHits).toContain(scopedId(OTHER_PERSONAL, entry.id))
    }
  })

  test(`multi-party — ${CASES['multi-party']}`, () => {
    seedMultiParty()

    expect(listedIds(PERSONAL)).toContain('acc-mp-personal')
    expect(listedIds(PERSONAL)).not.toContain('acc-mp-other')
    expect(listedIds(PERSONAL)).not.toContain('acc-mp-group')
    expect(listedIds(GROUP)).toContain('acc-mp-group')
    expect(listedIds(GROUP)).not.toContain('acc-mp-personal')
    expect(lexicalIds(PERSONAL, 'stands')).not.toContain('acc-mp-group')

    // Dense channel: personal-vs-group, each negative beside a positive on the same call.
    expect(denseIds(PERSONAL)).toContain('acc-mp-personal')
    expect(denseIds(PERSONAL)).not.toContain('acc-mp-group')
    expect(denseIds(GROUP)).toContain('acc-mp-group')
    expect(denseIds(GROUP)).not.toContain('acc-mp-personal')
  })

  test('multi-party — a thread-scoped record is filtered by threadContextId', () => {
    seedMultiParty()

    expect(threadScopedGroupIds('thread-b')).not.toContain('acc-mp-group-thread')
    // Positive control: the same query with the matching thread id does return the record, so
    // the negative assertion above proves a thread filter rather than an always-empty result.
    expect(threadScopedGroupIds('thread-a')).toContain('acc-mp-group-thread')
  })
})
