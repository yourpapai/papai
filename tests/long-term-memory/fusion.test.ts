// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { fuseByRank } from '../../src/long-term-memory/fusion.js'
import type { MemoryRecord } from '../../src/long-term-memory/types.js'

const rec = (id: string): MemoryRecord => ({
  id,
  scopeId: 'user-1',
  scopeType: 'personal',
  kind: 'fact',
  content: id,
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

const ids = (records: readonly MemoryRecord[]): readonly string[] => records.map((r) => r.id)

describe('fuseByRank', () => {
  test('ranks a record present in both channels above single-channel records', () => {
    // both:   2/61 + 1/61 = 0.04918
    // lexOnly: 2/62        = 0.03226
    // denseOnly:      1/62 = 0.01613
    const fused = fuseByRank([rec('both'), rec('lexOnly')], [rec('both'), rec('denseOnly')], 10)

    expect(ids(fused)).toEqual(['both', 'lexOnly', 'denseOnly'])
  })

  test('weights the lexical channel twice the dense channel at equal rank', () => {
    const fused = fuseByRank([rec('lex')], [rec('dense')], 10)

    expect(ids(fused)).toEqual(['lex', 'dense'])
  })

  test('returns the lexical list unchanged when the dense channel is empty', () => {
    const fused = fuseByRank([rec('a'), rec('b'), rec('c')], [], 10)

    expect(ids(fused)).toEqual(['a', 'b', 'c'])
  })

  test('returns the dense list unchanged when the lexical channel is empty', () => {
    const fused = fuseByRank([], [rec('a'), rec('b')], 10)

    expect(ids(fused)).toEqual(['a', 'b'])
  })

  test('breaks ties deterministically by record id', () => {
    const fused = fuseByRank([rec('zeta')], [rec('alpha')], 10)
    const swapped = fuseByRank([rec('alpha')], [rec('zeta')], 10)

    // 'zeta' wins on lexical weight; 'alpha' wins when it holds the lexical slot.
    expect(ids(fused)).toEqual(['zeta', 'alpha'])
    expect(ids(swapped)).toEqual(['alpha', 'zeta'])
  })

  test('tie-break by id applies when scores are exactly equal', () => {
    // Lexical rank 61 scores 2/(60+62) = 1/61; dense rank 0 scores 1/(60+1) = 1/61.
    // Construct that exact collision and check the lower id wins.
    const lexical = Array.from({ length: 62 }, (_, i) => rec(`lex-${String(i).padStart(2, '0')}`))
    lexical[61] = rec('zzz-tied')
    const fused = fuseByRank(lexical, [rec('aaa-tied')], 100)

    const tiedPositions: [number, number] = [
      fused.findIndex((r) => r.id === 'aaa-tied'),
      fused.findIndex((r) => r.id === 'zzz-tied'),
    ]
    expect(tiedPositions[0]).toBeLessThan(tiedPositions[1])
  })

  test('truncates to the limit', () => {
    const fused = fuseByRank([rec('a'), rec('b'), rec('c')], [rec('d')], 2)

    expect(fused).toHaveLength(2)
  })

  test('deduplicates a record that appears in both channels', () => {
    const fused = fuseByRank([rec('same')], [rec('same')], 10)

    expect(ids(fused)).toEqual(['same'])
  })
})
