// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  buildConsolidatedVocabulary,
  buildMergeMap,
  electCanonical,
  remapKeywords,
} from '../../../scripts/behavior-audit/consolidate-keywords-helpers.js'
import type { KeywordVocabularyEntry } from '../../../scripts/behavior-audit/keyword-vocabulary.js'

function makeEntry(slug: string, createdAt: string | null): KeywordVocabularyEntry {
  if (createdAt === null) {
    return { slug, description: 'desc', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
  }
  return { slug, description: 'desc', createdAt, updatedAt: '2026-01-01T00:00:00.000Z' }
}

describe('consolidate-keywords-helpers barrel', () => {
  test('keeps clustering internals out of the runtime barrel surface', async () => {
    const module = await import('../../../scripts/behavior-audit/consolidate-keywords-helpers.js')

    expect(module.buildClustersAdvanced).toBeDefined()
    expect(module.toNormalizedFloat64Arrays).toBeDefined()
    expect(module.remapKeywords).toBeDefined()

    expect('buildClusters' in module).toBe(false)
    expect('averageLinkageSimilarity' in module).toBe(false)
    expect('buildClustersNormalized' in module).toBe(false)
    expect('buildUnionFind' in module).toBe(false)
    expect('completeLinkageSimilarity' in module).toBe(false)
    expect('cosineSimilarity' in module).toBe(false)
    expect('find' in module).toBe(false)
    expect('union' in module).toBe(false)
  })

  test('does not re-export LinkageMode from the helper barrel source', async () => {
    const source = await Bun.file(
      new URL('../../../scripts/behavior-audit/consolidate-keywords-helpers.ts', import.meta.url),
    ).text()

    expect(source).not.toContain('LinkageMode')
  })
})

describe('electCanonical', () => {
  test('selects the shorter slug', () => {
    const entries = [makeEntry('long-slug-name', null), makeEntry('short', null)]
    const canonical = electCanonical(entries)
    expect(canonical.slug).toBe('short')
  })

  test('breaks slug length tie by earliest createdAt', () => {
    const entries = [makeEntry('aaa', '2026-02-01T00:00:00.000Z'), makeEntry('bbb', '2026-01-01T00:00:00.000Z')]
    const canonical = electCanonical(entries)
    expect(canonical.slug).toBe('bbb')
  })
})

describe('buildMergeMap', () => {
  test('maps non-canonical slugs to canonical slug', () => {
    const vocabulary = [makeEntry('short', null), makeEntry('longer-version', null), makeEntry('also-longer', null)]
    const clusters = [[0, 1, 2]]
    const mergeMap = buildMergeMap(vocabulary, clusters)

    expect(mergeMap.get('longer-version')).toBe('short')
    expect(mergeMap.get('also-longer')).toBe('short')
    expect(mergeMap.has('short')).toBe(false)
  })

  test('does not include unclustered entries', () => {
    const vocabulary = [makeEntry('solo', null), makeEntry('a', null), makeEntry('b', null)]
    const clusters = [[1, 2]]
    const mergeMap = buildMergeMap(vocabulary, clusters)

    expect(mergeMap.has('solo')).toBe(false)
    expect(mergeMap.size).toBe(1)
  })
})

describe('remapKeywords', () => {
  test('replaces keywords that appear in mergeMap', () => {
    const mergeMap = new Map([['old-slug', 'new-slug']])
    const result = remapKeywords(['old-slug', 'other'], mergeMap)
    expect(result).toEqual(['new-slug', 'other'])
  })

  test('deduplicates after remapping', () => {
    const mergeMap = new Map([
      ['alias', 'canonical'],
      ['alias2', 'canonical'],
    ])
    const result = remapKeywords(['alias', 'alias2', 'unrelated'], mergeMap)
    expect(result).toEqual(['canonical', 'unrelated'])
  })

  test('preserves order when deduplicating', () => {
    const mergeMap = new Map([['b', 'a']])
    const result = remapKeywords(['a', 'b', 'c'], mergeMap)
    expect(result).toEqual(['a', 'c'])
  })

  test('leaves unaffected keywords unchanged', () => {
    const mergeMap = new Map<string, string>()
    const result = remapKeywords(['one', 'two', 'three'], mergeMap)
    expect(result).toEqual(['one', 'two', 'three'])
  })
})

describe('buildConsolidatedVocabulary', () => {
  test('removes merged slugs and keeps canonicals', () => {
    const vocabulary = [
      {
        slug: 'short',
        description: 'short desc',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
      {
        slug: 'long-variant',
        description: 'a longer description for the variant',
        createdAt: '2026-01-03T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z',
      },
    ]
    const mergeMap = new Map([['long-variant', 'short']])
    const now = '2026-04-27T12:00:00.000Z'
    const result = buildConsolidatedVocabulary(vocabulary, mergeMap, now)

    expect(result).toHaveLength(1)
    const entry = result[0]!
    expect(entry.slug).toBe('short')
    expect(entry.description).toBe('a longer description for the variant')
    expect(entry.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(entry.updatedAt).toBe(now)
  })

  test('leaves unmerged entries unchanged', () => {
    const vocabulary = [
      {
        slug: 'standalone',
        description: 'desc',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]
    const mergeMap = new Map<string, string>()
    const now = '2026-04-27T12:00:00.000Z'
    const result = buildConsolidatedVocabulary(vocabulary, mergeMap, now)

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual(vocabulary[0])
  })

  test('returns entries sorted by slug', () => {
    const vocabulary = [
      { slug: 'zebra', description: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
      { slug: 'alpha', description: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    ]
    const result = buildConsolidatedVocabulary(vocabulary, new Map(), '2026-04-27T00:00:00.000Z')
    expect(result[0]!.slug).toBe('alpha')
    expect(result[1]!.slug).toBe('zebra')
  })
})
