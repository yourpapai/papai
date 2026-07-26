// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  buildBaselineFromPerFile,
  isBaselineMap,
  ratchetMerge,
  resolveRatchet,
} from '../../../scripts/mutation/baseline.js'
import type { PerFileScore } from '../../../scripts/mutation/baseline.js'

const score = (
  sourceFile: string,
  s: { killed?: number; survived?: number; noCoverage?: number; timeout?: number },
): PerFileScore => {
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

describe('resolveRatchet', () => {
  test('passes when every file meets max(floor, baseline)', () => {
    const perFile = [score('src/a.ts', { killed: 9 }), score('src/b.ts', { killed: 3, survived: 3 })]
    const baseline = { 'src/a.ts': 0.8, 'src/b.ts': 0.5 }
    const out = resolveRatchet(perFile, baseline, 0.5)
    expect(out.exitCode).toBe(0)
    expect(out.regressions).toEqual([])
  })

  test('flags a file that dropped below its recorded baseline', () => {
    // src/a.ts scores 0.5 (5 killed of 10); baseline recorded 0.8 -> regression.
    const perFile = [score('src/a.ts', { killed: 5, survived: 5 })]
    const baseline = { 'src/a.ts': 0.8 }
    const out = resolveRatchet(perFile, baseline, 0.5)
    expect(out.exitCode).toBe(1)
    expect(out.regressions).toEqual([{ sourceFile: 'src/a.ts', score: 0.5, threshold: 0.8 }])
  })

  test('flags a new file (no baseline) scoring below the floor', () => {
    // src/new.ts scores 0.2 (2 killed of 10); no baseline -> floor 0.5 applies.
    const perFile = [score('src/new.ts', { killed: 2, survived: 8 })]
    const out = resolveRatchet(perFile, {}, 0.5)
    expect(out.exitCode).toBe(1)
    expect(out.regressions).toEqual([{ sourceFile: 'src/new.ts', score: 0.2, threshold: 0.5 }])
  })

  test('holds an existing below-floor file to its own baseline, not the floor', () => {
    // src/a.ts scores 0.4 (4 killed of 10); baseline 0.3 -> 0.4 >= 0.3, no regression.
    const perFile = [score('src/a.ts', { killed: 4, survived: 6 })]
    const baseline = { 'src/a.ts': 0.3 }
    const out = resolveRatchet(perFile, baseline, 0.5)
    expect(out.exitCode).toBe(0)
  })

  test('flags an existing file that drops below its own baseline even when below the floor', () => {
    // src/a.ts scores 0.2 (2 killed of 10); baseline 0.3 -> regression at threshold 0.3.
    const perFile = [score('src/a.ts', { killed: 2, survived: 8 })]
    const baseline = { 'src/a.ts': 0.3 }
    const out = resolveRatchet(perFile, baseline, 0.5)
    expect(out.exitCode).toBe(1)
    expect(out.regressions[0]?.threshold).toBe(0.3)
  })

  test('skips files with no scoreable mutants', () => {
    const perFile = [score('src/empty.ts', {})]
    const out = resolveRatchet(perFile, {}, 0.5)
    expect(out.exitCode).toBe(0)
    expect(out.regressions).toEqual([])
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
