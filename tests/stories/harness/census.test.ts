// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { censusStories, censusTier } from '../catalog/census.js'
import { catalogCoverage, toPendingReason } from '../catalog/coverage.js'
import { doubleBookedExemptions, SUPPORTING_STORIES } from '../catalog/supporting.js'

function claimedStoryIdsAcrossAllTiers(): Set<string> {
  return new Set(catalogCoverage.flatMap((coverage) => (coverage.kind === 'executable' ? [...coverage.storyIds] : [])))
}

describe('censusStories', () => {
  test('reports an observed story that no record claims as an orphan', () => {
    const census = censusStories({
      tier: '0',
      observed: ['a.story.test.ts#claimed', 'a.story.test.ts#orphan'],
      claimed: ['a.story.test.ts#claimed'],
      supporting: [],
    })

    expect(census.orphans).toEqual(['a.story.test.ts#orphan'])
    expect(census.dangling).toEqual([])
  })

  test('reports a claimed story that no lane declares as dangling', () => {
    const census = censusStories({
      tier: '0',
      observed: ['a.story.test.ts#present'],
      claimed: ['a.story.test.ts#present', 'a.story.test.ts#vanished'],
      supporting: [],
    })

    expect(census.dangling).toEqual(['a.story.test.ts#vanished'])
    expect(census.orphans).toEqual([])
  })

  test('a supporting declaration suppresses the orphan without claiming coverage', () => {
    const census = censusStories({
      tier: '0',
      observed: ['a.story.test.ts#helper'],
      claimed: [],
      supporting: ['a.story.test.ts#helper'],
    })

    expect(census.orphans).toEqual([])
    expect(census.claimed).toBe(0)
    expect(census.supporting).toBe(1)
  })

  test('a supporting id the lane never declares is dangling too', () => {
    const census = censusStories({
      tier: '2',
      observed: [],
      claimed: [],
      supporting: ['a.smoke.ts#stale'],
    })

    expect(census.dangling).toEqual(['a.smoke.ts#stale'])
  })

  test('sorts and deduplicates orphans so failure output is stable', () => {
    const census = censusStories({
      tier: '0',
      observed: ['z.story.test.ts#b', 'a.story.test.ts#a', 'z.story.test.ts#b'],
      claimed: [],
      supporting: [],
    })

    expect(census.orphans).toEqual(['a.story.test.ts#a', 'z.story.test.ts#b'])
  })

  test('carries the tier through for failure messages', () => {
    expect(censusStories({ tier: '3', observed: [], claimed: [], supporting: [] })).toEqual({
      tier: '3',
      orphans: [],
      dangling: [],
      claimed: 0,
      supporting: 0,
    })
  })
})

describe('exemption contract', () => {
  test('names an exemption that a catalog record already claims', () => {
    expect(
      doubleBookedExemptions({ 'a.story.test.ts#x': toPendingReason('helper') }, new Set(['a.story.test.ts#x'])),
    ).toEqual(['a.story.test.ts#x'])
  })

  test('accepts an exemption that no record claims', () => {
    expect(doubleBookedExemptions({ 'a.story.test.ts#x': toPendingReason('helper') }, new Set())).toEqual([])
  })

  test('no live exemption is double-booked against the real catalog', () => {
    expect(doubleBookedExemptions(SUPPORTING_STORIES, claimedStoryIdsAcrossAllTiers())).toEqual([])
  })

  // The non-blank-rationale invariant is enforced by construction, not by assertion:
  // toPendingReason throws before a blank rationale can reach SUPPORTING_STORIES.
  test('rejects a blank rationale at the boundary rather than at assertion time', () => {
    expect(() => toPendingReason('  ')).toThrow('Pending reason must not be empty')
  })
})

describe('censusTier', () => {
  test('reads the live ledger rather than an empty claim set', () => {
    // Guards the wiring itself: an exemption filter that matched everything, or a claim
    // filter that matched nothing, would make every lane's census meaningless.
    expect(censusTier('0', []).claimed).toBeGreaterThan(100)
    // The Kaneo conformance sweep contributes 6 provider-wiring exemptions (see
    // SUPPORTING_STORIES); the count tracks that live set, not a fixed zero.
    expect(censusTier('0', []).supporting).toBe(Object.keys(SUPPORTING_STORIES).length)
  })
})
