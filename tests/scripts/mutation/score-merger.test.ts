// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  combineMergedScores,
  isMergedScore,
  mergeReports,
  survivingMutantIds,
} from '../../../scripts/mutation/score-merger.js'
import type { MergedScore, StrykerReport } from '../../../scripts/mutation/score-merger.js'

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

describe('survivingMutantIds', () => {
  test('returns ids of Survived and NoCoverage mutants only, since both count against the score', () => {
    const ids = survivingMutantIds(makeReport(['Killed', 'Survived', 'NoCoverage', 'Timeout', 'Ignored']))
    expect(ids).toEqual(['m1', 'm2'])
  })

  test('unions ids across all files in the report', () => {
    const report: StrykerReport = {
      files: {
        'src/a.ts': { mutants: [{ id: 'a1', status: 'Survived' }] },
        'src/b.ts': {
          mutants: [
            { id: 'b1', status: 'NoCoverage' },
            { id: 'b2', status: 'Killed' },
          ],
        },
      },
    }
    expect(survivingMutantIds(report)).toEqual(['a1', 'b1'])
  })

  test('returns an empty list for missing fields, empty reports, and all-killed reports', () => {
    expect(survivingMutantIds({})).toEqual([])
    expect(survivingMutantIds({ files: { 'src/x.ts': {} } })).toEqual([])
    expect(survivingMutantIds(makeReport(['Killed', 'Timeout']))).toEqual([])
  })

  // A survivor without an id can never be matched against an agent-declared
  // residual, so it must be excluded here; the pipeline's set-equality check
  // then fails closed (not capped) instead of silently ignoring it.
  test('skips mutants without a string id', () => {
    const report: StrykerReport = {
      files: { 'src/x.ts': { mutants: [{ status: 'Survived' }, { id: 'x1', status: 'Survived' }] } },
    }
    expect(survivingMutantIds(report)).toEqual(['x1'])
  })
})

describe('combineMergedScores', () => {
  const score = (over: Partial<MergedScore>): MergedScore => ({
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
    ...over,
  })

  test('returns all-zero counts for an empty input, matching mergeReports([])', () => {
    expect(combineMergedScores([])).toEqual(mergeReports([]))
  })

  // The two files deliberately carry DIFFERENT mutant counts. An implementation that
  // averaged the per-file `score` fields would return 0.75 here; pooling the mutants
  // the way mergeReports does returns 7/10. A fixture with equal counts cannot tell
  // the two apart, which is exactly how an averaging bug survives review.
  test('pools mutants across files rather than averaging their scores', () => {
    const small = score({ killed: 1, survived: 1, total: 2, scored: 2, score: 0.5 })
    const large = score({ killed: 6, survived: 2, total: 8, scored: 8, score: 0.75 })
    const out = combineMergedScores([small, large])
    expect(out.killed).toBe(7)
    expect(out.survived).toBe(3)
    expect(out.scored).toBe(10)
    expect(out.score).toBe(0.7)
  })

  test('counts timeouts in the numerator, as mergeReports does', () => {
    const out = combineMergedScores([score({ killed: 1, timeout: 1, survived: 2, total: 4, scored: 4, score: 0.5 })])
    expect(out.score).toBe(0.5)
  })

  test('sums the non-scoring buckets without letting them reach the score', () => {
    const out = combineMergedScores([
      score({ killed: 1, compileError: 2, ignored: 3, runtimeError: 4, pending: 5, total: 15, scored: 1, score: 1 }),
      score({ killed: 1, compileError: 1, ignored: 1, runtimeError: 1, pending: 1, total: 5, scored: 1, score: 1 }),
    ])
    expect(out.compileError).toBe(3)
    expect(out.ignored).toBe(4)
    expect(out.runtimeError).toBe(5)
    expect(out.pending).toBe(6)
    expect(out.total).toBe(20)
    expect(out.score).toBe(1)
  })

  test('yields 0 rather than NaN when nothing is scoreable', () => {
    const out = combineMergedScores([score({ ignored: 3, total: 3 }), score({ pending: 1, total: 1 })])
    expect(out.scored).toBe(0)
    expect(out.score).toBe(0)
  })
})

describe('isMergedScore', () => {
  const valid: MergedScore = {
    killed: 1,
    survived: 1,
    noCoverage: 0,
    timeout: 0,
    compileError: 0,
    ignored: 0,
    runtimeError: 0,
    pending: 0,
    total: 2,
    scored: 2,
    score: 0.5,
  }

  test('accepts a real merged score', () => {
    expect(isMergedScore(valid)).toBe(true)
  })

  test('rejects non-objects', () => {
    expect(isMergedScore(null)).toBe(false)
    expect(isMergedScore(undefined)).toBe(false)
    expect(isMergedScore('0.5')).toBe(false)
    expect(isMergedScore([valid])).toBe(false)
  })

  test('rejects a score missing any count field', () => {
    const { timeout: _timeout, ...missing } = valid
    expect(isMergedScore(missing)).toBe(false)
  })

  // A cache file is arbitrary JSON from a previous run's environment; NaN/Infinity
  // round-trip as null through JSON but a hand-edited file can carry anything, and a
  // non-finite score would poison every comparison the ratchet makes.
  test('rejects non-finite and non-numeric fields', () => {
    expect(isMergedScore({ ...valid, score: Number.NaN })).toBe(false)
    expect(isMergedScore({ ...valid, killed: Number.POSITIVE_INFINITY })).toBe(false)
    expect(isMergedScore({ ...valid, scored: '2' })).toBe(false)
  })
})
