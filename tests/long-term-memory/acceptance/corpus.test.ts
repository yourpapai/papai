// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { listMemoryRecords } from '../../../src/long-term-memory/store.js'
import type { MemoryRecord } from '../../../src/long-term-memory/types.js'
import { setupTestDb } from '../../utils/test-helpers.js'
import {
  ALL_STATUSES,
  CORPUS_VERSION,
  GROUP,
  PERSONAL,
  seedAdversarialErasure,
  seedContradiction,
  seedDuplicateOutOfOrder,
  seedMissingEmbedding,
  seedMultiParty,
  seedMultilingual,
  seedToolResult,
} from './corpus.js'

const idsIn = (scope: typeof PERSONAL): readonly string[] =>
  ALL_STATUSES.flatMap((status) => listMemoryRecords({ ...scope, status }).map((r) => r.id))

/** `??` is banned inside `test()` bodies, so the null-normalizing lives here. */
const embeddingIdentity = (record: MemoryRecord | undefined): string | null => record?.embeddingVersion ?? null

describe('acceptance corpus', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('the corpus is versioned', () => {
    expect(CORPUS_VERSION).not.toBe('')
  })

  test('multilingual seeds one Latin and one Cyrillic record', () => {
    const ids = seedMultilingual(PERSONAL)
    expect(ids).toHaveLength(2)
    const found = idsIn(PERSONAL)
    expect(ids.every((id) => found.includes(id))).toBe(true)
  })

  test('multi-party seeds separate personal and group scopes', () => {
    const ids = seedMultiParty()
    expect(ids.length).toBeGreaterThanOrEqual(3)
    expect(idsIn(PERSONAL).length).toBeGreaterThan(0)
    expect(idsIn(GROUP).length).toBeGreaterThan(0)
  })

  test('tool-result seeds a record sourced from a tool result with evidence', () => {
    const ids = seedToolResult(PERSONAL)
    expect(ids).toHaveLength(1)
    const written = listMemoryRecords({ ...PERSONAL, status: 'active' }).find((r) => r.id === ids[0])
    expect(written?.source).toBe('tool_result')
    expect(written?.evidence.messageIds).toEqual(['msg-tool-1'])
  })

  test('contradiction seeds a superseded record and its replacement', () => {
    const ids = seedContradiction(PERSONAL)
    expect(ids).toHaveLength(2)
    expect(listMemoryRecords({ ...PERSONAL, status: 'contradicted' })).toHaveLength(1)
    expect(listMemoryRecords({ ...PERSONAL, status: 'active' })).toHaveLength(1)
  })

  test('missing-embedding seeds a record with no embedding identity', () => {
    const ids = seedMissingEmbedding(PERSONAL)
    expect(ids).toHaveLength(1)
    const written = listMemoryRecords({ ...PERSONAL, status: 'active' }).find((r) => r.id === ids[0])
    expect(embeddingIdentity(written)).toBeNull()
  })

  test('duplicate-out-of-order seeds identical content twice with reversed timestamps', () => {
    const ids = seedDuplicateOutOfOrder(PERSONAL)
    expect(ids).toHaveLength(2)
  })

  test('adversarial-erasure seeds an active record and a provisional twin of the same content', () => {
    const ids = seedAdversarialErasure(PERSONAL)
    expect(ids).toHaveLength(2)
    expect(listMemoryRecords({ ...PERSONAL, status: 'provisional' })).toHaveLength(1)
  })
})
