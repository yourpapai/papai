// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { censusStories } from '../catalog/census.js'

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
