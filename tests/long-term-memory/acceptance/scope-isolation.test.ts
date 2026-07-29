// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { searchLexical } from '../../../src/long-term-memory/lexical-search.js'
import { listMemoryRecords } from '../../../src/long-term-memory/store.js'
import { setupTestDb } from '../../utils/test-helpers.js'
import { ALL_STATUSES, GROUP, OTHER_PERSONAL, PERSONAL, seedMultiParty, seedMultilingual } from './corpus.js'
import { CASES } from './scope-isolation.cases.js'

const lexicalIds = (scope: typeof PERSONAL, query: string): readonly string[] =>
  searchLexical({ ...scope, query, statuses: ALL_STATUSES, limit: 8 }).map((r) => r.id)

const listedIds = (scope: typeof PERSONAL): readonly string[] =>
  ALL_STATUSES.flatMap((status) => listMemoryRecords({ ...scope, status }).map((r) => r.id))

describe('acceptance: scope-isolation', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test(`multilingual — ${CASES.multilingual}`, () => {
    const seeded = seedMultilingual(PERSONAL)
    seedMultilingual(OTHER_PERSONAL)

    for (const id of seeded) {
      expect(listedIds(PERSONAL)).toContain(id)
      expect(listedIds(OTHER_PERSONAL)).not.toContain(id)
      expect(lexicalIds(OTHER_PERSONAL, 'Berlin')).not.toContain(id)
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
  })

  test('multi-party — a thread-scoped record is filtered by threadContextId', () => {
    seedMultiParty()

    const otherThread = searchLexical({
      ...GROUP,
      query: 'release',
      statuses: ALL_STATUSES,
      threadContextId: 'thread-b',
      limit: 8,
    }).map((r) => r.id)
    expect(otherThread).not.toContain('acc-mp-group-thread')
  })
})
