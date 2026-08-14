// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it, test } from 'bun:test'

import {
  buildBaselineFromPerFile,
  isBaselineMap,
  ratchetMerge,
  resolveRatchet,
  seedMerge,
} from '../../../scripts/mutation/baseline.js'
import type { PerFileScore } from '../../../scripts/mutation/baseline.js'

const score = (
  sourceFile: string,
  s: number | { killed?: number; survived?: number; noCoverage?: number; timeout?: number },
): PerFileScore => {
  if (typeof s === 'number') {
    return {
      sourceFile,
      merged: {
        killed: 0,
        survived: 0,
        noCoverage: 0,
        timeout: 0,
        compileError: 0,
        ignored: 0,
        runtimeError: 0,
        pending: 0,
        total: 1,
        scored: 1,
        score: s,
      },
    }
  }
  const killed = s.killed ?? 0
  const survived = s.survived ?? 0
  const noCoverage = s.noCoverage ?? 0
  const timeout = s.timeout ?? 0
  const scored = killed + survived + noCoverage + timeout
  return {
    sourceFile,
    merged: {
      killed,
      survived,
      noCoverage,
      timeout,
      compileError: 0,
      ignored: 0,
      runtimeError: 0,
      pending: 0,
      total: scored,
      scored,
      score: scored === 0 ? 0 : (killed + timeout) / scored,
    },
  }
}

describe('buildBaselineFromPerFile', () => {
  test('maps source files to their mutation score', () => {
    const out = buildBaselineFromPerFile([
      score('src/a.ts', { killed: 4, survived: 1 }),
      score('src/b.ts', { killed: 2, survived: 2 }),
    ])
    expect(out).toEqual({ 'src/a.ts': 0.8, 'src/b.ts': 0.5 })
  })

  test('excludes files with no scoreable mutants', () => {
    const out = buildBaselineFromPerFile([score('src/empty.ts', {}), score('src/a.ts', { killed: 1 })])
    expect(out).toEqual({ 'src/a.ts': 1 })
  })
})

describe('ratchetMerge', () => {
  test('keeps the higher score per file so the baseline only goes up', () => {
    const out = ratchetMerge({ 'src/a.ts': 0.8, 'src/b.ts': 0.4 }, { 'src/a.ts': 0.6, 'src/b.ts': 0.9 })
    expect(out).toEqual({ 'src/a.ts': 0.8, 'src/b.ts': 0.9 })
  })

  test('adds new files and drops files no longer measured', () => {
    const out = ratchetMerge({ 'src/old.ts': 0.5 }, { 'src/new.ts': 0.7 })
    expect(out).toEqual({ 'src/new.ts': 0.7 })
  })
})

describe('seedMerge', () => {
  it('keeps existing keys absent from latest and takes per-key max', () => {
    const existing = { 'src/a.ts': 0.5, 'src/untouched.ts': 0.7 }
    const latest = { 'src/a.ts': 0.6, 'src/new.ts': 0.3 }
    expect(seedMerge(existing, latest)).toEqual({
      'src/a.ts': 0.6,
      'src/untouched.ts': 0.7,
      'src/new.ts': 0.3,
    })
  })

  it('never lowers an existing score', () => {
    expect(seedMerge({ 'src/a.ts': 0.8 }, { 'src/a.ts': 0.2 })).toEqual({ 'src/a.ts': 0.8 })
  })

  it('returns latest unchanged when existing is empty', () => {
    expect(seedMerge({}, { 'src/a.ts': 0.4 })).toEqual({ 'src/a.ts': 0.4 })
  })
})

describe('resolveRatchet', () => {
  it('passes when every baselined file meets its baseline', () => {
    const baseline = { 'src/a.ts': 0.5 }
    const perFile = [score('src/a.ts', 0.6)]
    expect(resolveRatchet(perFile, baseline)).toEqual({ exitCode: 0, regressions: [] })
  })

  it('flags a baselined file that dropped below its baseline', () => {
    const baseline = { 'src/a.ts': 0.5 }
    const perFile = [score('src/a.ts', 0.4)]
    expect(resolveRatchet(perFile, baseline).regressions).toEqual([
      { sourceFile: 'src/a.ts', score: 0.4, threshold: 0.5 },
    ])
  })

  it('does NOT flag a baselined file held to a sub-0.5 baseline (no floor)', () => {
    const baseline = { 'src/legacy.ts': 0.2 }
    const perFile = [score('src/legacy.ts', 0.25)]
    expect(resolveRatchet(perFile, baseline).exitCode).toBe(0)
  })

  it('does NOT flag an unbaselined (first-touch) file regardless of score', () => {
    const perFile = [score('src/new.ts', 0.0), score('src/other-new.ts', 0.49)]
    expect(resolveRatchet(perFile, {})).toEqual({ exitCode: 0, regressions: [] })
  })

  it('skips files with no scoreable mutants', () => {
    const baseline = { 'src/a.ts': 0.5 }
    const perFile = [score('src/a.ts', {})]
    expect(resolveRatchet(perFile, baseline)).toEqual({ exitCode: 0, regressions: [] })
  })

  /**
   * Pins the input type. A score carried over from an earlier run has no `testFiles`,
   * `configPath` or `reportPath` — only `sourceFile` and `merged`. If this signature ever
   * narrows to `PairedRunFileResult`, the incremental gate would have to fabricate those
   * paths to reuse anything, which is exactly the lie this test exists to prevent.
   */
  test('judges a bare PerFileScore, with no run-artifact paths attached', () => {
    const bare: PerFileScore = {
      sourceFile: 'src/carried-over.ts',
      merged: {
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
      },
    }
    expect(resolveRatchet([bare], { 'src/carried-over.ts': 0.9 })).toEqual({
      exitCode: 1,
      regressions: [{ sourceFile: 'src/carried-over.ts', score: 0.5, threshold: 0.9 }],
    })
  })
})

describe('isBaselineMap', () => {
  test('accepts an object of string -> finite number', () => {
    expect(isBaselineMap({ 'src/a.ts': 0.5 })).toBe(true)
  })

  test('rejects non-number values', () => {
    expect(isBaselineMap({ 'src/a.ts': '0.5' })).toBe(false)
  })

  test('rejects arrays and null', () => {
    expect(isBaselineMap([])).toBe(false)
    expect(isBaselineMap(null)).toBe(false)
  })
})
