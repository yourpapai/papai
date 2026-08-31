// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  buildBaselineFromPerFile,
  isBaselineMap,
  isBaselineRecord,
  loadBaseline,
  measurementNumerator,
  recordNumerator,
  ratchetMerge,
  resolveRatchet,
  seedMerge,
  writeBaseline,
} from '../../../scripts/mutation/baseline.js'
import type { BaselineMap, BaselineRecord, PerFileScore } from '../../../scripts/mutation/baseline.js'
import type { MergedScore } from '../../../scripts/mutation/score-merger.js'

const mergedScore = (counts: {
  readonly killed?: number
  readonly survived?: number
  readonly noCoverage?: number
  readonly timeout?: number
}): MergedScore => {
  const killed = counts.killed ?? 0
  const survived = counts.survived ?? 0
  const noCoverage = counts.noCoverage ?? 0
  const timeout = counts.timeout ?? 0
  const scored = killed + survived + noCoverage + timeout
  return {
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
  }
}

const score = (
  sourceFile: string,
  s: number | { killed?: number; survived?: number; noCoverage?: number; timeout?: number },
): PerFileScore => ({
  sourceFile,
  merged:
    typeof s === 'number'
      ? mergedScore({ killed: Math.round(s * 10), survived: 10 - Math.round(s * 10) })
      : mergedScore(s),
})

/** A rich record whose arithmetic is consistent: score === (killed + timeout) / scored. */
const record = (killed: number, timeout: number, scored: number): BaselineRecord => ({
  score: (killed + timeout) / scored,
  killed,
  timeout,
  scored,
})

const tmpBaselinePath = (): string =>
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'papai-baseline-')), 'baseline.json')

describe('isBaselineRecord', () => {
  test('accepts a complete rich record', () => {
    expect(isBaselineRecord({ score: 0.85, killed: 16, timeout: 1, scored: 20 })).toBe(true)
  })

  test('rejects a bare number', () => {
    expect(isBaselineRecord(0.5)).toBe(false)
  })

  test('rejects an object missing a count field', () => {
    expect(isBaselineRecord({ score: 0.85, killed: 16, timeout: 1 })).toBe(false)
    expect(isBaselineRecord({ score: 0.85, killed: 16, scored: 20 })).toBe(false)
  })

  test('rejects non-numeric fields and non-object values', () => {
    expect(isBaselineRecord({ score: '0.85', killed: 16, timeout: 1, scored: 20 })).toBe(false)
    expect(isBaselineRecord('0.5')).toBe(false)
    expect(isBaselineRecord(null)).toBe(false)
    expect(isBaselineRecord([0.5])).toBe(false)
  })
})

describe('recordNumerator / measurementNumerator', () => {
  test('recordNumerator sums killed + timeout', () => {
    expect(recordNumerator({ score: 0.85, killed: 16, timeout: 1, scored: 20 })).toBe(17)
  })

  test('measurementNumerator sums merged.killed + merged.timeout', () => {
    expect(measurementNumerator(mergedScore({ killed: 4, timeout: 1, survived: 5 }))).toBe(5)
  })

  // The verdict compares numerators, so a killed→timeout reclassification (slower tests,
  // same killing power) must not change the number the ratchet compares.
  test('a killed→timeout reclassification keeps the measurement numerator', () => {
    const before = measurementNumerator(mergedScore({ killed: 8, timeout: 0, survived: 2 }))
    const after = measurementNumerator(mergedScore({ killed: 7, timeout: 1, survived: 2 }))
    expect(after).toBe(before)
  })
})

describe('buildBaselineFromPerFile', () => {
  test('emits rich records carrying the MergedScore counts', () => {
    const out = buildBaselineFromPerFile([
      score('src/a.ts', { killed: 4, survived: 1 }),
      score('src/b.ts', { killed: 2, timeout: 1, survived: 1 }),
    ])
    expect(out).toEqual({
      'src/a.ts': { score: 0.8, killed: 4, timeout: 0, scored: 5 },
      'src/b.ts': { score: 0.75, killed: 2, timeout: 1, scored: 4 },
    })
  })

  test('excludes files with no scoreable mutants', () => {
    const out = buildBaselineFromPerFile([score('src/empty.ts', {}), score('src/a.ts', { killed: 1 })])
    expect(out).toEqual({ 'src/a.ts': { score: 1, killed: 1, timeout: 0, scored: 1 } })
  })

  test('excludes locale data files', () => {
    const out = buildBaselineFromPerFile([
      score('src/i18n/locales/en.json.ts', { killed: 1 }),
      score('src/a.ts', { killed: 1 }),
    ])
    expect(Object.keys(out)).toEqual(['src/a.ts'])
  })
})

