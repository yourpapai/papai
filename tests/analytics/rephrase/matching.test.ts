// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { PseudonymSchema } from '../../../src/analytics/controlled-types.js'
import type { Pseudonym } from '../../../src/analytics/controlled-types.js'
import { buildLexicalFeatures } from '../../../src/analytics/intent/rephrase.js'
import type { RephrasePairDetection, RephrasePriorOutcome } from '../../../src/analytics/intent/rephrase.js'
import { attachPriorToLaterSets, matchNewEntryAgainstPriors } from '../../../src/analytics/rephrase/matching.js'
import type { MatchableBucket, MatchableEntry } from '../../../src/analytics/rephrase/matching.js'

const T0 = 1_700_000_000_000
const px = (suffix: string): Pseudonym => PseudonymSchema.parse(`v1.${suffix}`)
const TEXT = 'please create a task to review the lighthouse budget report'
const OTHER_TEXT = 'fetch the public example page and archive it somewhere safe'

const entry = (
  turn: string,
  capturedAtMs: number,
  text: string = TEXT,
  outcome: RephrasePriorOutcome | null = null,
): MatchableEntry => ({
  turnKey: px(turn),
  capturedAtMs,
  features: buildLexicalFeatures(text),
  status: outcome === null ? 'pending' : 'unresolved',
  outcome,
  matchedPriorTurnKey: null,
})

const bucket = (sets: MatchableEntry[]): MatchableBucket => ({
  actorKey: px('actor'),
  conversationKey: px('conv'),
  sets,
})

const collect = (): { pairs: RephrasePairDetection[]; sink: (pair: RephrasePairDetection) => void } => {
  const pairs: RephrasePairDetection[] = []
  return {
    pairs,
    sink: (pair) => {
      pairs.push(pair)
    },
  }
}

describe('rephrase matching', () => {
  test('a new entry matches the newest qualifying unresolved prior', () => {
    const { pairs, sink } = collect()
    const prior = entry('turn-1', T0, TEXT, 'failure')
    const dissimilar = entry('turn-2', T0 + 10_000, OTHER_TEXT, 'clarification')
    const later = entry('turn-3', T0 + 20_000)
    const target = bucket([prior, dissimilar, later])
    matchNewEntryAgainstPriors(sink, target, later)
    expect(pairs).toHaveLength(1)
    expect(pairs[0]?.priorTurnKey).toBe(px('turn-1'))
    expect(later.matchedPriorTurnKey).toBe(px('turn-1'))
  })

  test('pending priors are never matched', () => {
    const { pairs, sink } = collect()
    const prior = entry('turn-1', T0)
    const later = entry('turn-2', T0 + 30_000)
    const target = bucket([prior, later])
    matchNewEntryAgainstPriors(sink, target, later)
    expect(pairs).toHaveLength(0)
    expect(later.matchedPriorTurnKey).toBeNull()
  })

  test('a prior beyond the compare window stops the scan', () => {
    const { pairs, sink } = collect()
    const older = entry('turn-0', T0, TEXT, 'failure')
    const newer = entry('turn-1', T0 + 650_000, OTHER_TEXT, 'failure')
    const later = entry('turn-2', T0 + 700_001)
    const target = bucket([older, newer, later])
    matchNewEntryAgainstPriors(sink, target, later)
    expect(pairs).toHaveLength(0)
  })

  test('an unresolved prior attaches to the newest qualifying later set', () => {
    const { pairs, sink } = collect()
    const prior = entry('turn-1', T0)
    const dissimilar = entry('turn-2', T0 + 10_000, OTHER_TEXT)
    const later = entry('turn-3', T0 + 30_000)
    const target = bucket([prior, dissimilar, later])
    prior.status = 'unresolved'
    prior.outcome = 'no_action'
    attachPriorToLaterSets(sink, target, prior)
    expect(pairs).toHaveLength(1)
    expect(pairs[0]?.laterTurnKey).toBe(px('turn-3'))
    expect(pairs[0]?.priorOutcome).toBe('no_action')
    expect(later.matchedPriorTurnKey).toBe(px('turn-1'))
  })

  test('an already matched later set is never re-paired', () => {
    const { pairs, sink } = collect()
    const prior = entry('turn-1', T0, TEXT, 'failure')
    const later = entry('turn-2', T0 + 30_000)
    later.matchedPriorTurnKey = px('turn-0')
    const target = bucket([prior, later])
    attachPriorToLaterSets(sink, target, prior)
    expect(pairs).toHaveLength(0)
  })
})
