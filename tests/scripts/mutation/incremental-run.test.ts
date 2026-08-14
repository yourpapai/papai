// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  combineIncrementalResult,
  createIncrementalDeps,
  formatIncrementalPlan,
  planIncrementalRun,
} from '../../../scripts/mutation/incremental-run.js'
import type { PairedRunFileResult, PairedRunResult } from '../../../scripts/mutation/paired-run.js'
import { openScoreCache } from '../../../scripts/mutation/score-cache.js'
import type { MergedScore } from '../../../scripts/mutation/score-merger.js'

const merged = (score: number, scored = 10): MergedScore => ({
  killed: Math.round(score * scored),
  survived: scored - Math.round(score * scored),
  noCoverage: 0,
  timeout: 0,
  compileError: 0,
  ignored: 0,
  runtimeError: 0,
  pending: 0,
  total: scored,
  scored,
  score,
})

const fileResult = (sourceFile: string, score: number, scored = 10): PairedRunFileResult => ({
  sourceFile,
  testFiles: [`tests/${path.basename(sourceFile, '.ts')}.test.ts`],
  configPath: `reports/paired/${sourceFile}.stryker.config.json`,
  reportPath: `reports/paired/${sourceFile}.stryker-report.json`,
  merged: merged(score, scored),
})

const pairedResult = (
  perFile: readonly PairedRunFileResult[],
  over: Partial<PairedRunResult> = {},
): PairedRunResult => ({
  merged: merged(1),
  perFile,
  skipped: [],
  errored: [],
  ...over,
})

const emptyCachePath = (): string =>
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'incremental-run-')), 'score-cache.json')

describe('planIncrementalRun', () => {
  test('measures everything when the cache is cold', () => {
    const plan = planIncrementalRun({
      targets: ['src/a.ts', 'src/b.ts'],
      cache: openScoreCache(emptyCachePath()),
      fingerprintOf: () => 'fp',
    })
    expect(plan.toMeasure).toEqual(['src/a.ts', 'src/b.ts'])
    expect(plan.reused).toEqual([])
  })

  test('reuses everything when every fingerprint matches', () => {
    const cache = openScoreCache(emptyCachePath())
    cache.set('src/a.ts', 'fp', merged(0.5))
    cache.set('src/b.ts', 'fp', merged(0.6))
    const plan = planIncrementalRun({ targets: ['src/a.ts', 'src/b.ts'], cache, fingerprintOf: () => 'fp' })
    expect(plan.toMeasure).toEqual([])
    expect(plan.reused.map((r) => [r.sourceFile, r.merged.score])).toEqual([
      ['src/a.ts', 0.5],
      ['src/b.ts', 0.6],
    ])
  })

  test('measures only the files whose fingerprint moved', () => {
    const cache = openScoreCache(emptyCachePath())
    cache.set('src/stale.ts', 'fp-old', merged(0.5))
    cache.set('src/fresh.ts', 'fp-current', merged(0.6))
    const plan = planIncrementalRun({
      targets: ['src/fresh.ts', 'src/stale.ts', 'src/unknown.ts'],
      cache,
      fingerprintOf: () => 'fp-current',
    })
    expect(plan.toMeasure).toEqual(['src/stale.ts', 'src/unknown.ts'])
    expect(plan.reused.map((r) => r.sourceFile)).toEqual(['src/fresh.ts'])
  })

  test('carries the measurement time through, so the log can say how old a score is', () => {
    const cache = openScoreCache(emptyCachePath())
    cache.set('src/a.ts', 'fp', merged(0.5))
    const plan = planIncrementalRun({ targets: ['src/a.ts'], cache, fingerprintOf: () => 'fp' })
    expect(plan.reused[0]?.measuredAt).toBeGreaterThan(0)
  })
})