describe('loadBaseline arithmetic validation', () => {
  test('returns null when the file is absent', () => {
    expect(
      loadBaseline(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'papai-baseline-')), 'missing.json')),
    ).toBeNull()
  })

  test('accepts a well-formed rich record beside a bare legacy number', () => {
    const filePath = tmpBaselinePath()
    fs.writeFileSync(
      filePath,
      JSON.stringify({ 'src/legacy.ts': 0.5, 'src/rich.ts': { score: 0.85, killed: 16, timeout: 1, scored: 20 } }),
    )
    expect(loadBaseline(filePath)).toEqual({
      'src/legacy.ts': 0.5,
      'src/rich.ts': { score: 0.85, killed: 16, timeout: 1, scored: 20 },
    })
  })

  test('rejects counts that are not finite non-negative integers, naming the file', () => {
    const filePath = tmpBaselinePath()
    fs.writeFileSync(filePath, JSON.stringify({ 'src/a.ts': { score: 0.8, killed: 1.5, timeout: 0, scored: 2 } }))
    expect(() => loadBaseline(filePath)).toThrow(/src\/a\.ts.*killed.*finite non-negative integer/u)
  })

  test('rejects negative counts', () => {
    const filePath = tmpBaselinePath()
    fs.writeFileSync(filePath, JSON.stringify({ 'src/a.ts': { score: 0.8, killed: -1, timeout: 0, scored: 2 } }))
    expect(() => loadBaseline(filePath)).toThrow(/src\/a\.ts.*killed.*finite non-negative integer/u)
  })

  test('rejects scored === 0 (a record must come from a measured population)', () => {
    const filePath = tmpBaselinePath()
    fs.writeFileSync(filePath, JSON.stringify({ 'src/a.ts': { score: 0, killed: 0, timeout: 0, scored: 0 } }))
    expect(() => loadBaseline(filePath)).toThrow(/src\/a\.ts.*scored.*> 0/u)
  })

  test('rejects a score outside [0, 1]', () => {
    const filePath = tmpBaselinePath()
    fs.writeFileSync(filePath, JSON.stringify({ 'src/a.ts': { score: 1.5, killed: 1, timeout: 0, scored: 1 } }))
    expect(() => loadBaseline(filePath)).toThrow(/src\/a\.ts.*score.*\[0, 1\]/u)
  })

  test('rejects killed + timeout > scored, naming the expected relation', () => {
    const filePath = tmpBaselinePath()
    fs.writeFileSync(filePath, JSON.stringify({ 'src/a.ts': { score: 1, killed: 3, timeout: 0, scored: 2 } }))
    expect(() => loadBaseline(filePath)).toThrow(/src\/a\.ts.*killed \+ timeout.*<= scored/u)
  })

  test('rejects a score inconsistent with (killed + timeout) / scored beyond 1e-9', () => {
    const filePath = tmpBaselinePath()
    fs.writeFileSync(filePath, JSON.stringify({ 'src/a.ts': { score: 0.9, killed: 16, timeout: 1, scored: 20 } }))
    expect(() => loadBaseline(filePath)).toThrow(/src\/a\.ts.*score.*\(killed \+ timeout\) \/ scored/u)
  })

  test('accepts a score within 1e-9 of (killed + timeout) / scored', () => {
    const filePath = tmpBaselinePath()
    // 17/20 = 0.85 exactly; a hand edit landing within the epsilon stays valid
    fs.writeFileSync(
      filePath,
      JSON.stringify({ 'src/a.ts': { score: 0.85 + 5e-10, killed: 16, timeout: 1, scored: 20 } }),
    )
    expect(loadBaseline(filePath)).toEqual({ 'src/a.ts': { score: 0.85 + 5e-10, killed: 16, timeout: 1, scored: 20 } })
  })

  test('rejects a value that is neither a finite number nor a record', () => {
    const filePath = tmpBaselinePath()
    fs.writeFileSync(filePath, JSON.stringify({ 'src/a.ts': '0.5' }))
    expect(() => loadBaseline(filePath)).toThrow(/src\/a\.ts/u)
  })
})

describe('dual-shape parse/serialize', () => {
  test('round-trips a bare legacy number and a rich record side by side in one sorted bare map', () => {
    const filePath = tmpBaselinePath()
    const dual: BaselineMap = {
      'src/z.ts': { score: 0.85, killed: 16, timeout: 1, scored: 20 },
      'src/legacy.ts': 0.5,
    }
    writeBaseline(filePath, dual)
    // top-level file stays a bare sorted map; legacy entries are NOT migrated on write,
    // and the rich record serializes verbatim (sorted keys, two-space indent)
    expect(fs.readFileSync(filePath, 'utf8')).toBe(
      [
        '{',
        '  "src/legacy.ts": 0.5,',
        '  "src/z.ts": {',
        '    "score": 0.85,',
        '    "killed": 16,',
        '    "timeout": 1,',
        '    "scored": 20',
        '  }',
        '}',
        '',
      ].join('\n'),
    )
    expect(loadBaseline(filePath)).toEqual({
      'src/legacy.ts': 0.5,
      'src/z.ts': { score: 0.85, killed: 16, timeout: 1, scored: 20 },
    })
  })
})

