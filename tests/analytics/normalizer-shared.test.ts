// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { byteBucket, countBucket, lengthBucket, nonNegativeInt } from '../../src/analytics/normalizer-shared.js'

describe('normalizer-shared buckets', () => {
  test('count bucket boundaries', () => {
    expect(countBucket(0)).toBe('0')
    expect(countBucket(1)).toBe('1')
    expect(countBucket(2)).toBe('2')
    expect(countBucket(3)).toBe('3_5')
    expect(countBucket(5)).toBe('3_5')
    expect(countBucket(6)).toBe('6_10')
    expect(countBucket(10)).toBe('6_10')
    expect(countBucket(11)).toBe('11_20')
    expect(countBucket(20)).toBe('11_20')
    expect(countBucket(21)).toBe('21_plus')
    expect(countBucket(1000)).toBe('21_plus')
  })

  test('length bucket boundaries', () => {
    expect(lengthBucket(0)).toBe('0')
    expect(lengthBucket(1)).toBe('1_32')
    expect(lengthBucket(32)).toBe('1_32')
    expect(lengthBucket(33)).toBe('33_128')
    expect(lengthBucket(128)).toBe('33_128')
    expect(lengthBucket(129)).toBe('129_512')
    expect(lengthBucket(512)).toBe('129_512')
    expect(lengthBucket(513)).toBe('513_2048')
    expect(lengthBucket(2048)).toBe('513_2048')
    expect(lengthBucket(2049)).toBe('2049_plus')
  })

  test('byte bucket boundaries', () => {
    expect(byteBucket(0)).toBe('0')
    expect(byteBucket(1)).toBe('1_256')
    expect(byteBucket(256)).toBe('1_256')
    expect(byteBucket(257)).toBe('257_1024')
    expect(byteBucket(1024)).toBe('257_1024')
    expect(byteBucket(1025)).toBe('1025_8192')
    expect(byteBucket(8192)).toBe('1025_8192')
    expect(byteBucket(8193)).toBe('8193_65536')
    expect(byteBucket(65536)).toBe('8193_65536')
    expect(byteBucket(65537)).toBe('65537_plus')
  })

  test('non-negative finite integers only', () => {
    expect(nonNegativeInt(0)).toBe(0)
    expect(nonNegativeInt(42)).toBe(42)
    expect(nonNegativeInt(-1)).toBeNull()
    expect(nonNegativeInt(1.5)).toBeNull()
    expect(nonNegativeInt(Number.NaN)).toBeNull()
    expect(nonNegativeInt(Number.POSITIVE_INFINITY)).toBeNull()
  })

  test('buckets reject negative and non-integer input', () => {
    expect(countBucket(-1)).toBeNull()
    expect(lengthBucket(2.5)).toBeNull()
    expect(byteBucket(Number.NaN)).toBeNull()
  })
})
