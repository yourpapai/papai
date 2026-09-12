// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { formatStoryCoverageReport } from '../../scripts/coverage/story-coverage-report.js'

describe('formatStoryCoverageReport', () => {
  test('orders files by missing lines, then missing functions, then path', () => {
    const lcov = [
      'SF:src/b.ts',
      'FNF:2',
      'FNH:1',
      'DA:1,0',
      'DA:2,1',
      'end_of_record',
      'SF:src/a.ts',
      'FNF:2',
      'FNH:0',
      'DA:1,0',
      'DA:2,0',
      'end_of_record',
    ].join('\n')

    expect(formatStoryCoverageReport(lcov)).toContain('src/a.ts lines 0/2 functions 0/2')
    expect(formatStoryCoverageReport(lcov).indexOf('src/a.ts')).toBeLessThan(
      formatStoryCoverageReport(lcov).indexOf('src/b.ts'),
    )
  })

  test('returns a stable no-uncovered message when every record is covered', () => {
    const lcov = ['SF:src/a.ts', 'FNF:1', 'FNH:1', 'DA:1,1', 'end_of_record'].join('\n')
    expect(formatStoryCoverageReport(lcov)).toBe('T0 uncovered production files: none')
  })

  test('throws its exact malformed-record error when FNF is missing', () => {
    const lcov = ['SF:src/a.ts', 'FNH:0', 'DA:1,0', 'end_of_record'].join('\n')
    expect(() => formatStoryCoverageReport(lcov)).toThrow('Malformed lcov record: missing FNF')
  })

  test('throws its exact malformed-record error when DA records are missing', () => {
    const lcov = ['SF:src/a.ts', 'FNF:1', 'FNH:0', 'end_of_record'].join('\n')
    expect(() => formatStoryCoverageReport(lcov)).toThrow('Malformed lcov record: missing source or DA field')
  })

  test('falls back to LF/LH line totals for the seeded-record shape (no DA, valid LF/LH)', () => {
    const lcov = ['SF:src/a.ts', 'FNF:1', 'FNH:0', 'LF:1', 'LH:0', 'end_of_record'].join('\n')
    expect(formatStoryCoverageReport(lcov)).toContain('src/a.ts lines 0/1 functions 0/1')
  })

  test('keeps DA authoritative when both DA and LF/LH are present', () => {
    const lcov = ['SF:src/a.ts', 'FNF:1', 'FNH:0', 'LF:5', 'LH:5', 'DA:1,0', 'DA:2,1', 'end_of_record'].join('\n')
    expect(formatStoryCoverageReport(lcov)).toContain('src/a.ts lines 1/2 functions 0/1')
  })
})
