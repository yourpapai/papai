// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mergeReports } from '../../../scripts/mutation/score-merger.js'
import type { StrykerReport } from '../../../scripts/mutation/score-merger.js'

const makeReport = (statuses: string[]): StrykerReport => ({
  files: {
    'src/x.ts': { mutants: statuses.map((status, i) => ({ id: `m${i}`, status })) },
  },
})

describe('mergeReports', () => {
  test('returns all-zero counts for an empty input', () => {
    const out = mergeReports([])
    expect(out).toEqual({
      killed: 0,
      survived: 0,
      noCoverage: 0,
      timeout: 0,
      compileError: 0,
      ignored: 0,
      runtimeError: 0,
      pending: 0,
      total: 0,
      scored: 0,
      score: 0,
    })
  })

  test('computes counts and score across one report', () => {
    const out = mergeReports([makeReport(['Killed', 'Killed', 'Survived', 'NoCoverage', 'CompileError'])])
    expect(out.killed).toBe(2)
    expect(out.survived).toBe(1)
    expect(out.noCoverage).toBe(1)
    expect(out.compileError).toBe(1)
    expect(out.total).toBe(5)
    expect(out.scored).toBe(4)
    expect(out.score).toBeCloseTo(0.5, 5)
  })

  test('sums across multiple reports', () => {
    const out = mergeReports([makeReport(['Killed', 'Survived']), makeReport(['Killed', 'Timeout', 'NoCoverage'])])
    expect(out.killed).toBe(2)
    expect(out.survived).toBe(1)
    expect(out.timeout).toBe(1)
    expect(out.noCoverage).toBe(1)
    expect(out.score).toBeCloseTo(0.6, 5)
  })

  test('treats an all-Ignored report as score 0 with no scored mutants', () => {
    const out = mergeReports([makeReport(['Ignored', 'Ignored'])])
    expect(out.ignored).toBe(2)
    expect(out.scored).toBe(0)
    expect(out.score).toBe(0)
  })

  test('treats a Pending report as total-only with no scored mutants', () => {
    const out = mergeReports([makeReport(['Pending'])])
    expect(out.pending).toBe(1)
    expect(out.runtimeError).toBe(0)
    expect(out.total).toBe(1)
    expect(out.scored).toBe(0)
    expect(out.score).toBe(0)
  })

  test('handles missing report fields as zero-count reports', () => {
    const out = mergeReports([{}, { files: {} }, { files: { 'src/x.ts': {} } }])
    expect(out).toEqual({
      killed: 0,
      survived: 0,
      noCoverage: 0,
      timeout: 0,
      compileError: 0,
      ignored: 0,
      runtimeError: 0,
      pending: 0,
      total: 0,
      scored: 0,
      score: 0,
    })
  })

  test('counts RuntimeError as runtimeError without scoring it', () => {
    const out = mergeReports([makeReport(['RuntimeError'])])
    expect(out.runtimeError).toBe(1)
    expect(out.total).toBe(1)
    expect(out.scored).toBe(0)
    expect(out.score).toBe(0)
  })

  test('counts unknown statuses under runtimeError so they are visible', () => {
    const out = mergeReports([makeReport(['Killed', 'WeirdNewBucket'])])
    expect(out.killed).toBe(1)
    expect(out.runtimeError).toBe(1)
  })
})