describe('isBaselineMap', () => {
  test('accepts an object of string -> finite number or rich record', () => {
    expect(isBaselineMap({ 'src/a.ts': 0.5, 'src/b.ts': record(4, 0, 5) })).toBe(true)
  })

  test('rejects non-number non-record values', () => {
    expect(isBaselineMap({ 'src/a.ts': '0.5' })).toBe(false)
    expect(isBaselineMap({ 'src/a.ts': { score: 0.5, killed: 1 } })).toBe(false)
  })

  test('rejects arrays and null', () => {
    expect(isBaselineMap([])).toBe(false)
    expect(isBaselineMap(null)).toBe(false)
  })
})

describe('ratchetMerge (per-key max with counts)', () => {
  test('a strictly-higher score replaces the record wholesale with the new counts', () => {
    const prev = record(4, 0, 5)
    const next = record(9, 0, 10)
    expect(ratchetMerge({ 'src/a.ts': prev }, { 'src/a.ts': next })).toEqual({ 'src/a.ts': next })
  })

  test('equal-or-lower over a rich record leaves score and counts untouched — same record object', () => {
    const prev = record(8, 0, 10)
    const equal = record(4, 4, 10)
    const lower = record(3, 0, 10)
    const mergedEqual = ratchetMerge({ 'src/a.ts': prev }, { 'src/a.ts': equal })
    expect(mergedEqual['src/a.ts']).toBe(prev)
    const mergedLower = ratchetMerge({ 'src/a.ts': prev }, { 'src/a.ts': lower })
    expect(mergedLower['src/a.ts']).toBe(prev)
  })

  test('a legacy bare entry measured strictly higher becomes the measurement\u2019s rich record', () => {
    const next = record(9, 0, 10)
    expect(ratchetMerge({ 'src/legacy.ts': 0.5 }, { 'src/legacy.ts': next })).toEqual({ 'src/legacy.ts': next })
  })

  test('a below-floor measurement leaves a legacy bare entry untouched', () => {
    expect(ratchetMerge({ 'src/legacy.ts': 0.8 }, { 'src/legacy.ts': record(1, 0, 4) })).toEqual({
      'src/legacy.ts': 0.8,
    })
  })

  test('adds new files and drops files no longer measured', () => {
    const out = ratchetMerge({ 'src/old.ts': 0.5 }, { 'src/new.ts': record(7, 0, 10) })
    expect(out).toEqual({ 'src/new.ts': record(7, 0, 10) })
  })
})

describe('seedMerge (per-key max with counts, existing keys preserved)', () => {
  it('keeps existing keys absent from latest and takes per-key max', () => {
    const existing: BaselineMap = { 'src/untouched.ts': record(7, 0, 10), 'src/a.ts': record(2, 0, 4) }
    const latest: BaselineMap = { 'src/a.ts': record(3, 0, 5), 'src/new.ts': record(1, 0, 4) }
    expect(seedMerge(existing, latest)).toEqual({
      'src/untouched.ts': record(7, 0, 10),
      'src/a.ts': record(3, 0, 5),
      'src/new.ts': record(1, 0, 4),
    })
  })

  test('strictly-higher replaces the record wholesale; equal-or-lower keeps the same record object', () => {
    const prev = record(8, 0, 10)
    const merged = seedMerge({ 'src/a.ts': prev }, { 'src/a.ts': record(4, 4, 10) })
    expect(merged['src/a.ts']).toBe(prev)
    const raised = seedMerge({ 'src/a.ts': prev }, { 'src/a.ts': record(9, 0, 10) })
    expect(raised['src/a.ts']).toEqual(record(9, 0, 10))
  })

  // D2's lazy-migration carve-out: mutation scoring is deterministic and a marginal merge
  // ties, so an exactly-equal measurement upgrades the shape without changing the floor.
  test('a legacy bare entry measured at exactly its recorded score converts to a rich record at the unchanged floor', () => {
    const merged = seedMerge({ 'src/legacy.ts': 0.8 }, { 'src/legacy.ts': record(7, 1, 10) })
    expect(merged).toEqual({ 'src/legacy.ts': { score: 0.8, killed: 7, timeout: 1, scored: 10 } })
  })

  test('a below-floor measurement leaves a legacy bare entry untouched', () => {
    expect(seedMerge({ 'src/legacy.ts': 0.8 }, { 'src/legacy.ts': record(1, 0, 4) })).toEqual({
      'src/legacy.ts': 0.8,
    })
  })

  it('never lowers an existing score', () => {
    expect(seedMerge({ 'src/a.ts': 0.8 }, { 'src/a.ts': record(1, 0, 4) })).toEqual({ 'src/a.ts': 0.8 })
  })

  it('returns latest unchanged when existing is empty', () => {
    expect(seedMerge({}, { 'src/a.ts': record(2, 0, 5) })).toEqual({ 'src/a.ts': record(2, 0, 5) })
  })
})