describe('combineIncrementalResult', () => {
  test('unions measured and carried-over files into one verdict input', () => {
    const out = combineIncrementalResult({
      fresh: pairedResult([fileResult('src/fresh.ts', 0.95)]),
      reused: [{ sourceFile: 'src/carried.ts', merged: merged(0.5), measuredAt: 1 }],
    })
    expect(out.perFile.map((f) => f.sourceFile).toSorted()).toEqual(['src/carried.ts', 'src/fresh.ts'])
  })

  /**
   * The two files carry DIFFERENT mutant counts on purpose: averaging their scores gives
   * 0.75, pooling their mutants gives 7/10. A fixture with equal counts would pass either way.
   */
  test('pools mutants across measured and carried-over files', () => {
    const out = combineIncrementalResult({
      fresh: pairedResult([fileResult('src/fresh.ts', 0.5, 2)]),
      reused: [{ sourceFile: 'src/carried.ts', merged: merged(0.75, 8), measuredAt: 1 }],
    })
    expect(out.merged.scored).toBe(10)
    expect(out.merged.score).toBe(0.7)
  })

  test('equals the carried-over score when nothing was measured', () => {
    const carried = merged(0.42, 50)
    const out = combineIncrementalResult({
      fresh: pairedResult([]),
      reused: [{ sourceFile: 'src/carried.ts', merged: carried, measuredAt: 1 }],
    })
    expect(out.merged).toEqual(carried)
  })

  test('passes errored and skipped files through from the fresh run only', () => {
    const out = combineIncrementalResult({
      fresh: pairedResult([], {
        errored: [{ sourceFile: 'src/boom.ts', error: 'dry run failed' }],
        skipped: [{ sourceFile: 'src/notests.ts', reason: 'no companion' }],
      }),
      reused: [{ sourceFile: 'src/carried.ts', merged: merged(0.5), measuredAt: 1 }],
    })
    expect(out.errored).toEqual([{ sourceFile: 'src/boom.ts', error: 'dry run failed' }])
    expect(out.skipped).toEqual([{ sourceFile: 'src/notests.ts', reason: 'no companion' }])
  })

  // A file with no mutants is inert in the ratchet and the seed; carrying it over must not
  // change that, nor move an aggregate it contributes nothing to.
  test('keeps an unscoreable carried-over file without moving the aggregate', () => {
    const out = combineIncrementalResult({
      fresh: pairedResult([fileResult('src/fresh.ts', 0.8, 10)]),
      reused: [{ sourceFile: 'src/empty.ts', merged: merged(0, 0), measuredAt: 1 }],
    })
    expect(out.perFile.map((f) => f.sourceFile)).toContain('src/empty.ts')
    expect(out.merged.score).toBe(0.8)
    expect(out.merged.scored).toBe(10)
  })
})

describe('formatIncrementalPlan', () => {
  test('reports the whole-branch size alongside the measured/reused split', () => {
    const lines = formatIncrementalPlan({
      toMeasure: ['src/a.ts'],
      reused: [{ sourceFile: 'src/b.ts', merged: merged(0.68), measuredAt: Date.parse('2026-08-13T20:51:00Z') }],
    }).join('\n')
    expect(lines).toContain('2 file(s)')
    expect(lines).toContain('measured now: 1')
    expect(lines).toContain('reused: 1')
  })

  // A green run must be legible as whole-branch, not mistaken for a partial one, so every
  // reused file names its score and when it was measured.
  test('lists each reused file with its score and measurement time', () => {
    const lines = formatIncrementalPlan({
      toMeasure: [],
      reused: [{ sourceFile: 'src/b.ts', merged: merged(0.6812), measuredAt: Date.parse('2026-08-13T20:51:00Z') }],
    }).join('\n')
    expect(lines).toContain('src/b.ts')
    expect(lines).toContain('0.6812')
    expect(lines).toContain('2026-08-13T20:51')
  })

  test('says so plainly when nothing can be reused', () => {
    const lines = formatIncrementalPlan({ toMeasure: ['src/a.ts'], reused: [] }).join('\n')
    expect(lines).toContain('reused: 0')
  })
})

describe('createIncrementalDeps', () => {
  test('records only measured files, and never an errored one', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'incremental-deps-'))
    fs.mkdirSync(path.join(root, 'src'), { recursive: true })
    fs.mkdirSync(path.join(root, 'reports/paired'), { recursive: true })
    fs.writeFileSync(path.join(root, 'src/a.ts'), 'export const a = 1\n')

    const deps = createIncrementalDeps({ projectRoot: root, reportDir: path.join(root, 'reports/paired') })
    expect(deps.plan(['src/a.ts']).toMeasure).toEqual(['src/a.ts'])
    deps.record([fileResult('src/a.ts', 0.75)])

    const reopened = createIncrementalDeps({ projectRoot: root, reportDir: path.join(root, 'reports/paired') })
    const plan = reopened.plan(['src/a.ts'])
    expect(plan.toMeasure).toEqual([])
    expect(plan.reused[0]?.merged.score).toBe(0.75)
  })

  test('re-measures once the source changes', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'incremental-deps-'))
    fs.mkdirSync(path.join(root, 'src'), { recursive: true })
    fs.writeFileSync(path.join(root, 'src/a.ts'), 'export const a = 1\n')
    const reportDir = path.join(root, 'reports/paired')

    createIncrementalDeps({ projectRoot: root, reportDir }).record([fileResult('src/a.ts', 0.75)])
    fs.writeFileSync(path.join(root, 'src/a.ts'), 'export const a = 2\n')
    expect(createIncrementalDeps({ projectRoot: root, reportDir }).plan(['src/a.ts']).toMeasure).toEqual(['src/a.ts'])
  })

  test('writes the store even when nothing was recorded', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'incremental-deps-'))
    const reportDir = path.join(root, 'reports/paired')
    createIncrementalDeps({ projectRoot: root, reportDir }).record([])
    expect(fs.existsSync(path.join(reportDir, 'score-cache.json'))).toBe(true)
  })
})
