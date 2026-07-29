// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { searchLexical } from '../../../src/long-term-memory/lexical-search.js'
import { rankRecordsBySimilarity } from '../../../src/long-term-memory/semantic-search.js'
import { saveMemoryRecord } from '../../../src/long-term-memory/store.js'
import type { MemoryRecordInput } from '../../../src/long-term-memory/types.js'
import { setupTestDb } from '../../utils/test-helpers.js'
import {
  ALL_STATUSES,
  acceptanceRecord,
  MODEL,
  PERSONAL,
  VEC,
  VERSION,
  seedMissingEmbedding,
  seedMultilingual,
} from './corpus.js'
import { CASES } from './reproducibility.cases.js'

const lexicalIds = (query: string): readonly string[] =>
  searchLexical({ ...PERSONAL, query, statuses: ALL_STATUSES, limit: 8 }).map((r) => r.id)

const denseIds = (): readonly string[] =>
  rankRecordsBySimilarity(PERSONAL, VEC, {
    statuses: ALL_STATUSES,
    embeddingVersion: VERSION,
    threshold: 0,
    limit: 8,
  }).map((r) => r.id)

/**
 * `seedMultilingual` / `seedMissingEmbedding` return `readonly string[]`, so destructuring
 * loses definiteness. Narrowing lives here (module scope), not in a `test()` body, matching
 * `requireId` in `erasure.test.ts`.
 */
const requireId = (id: string | undefined): string => {
  if (id === undefined) throw new Error('corpus seed returned fewer ids than expected')
  return id
}

/** Direct writes (beyond the shared corpus fixtures), narrowed outside the test body. */
const mustSave = (input: MemoryRecordInput): string => {
  const saved = saveMemoryRecord(input)
  if (saved === null) throw new Error(`reproducibility fixture write suppressed for ${input.id}`)
  return saved.id
}

describe('acceptance: reproducibility', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test(`multilingual — ${CASES.multilingual}`, () => {
    const [enId] = seedMultilingual(PERSONAL)
    // a second lexical hit on the same term, so the repeated-call comparison below is over a
    // real ordering (length >= 2) rather than a single-element list any order would satisfy
    const extraLexicalId = mustSave(
      acceptanceRecord({
        ...PERSONAL,
        id: `${PERSONAL.scopeId}-acc-berlin-lexical-2`,
        content: 'User also mentioned Berlin during the trip',
      }),
    )
    // a second dense hit with a different (non-tied) cosine similarity to VEC, so the ordering
    // below reflects genuine rank determinism rather than a same-score tie any permutation of
    // which would trivially satisfy
    const extraDenseId = mustSave(
      acceptanceRecord({
        ...PERSONAL,
        id: `${PERSONAL.scopeId}-acc-berlin-dense-2`,
        content: 'User keeps a Berlin apartment',
        embedding: new Float32Array([0.6, 0.8, 0]),
      }),
    )

    const firstLexical = lexicalIds('Berlin')
    expect(firstLexical.length).toBeGreaterThanOrEqual(2)
    expect(firstLexical).toContain(requireId(enId))
    expect(firstLexical).toContain(extraLexicalId)
    expect(lexicalIds('Berlin')).toEqual([...firstLexical])
    expect(lexicalIds('Berlin')).toEqual([...firstLexical])

    const firstDense = denseIds()
    expect(firstDense.length).toBeGreaterThanOrEqual(2)
    expect(firstDense).toContain(requireId(enId))
    expect(firstDense).toContain(extraDenseId)
    // the EN record's embedding is an exact VEC match (cosine 1.0); the extra record's is not
    // (cosine 0.6) — a real score gap, so the fixed rank order below is not a coin flip
    expect(firstDense.indexOf(requireId(enId))).toBeLessThan(firstDense.indexOf(extraDenseId))
    expect(denseIds()).toEqual([...firstDense])
    expect(denseIds()).toEqual([...firstDense])
  })

  test(`missing-embedding — ${CASES['missing-embedding']}`, () => {
    // positive control: the dense channel is live before we check the exclusion below, so an
    // empty result for the no-embedding record proves the exclusion, not a dead channel
    const liveDenseId = mustSave(
      acceptanceRecord({ ...PERSONAL, id: `${PERSONAL.scopeId}-acc-live-dense-1`, content: 'User owns a bicycle' }),
    )
    const [rawId] = seedMissingEmbedding(PERSONAL)
    const noEmbedId = requireId(rawId)

    expect(denseIds()).toContain(liveDenseId)

    // lexical recall is preserved when the embedding is absent
    expect(lexicalIds('Portuguese')).toContain(noEmbedId)
    // the dense channel excludes it rather than comparing incompatible identities
    expect(denseIds()).not.toContain(noEmbedId)
    // and the exclusion is deterministic across repeated calls
    const firstDense = denseIds()
    expect(firstDense).toEqual([...denseIds()])
    expect(firstDense).toEqual([...denseIds()])
  })

  test('incompatible-embedding — wrong model or wrong dimension degrades to lexical, not a cross-identity comparison', () => {
    // positive control: the dense channel is live before we check the exclusions below, so an
    // empty result for the mismatched records proves a real embeddingVersion mismatch, not a
    // dead channel
    const liveDenseId = mustSave(
      acceptanceRecord({ ...PERSONAL, id: `${PERSONAL.scopeId}-acc-live-dense-2`, content: 'User owns a scooter' }),
    )
    const wrongModelId = mustSave(
      acceptanceRecord({
        ...PERSONAL,
        id: `${PERSONAL.scopeId}-acc-wrong-model`,
        content: 'User speaks Icelandic',
        embeddingModel: 'other-model',
        embeddingVersion: `other-model:${VEC.length}`,
      }),
    )
    const wrongDimensionId = mustSave(
      acceptanceRecord({
        ...PERSONAL,
        id: `${PERSONAL.scopeId}-acc-wrong-dim`,
        content: 'User speaks Finnish',
        embedding: new Float32Array([1, 0]),
        embeddingDimension: 2,
        embeddingVersion: `${MODEL}:2`,
      }),
    )

    expect(denseIds()).toContain(liveDenseId)

    // lexical recall is preserved for both mismatched identities
    expect(lexicalIds('Icelandic')).toContain(wrongModelId)
    expect(lexicalIds('Finnish')).toContain(wrongDimensionId)
    // the dense channel excludes both rather than comparing vectors across incompatible spaces
    expect(denseIds()).not.toContain(wrongModelId)
    expect(denseIds()).not.toContain(wrongDimensionId)
    // and the exclusion is deterministic across repeated calls
    const firstDense = denseIds()
    expect(firstDense).toEqual([...denseIds()])
    expect(firstDense).toEqual([...denseIds()])
  })
})