describe('resolveRatchet verdict classification', () => {
  it('passes when every baselined file meets its recorded score — silently', () => {
    const baseline: BaselineMap = { 'src/a.ts': record(5, 0, 10) }
    const perFile = [score('src/a.ts', { killed: 6, survived: 4 })]
    expect(resolveRatchet(perFile, baseline)).toEqual({ exitCode: 0, regressions: [], dilutions: [] })
  })

  it('fails when the score drops below the recorded score AND kills fewer mutants', () => {
    const baseline: BaselineMap = { 'src/a.ts': record(8, 1, 10) }
    const perFile = [score('src/a.ts', { killed: 4, survived: 6 })]
    expect(resolveRatchet(perFile, baseline)).toEqual({
      exitCode: 1,
      regressions: [
        {
          sourceFile: 'src/a.ts',
          score: 0.4,
          threshold: 0.9,
          measuredNumerator: 4,
          recordedNumerator: 9,
        },
      ],
      dilutions: [],
    })
  })

  it('warns (dilution, exit 0) when kills held while the population grew', () => {
    const baseline: BaselineMap = { 'src/a.ts': record(8, 1, 10) }
    // numerator 9 held (9 killed of a grown 20-mutant population) but score dropped to 0.45
    const perFile = [score('src/a.ts', { killed: 9, survived: 11 })]
    expect(resolveRatchet(perFile, baseline)).toEqual({
      exitCode: 0,
      regressions: [],
      dilutions: [
        {
          sourceFile: 'src/a.ts',
          score: 0.45,
          threshold: 0.9,
          measuredNumerator: 9,
          recordedNumerator: 9,
        },
      ],
    })
  })

  it('raises no dilution warning when the score holds on a shrunken population', () => {
    const baseline: BaselineMap = { 'src/a.ts': record(8, 1, 10) }
    // score 1.0 >= 0.9 (population shrank to 8 mutants, all killed) even though kills 8 < 9
    const perFile = [score('src/a.ts', { killed: 8 })]
    expect(resolveRatchet(perFile, baseline)).toEqual({ exitCode: 0, regressions: [], dilutions: [] })
  })

  it('judges a legacy score-only record by score alone with no dilution classification', () => {
    const baseline: BaselineMap = { 'src/legacy.ts': 0.5 }
    // score 0.4 < floor 0.5 even though kills (100) far exceed anything recorded — the
    // score-only record cannot classify dilution, so this stays a strict regression
    const perFile = [score('src/legacy.ts', { killed: 100, survived: 150 })]
    expect(resolveRatchet(perFile, baseline)).toEqual({
      exitCode: 1,
      regressions: [
        {
          sourceFile: 'src/legacy.ts',
          score: 0.4,
          threshold: 0.5,
          measuredNumerator: 100,
          recordedNumerator: null,
        },
      ],
      dilutions: [],
    })
  })

  it('passes a legacy score-only record whose score meets the floor', () => {
    const baseline: BaselineMap = { 'src/legacy.ts': 0.2 }
    const perFile = [score('src/legacy.ts', 0.25)]
    expect(resolveRatchet(perFile, baseline)).toEqual({ exitCode: 0, regressions: [], dilutions: [] })
  })

  it('does NOT flag an unbaselined (first-touch) file regardless of score', () => {
    const perFile = [score('src/new.ts', 0.0), score('src/other-new.ts', 0.49)]
    expect(resolveRatchet(perFile, {})).toEqual({ exitCode: 0, regressions: [], dilutions: [] })
  })

  it('skips files with no scoreable mutants', () => {
    const baseline: BaselineMap = { 'src/a.ts': record(5, 0, 10) }
    const perFile = [score('src/a.ts', {})]
    expect(resolveRatchet(perFile, baseline)).toEqual({ exitCode: 0, regressions: [], dilutions: [] })
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
    expect(resolveRatchet([bare], { 'src/carried-over.ts': record(9, 0, 10) })).toEqual({
      exitCode: 1,
      regressions: [
        {
          sourceFile: 'src/carried-over.ts',
          score: 0.5,
          threshold: 0.9,
          measuredNumerator: 1,
          recordedNumerator: 9,
        },
      ],
      dilutions: [],
    })
  })
})
