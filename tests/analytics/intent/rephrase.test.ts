// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  buildLexicalFeatures,
  gapBucketFor,
  isWithinCompareWindow,
  lexicalSimilarity,
  REPHARSE_COMPARE_WINDOW_MS,
  REPHARSE_MAX_SETS_PER_CONVERSATION,
  REPHARSE_SET_TTL_MS,
  similarityBucketFor,
} from '../../../src/analytics/intent/rephrase.js'

const tokens = (words: readonly string[]): string => words.join(' ')

describe('lexical feature construction', () => {
  test('features are shingle hashes and a token count, never raw text', () => {
    const features = buildLexicalFeatures('create a task to inspect the lighthouse')
    expect(features.tokenCount).toBe(7)
    expect(features.shingleHashes.size).toBeGreaterThan(0)
    expect(JSON.stringify(features)).not.toContain('lighthouse')
  })

  test('short texts still produce a comparable feature set', () => {
    const features = buildLexicalFeatures('thanks')
    expect(features.tokenCount).toBe(1)
    expect(features.shingleHashes.size).toBe(1)
  })

  test('empty text produces no shingles', () => {
    const features = buildLexicalFeatures('   !!!  ')
    expect(features.tokenCount).toBe(0)
    expect(features.shingleHashes.size).toBe(0)
  })

  test('tokenization is case-insensitive and punctuation-insensitive', () => {
    const left = buildLexicalFeatures('Create a TASK, please!')
    const right = buildLexicalFeatures('create a task please')
    expect(lexicalSimilarity(left, right)).toBe(1)
  })
})

describe('lexical similarity', () => {
  test('identical texts score 1', () => {
    const left = buildLexicalFeatures(tokens(['a', 'b', 'c', 'd', 'e']))
    const right = buildLexicalFeatures(tokens(['a', 'b', 'c', 'd', 'e']))
    expect(lexicalSimilarity(left, right)).toBe(1)
  })

  test('disjoint texts score 0', () => {
    const left = buildLexicalFeatures(tokens(['a', 'b', 'c', 'd', 'e']))
    const right = buildLexicalFeatures(tokens(['v', 'w', 'x', 'y', 'z']))
    expect(lexicalSimilarity(left, right)).toBe(0)
  })

  test('two empty sets score 0', () => {
    expect(lexicalSimilarity(buildLexicalFeatures(''), buildLexicalFeatures(''))).toBe(0)
  })

  test('a one-token tail change on a twenty-token text lands in the 080_089 band', () => {
    const base = Array.from({ length: 19 }, (_, index) => `w${index}`)
    const left = buildLexicalFeatures(tokens([...base, 'alpha']))
    const right = buildLexicalFeatures(tokens([...base, 'beta']))
    const similarity = lexicalSimilarity(left, right)
    expect(similarity).toBeGreaterThanOrEqual(0.8)
    expect(similarity).toBeLessThan(0.9)
  })
})

describe('bucket boundaries', () => {
  test('similarity buckets split at 0.80, 0.90, and 0.95', () => {
    expect(similarityBucketFor(0.79)).toBeNull()
    expect(similarityBucketFor(0.8)).toBe('080_089')
    expect(similarityBucketFor(0.89)).toBe('080_089')
    expect(similarityBucketFor(0.9)).toBe('090_094')
    expect(similarityBucketFor(0.94)).toBe('090_094')
    expect(similarityBucketFor(0.95)).toBe('ge_095')
    expect(similarityBucketFor(1)).toBe('ge_095')
  })

  test('gap buckets split at two minutes and close at ten minutes', () => {
    expect(gapBucketFor(-1)).toBeNull()
    expect(gapBucketFor(0)).toBe('le_2m')
    expect(gapBucketFor(119_999)).toBe('le_2m')
    expect(gapBucketFor(120_000)).toBe('2m_10m')
    expect(gapBucketFor(599_999)).toBe('2m_10m')
    expect(gapBucketFor(600_000)).toBe('2m_10m')
    expect(gapBucketFor(600_001)).toBeNull()
  })

  test('compare window includes exactly ten minutes', () => {
    expect(isWithinCompareWindow(0)).toBe(true)
    expect(isWithinCompareWindow(REPHARSE_COMPARE_WINDOW_MS)).toBe(true)
    expect(isWithinCompareWindow(REPHARSE_COMPARE_WINDOW_MS + 1)).toBe(false)
    expect(isWithinCompareWindow(-1)).toBe(false)
  })

  test('retention constants are three sets and thirty minutes', () => {
    expect(REPHARSE_MAX_SETS_PER_CONVERSATION).toBe(3)
    expect(REPHARSE_SET_TTL_MS).toBe(1_800_000)
  })
})
