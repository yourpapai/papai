// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.
import { describe, expect, test } from 'bun:test'

import { applyThreshold, nextFloor, parseBunfigThreshold, parseLcovTotals } from '../../scripts/coverage/ratchet-lib.js'

const LCOV = [
  'SF:src/a.ts',
  'FNF:4',
  'FNH:3',
  'LF:10',
  'LH:9',
  'end_of_record',
  'SF:src/b.ts',
  'FNF:6',
  'FNH:6',
  'LF:10',
  'LH:10',
  'end_of_record',
  '',
].join('\n')

describe('parseLcovTotals', () => {
  test('pools found/hit but computes pct as the unweighted per-file mean', () => {
    const totals = parseLcovTotals(LCOV)
    expect(totals.lines).toEqual({ found: 20, hit: 19, pct: 0.95 })
    expect(totals.functions).toEqual({ found: 10, hit: 9, pct: 0.875 })
  })

  test('pct is 0 when nothing found', () => {
    expect(parseLcovTotals('').lines).toEqual({ found: 0, hit: 0, pct: 0 })
  })

  test('excludes zero-found records from the mean, per metric', () => {
    const lcov = [
      'SF:src/a.ts',
      'FNF:0',
      'FNH:0',
      'LF:10',
      'LH:5',
      'end_of_record',
      'SF:src/b.ts',
      'FNF:4',
      'FNH:2',
      'LF:10',
      'LH:10',
      'end_of_record',
      '',
    ].join('\n')
    const totals = parseLcovTotals(lcov)
    // functions: file a has FNF:0 and is excluded; only file b (2/4 = 0.5) contributes.
    expect(totals.functions).toEqual({ found: 4, hit: 2, pct: 0.5 })
    // lines: both records have found > 0, so both contribute: a = 5/10 = 0.5, b = 10/10 = 1.0 -> mean 0.75.
    expect(totals.lines).toEqual({ found: 20, hit: 15, pct: 0.75 })
  })
})

describe('parseBunfigThreshold', () => {
  test('reads lines and functions from the coverageThreshold line', () => {
    const toml = 'coverageThreshold = { lines = 0.90, functions = 0.88 }\n'
    expect(parseBunfigThreshold(toml)).toEqual({ lines: 0.9, functions: 0.88 })
  })

  test('throws when the line is missing', () => {
    expect(() => parseBunfigThreshold('[test]\n')).toThrow()
  })
})

describe('nextFloor', () => {
  test('ratchets up to floor(measured - epsilon), 2 decimals', () => {
    expect(nextFloor(0.9, 0.9233, 0.005)).toBe(0.91)
  })

  test('never lowers the current floor', () => {
    expect(nextFloor(0.92, 0.9051, 0.005)).toBe(0.92)
  })

  test('is a no-op when improvement is within epsilon', () => {
    expect(nextFloor(0.9, 0.902, 0.005)).toBe(0.9)
  })
})

describe('applyThreshold', () => {
  test('rewrites only the coverageThreshold line', () => {
    const toml = '[test]\ncoverageThreshold = { lines = 0.90, functions = 0.90 }\ntimeout = 15000\n'
    const out = applyThreshold(toml, { lines: 0.91, functions: 0.9 })
    expect(out).toContain('coverageThreshold = { lines = 0.91, functions = 0.9 }')
    expect(out).toContain('timeout = 15000')
  })
})
