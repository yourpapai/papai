// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  escapeHtml,
  fmtBytes,
  fmtNum,
  formatDateTime,
  formatDuration,
  hasSeriesData,
} from '../../../client/shared/helpers.js'

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

describe('formatDateTime', () => {
  test('renders unambiguous UTC date + time (YYYY-MM-DD HH:MM)', () => {
    const ts = Date.UTC(2026, 4, 30, 14, 5)
    expect(formatDateTime(ts)).toBe('2026-05-30 14:05')
    expect(formatDateTime(0)).toBe('1970-01-01 00:00')
  })
  test('accepts ISO string input', () => {
    expect(formatDateTime('2026-05-30T14:05:00.000Z')).toBe('2026-05-30 14:05')
  })
  test('returns em dash for invalid input', () => {
    expect(formatDateTime(Number.NaN)).toBe('—')
    expect(formatDateTime('not-a-date')).toBe('—')
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

describe('formatDuration', () => {
  test('sub-second renders as ms', () => {
    expect(formatDuration(950)).toBe('950ms')
  })

  test('seconds render with one decimal', () => {
    expect(formatDuration(1234)).toBe('1.2s')
    expect(formatDuration(540)).toBe('540ms')
  })

  test('invalid input renders a dash', () => {
    expect(formatDuration(Number.NaN)).toBe('—')
    expect(formatDuration(-5)).toBe('—')
  })
})

describe('hasSeriesData', () => {
  test('is false for undefined, empty, and all-zero series', () => {
    expect(hasSeriesData(undefined)).toBe(false)
    expect(hasSeriesData([])).toBe(false)
    expect(hasSeriesData([0, 0, 0])).toBe(false)
  })

  test('is false for a series of non-finite values', () => {
    expect(hasSeriesData([Number.NaN, Number.POSITIVE_INFINITY])).toBe(false)
  })

  test('is true as soon as one positive finite value is present', () => {
    expect(hasSeriesData([0, 0, 1])).toBe(true)
  })
})

describe('escapeHtml', () => {
  test('escapes & to &amp;', () => {
    expect(escapeHtml('x&y')).toBe('x&amp;y')
  })
})

describe('fmtNum', () => {
  test('honors an explicit dp larger than the default maximumFractionDigits', () => {
    expect(fmtNum(1.123456, 5)).toBe('1.12346')
  })
})

describe('fmtBytes boundary and unit tiers', () => {
  test('treats exactly 1024 as the first KB tier (strict < 1024)', () => {
    expect(fmtBytes(1024)).toBe('1.0 KB')
  })

  test('loop v >= 1024 boundary advances at exactly 1024', () => {
    expect(fmtBytes(1048576)).toBe('1.0 MB')
  })

  test('caps at the TB tier on petabyte-scale input', () => {
    expect(fmtBytes(1024 ** 5)).toBe('1024 TB')
  })

  test('uses zero decimals when v lands exactly on 10', () => {
    expect(fmtBytes(10240)).toBe('10 KB')
  })

  describe('unit tiers', () => {
    test('reaches the GB unit', () => {
      expect(fmtBytes(50 * 1024 ** 3)).toBe('50 GB')
    })

    test('reaches the TB unit', () => {
      expect(fmtBytes(2 * 1024 ** 4)).toBe('2.0 TB')
    })
  })
})

describe('formatDuration', () => {
  test('zero duration renders as 0ms', () => {
    expect(formatDuration(0)).toBe('0ms')
  })

  test('exactly 1000ms renders as 1s', () => {
    expect(formatDuration(1000)).toBe('1s')
  })
})
