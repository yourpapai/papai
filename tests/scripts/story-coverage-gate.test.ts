// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import {
  evaluateStoryCoverage,
  formatStoryCoverageEvaluation,
  parseCoverageFloor,
} from '../../scripts/coverage/story-coverage-gate.js'

const LCOV = [
  'SF:src/a.ts',
  'FNF:2',
  'FNH:2',
  'DA:1,1',
  'DA:2,1',
  'DA:3,1',
  'DA:4,0',
  'LF:4',
  'LH:3',
  'end_of_record',
].join('\n')

describe('parseCoverageFloor', () => {
  it('accepts fractional line/function floors', () => {
    expect(parseCoverageFloor('{ "lines": 0.5, "functions": 0.5 }')).toEqual({ lines: 0.5, functions: 0.5 })
  })

  it('rejects out-of-range floors', () => {
    expect(() => parseCoverageFloor('{ "lines": 1.5, "functions": 0.5 }')).toThrow()
  })
})

describe('evaluateStoryCoverage', () => {
  it('passes when totals meet the floor', () => {
    const result = evaluateStoryCoverage(LCOV, { lines: 0.5, functions: 0.5 })
    expect(result.pass).toBe(true)
    expect(result.failures).toEqual([])
    expect(result.lines).toEqual({ found: 4, hit: 3, pct: 0.75 })
  })

  it('fails and lists the metric when below the floor', () => {
    const result = evaluateStoryCoverage(LCOV, { lines: 0.9, functions: 0.5 })
    expect(result.pass).toBe(false)
    expect(result.failures.join(' ')).toContain('lines')
  })

  it('formats a human-readable summary', () => {
    const text = formatStoryCoverageEvaluation(evaluateStoryCoverage(LCOV, { lines: 0.5, functions: 0.5 }))
    expect(text).toContain('75.00%')
  })
})
