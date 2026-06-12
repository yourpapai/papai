// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { fmtBytes, fmtNum } from '../../../client/shared/helpers'

describe('fmtNum', () => {
  test('rounds to <=2dp by default and adds thousands separators', () => {
    expect(fmtNum(11.500000000000004)).toBe('11.5')
    expect(fmtNum(15.549999999999997)).toBe('15.55')
    expect(fmtNum(1171965.2000000002, 0)).toBe('1,171,965')
  })
  test('returns em dash for null/undefined/empty/non-finite', () => {
    expect(fmtNum(null)).toBe('—')
    expect(fmtNum(undefined)).toBe('—')
    expect(fmtNum('')).toBe('—')
    expect(fmtNum(Number.POSITIVE_INFINITY)).toBe('—')
  })
  test('passes through non-empty strings unchanged', () => {
    expect(fmtNum('n/a')).toBe('n/a')
  })
})

describe('fmtBytes', () => {
  test('humanizes using base 1024', () => {
    expect(fmtBytes(512)).toBe('512 B')
    expect(fmtBytes(1395505)).toBe('1.3 MB')
    expect(fmtBytes(277806)).toBe('271 KB')
  })
  test('returns em dash for null/undefined', () => {
    expect(fmtBytes(null)).toBe('—')
    expect(fmtBytes(undefined)).toBe('—')
  })
})
