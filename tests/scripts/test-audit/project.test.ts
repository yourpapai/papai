// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { BenchmarkReport, ClassResult, HookClassId } from '../../../scripts/test-audit/benchmark.js'
import type { FragmentationReport } from '../../../scripts/test-audit/fragmentation.js'
import {
  PROJECTION_VERSION,
  buildProjection,
  classifyFile,
  staticClean,
  type ProjectionDeps,
  type ProjectionReport,
} from '../../../scripts/test-audit/project.js'

const makeDeps = (files: Record<string, string>): ProjectionDeps => ({
  scan: (pattern) =>
    Object.keys(files).filter((key) => {
      const prefix = pattern.slice(0, pattern.indexOf('*'))
      return key.startsWith(prefix) && key.endsWith('.test.ts')
    }),
  read: (relPath) => files[relPath] ?? null,
  exists: (relPath) => relPath in files,
})

const classResult = (id: HookClassId, medianMs: number): ClassResult => ({
  id,
  label: id,
  fixtureSource: 'fixture',
  inputsPerArm: 100,
  spreadCases: 100,
  groupedCases: 1,
  spreadMsByRepeat: [],
  groupedMsByRepeat: [],
  marginalMsByRepeat: [],
  marginal: { median: medianMs, q1: medianMs, q3: medianMs, iqr: 0 },
})

const benchmarkOf = (costs: Record<HookClassId, number>): BenchmarkReport => ({
  schemaVersion: 1,
  classManifestVersion: 1,
  repeats: 1,
  inputsPerArm: 100,
  bunVersion: 'test',
  hostLoad: [0, 0, 0],
  cores: 1,
  classes: (['none', 'cheap-before-each', 'setup-test-db', 'mock-heavy'] as const).map((id) =>
    classResult(id, costs[id]),
  ),
})

const fragmentationOf = (rows: readonly [string, number, number][]): FragmentationReport => ({
  heuristicVersion: 2,
  files: rows.map(([file, caseCount, share]) => ({
    file,
    caseCount,
    matcherCallCount: caseCount,
    singleOrZeroAssertShare: share,
  })),
  totals: {
    files: rows.length,
    caseCount: rows.reduce((sum, row) => sum + row[1], 0),
    matcherCallCount: rows.reduce((sum, row) => sum + row[1], 0),
    singleOrZeroAssertShare: 0.5,
  },
})

describe('projection hook-signature classification', () => {
  test('classifies heaviest-first: mock-heavy over setup-test-db over beforeEach', () => {
    expect(classifyFile(`mockLogger()\nawait setupTestDb()\nseedCommonTestPlatformInstances()`)).toBe('mock-heavy')
    expect(classifyFile(`mock.module('../src/logger.js', () => ({}))`)).toBe('mock-heavy')
    expect(classifyFile(`beforeEach(async () => { await setupTestDb() })`)).toBe('setup-test-db')
    expect(classifyFile(`beforeEach(() => { buildFixture() })`)).toBe('cheap-before-each')
    expect(classifyFile(`test('pure', () => { expect(1).toBe(1) })`)).toBe('none')
  })

  test('static-clean vetoes timing, spy, and stateful-mock signals', () => {
    const clean = `beforeEach(async () => { await setupTestDb() })\ntest('a', () => { expect(1).toBe(1) })`
    expect(staticClean(clean)).toBe(true)
    for (const signal of [
      'await waitFor(() => done)',
      'setTimeout(() => done, 10)',
      'spyOn(obj, "method")',
      'mock.module("../src/x.js", () => ({}))',
      'mockLogger()',
      'setMockFetch(() => new Response(""))',
      'restoreFetch()',
    ]) {
      expect(staticClean(`${clean}\n${signal}`)).toBe(false)
    }
  })
})

describe('buildProjection joins benchmark costs with audit population', () => {
  const sources: Record<string, string> = {
    'tests/pure.test.ts': `test('a', () => { expect(1).toBe(1) })`,
    'tests/cheap.test.ts': `beforeEach(() => { buildFixture() })\ntest('a', () => { expect(1).toBe(1) })`,
    'tests/db.test.ts': `beforeEach(async () => { await setupTestDb() })\ntest('a', () => { expect(1).toBe(1) })`,
    'tests/mock.test.ts': `beforeEach(() => { mock.module('../src/x.js', () => ({})) })`,
    'tests/e2e/excluded.test.ts': `beforeEach(async () => { await setupTestDb() })`,
    'tests/zero-case.test.ts': `export const nothing = true`,
  }
  const fragmentation = fragmentationOf([
    ['tests/pure.test.ts', 100, 0.9],
    ['tests/cheap.test.ts', 10, 0.5],
    ['tests/db.test.ts', 20, 0.4],
    ['tests/mock.test.ts', 4, 1.0],
  ])
  const benchmark = benchmarkOf({ none: 0.2, 'cheap-before-each': 0.3, 'setup-test-db': 0.6, 'mock-heavy': 2.0 })
  const serialInTestMs = 100_000

  const project = (): ProjectionReport =>
    buildProjection({ deps: makeDeps(sources), benchmark, fragmentation, serialInTestMs })

  const classRow = (report: ProjectionReport, id: string): ProjectionReport['classes'][number] => {
    const found = report.classes.find((row) => row.id === id)
    if (found === undefined) throw new Error(`no projection row for ${id}`)
    return found
  }

  test('per-class candidate counts come from hook-signature detection over the audit scan set', () => {
    const report = project()
    expect(classRow(report, 'none').candidateCases).toBe(100)
    expect(classRow(report, 'cheap-before-each').candidateCases).toBe(10)
    expect(classRow(report, 'setup-test-db').candidateCases).toBe(20)
    expect(classRow(report, 'mock-heavy').candidateCases).toBe(4)
  })

  test('bounds: upper = single-or-zero-assert cases, lower = 0, midpoint = statically clean share', () => {
    const report = project()
    expect(classRow(report, 'none')).toMatchObject({ upperBoundCases: 90, lowerBoundCases: 0, midpointCases: 90 })
    expect(classRow(report, 'cheap-before-each')).toMatchObject({
      upperBoundCases: 5,
      lowerBoundCases: 0,
      midpointCases: 5,
    })
    expect(classRow(report, 'setup-test-db')).toMatchObject({
      upperBoundCases: 8,
      lowerBoundCases: 0,
      midpointCases: 8,
    })
    expect(classRow(report, 'mock-heavy')).toMatchObject({ upperBoundCases: 4, lowerBoundCases: 0, midpointCases: 0 })
  })

  test('savings seconds = eligible cases x per-class benchmark median', () => {
    const report = project()
    expect(classRow(report, 'mock-heavy').savingsUpperSec).toBeCloseTo((4 * 2.0) / 1000, 9)
    expect(classRow(report, 'mock-heavy').savingsMidpointSec).toBe(0)
    expect(classRow(report, 'setup-test-db').savingsMidpointSec).toBeCloseTo((8 * 0.6) / 1000, 9)
  })

  test('names un-assessable populations as requiring per-file eligibility review', () => {
    const report = project()
    const mockReview = report.reviewRequired.find((row) => row.id === 'mock-heavy')
    expect(mockReview).toMatchObject({ files: 1, cases: 4 })
    expect(mockReview?.reason).toContain('per-file eligibility review')
    expect(report.reviewRequired.find((row) => row.id === 'setup-test-db')).toBeUndefined()
  })

  test('totals project against the serial in-test time with stated shares', () => {
    const report = project()
    const upperMs = 90 * 0.2 + 5 * 0.3 + 8 * 0.6 + 4 * 2.0
    const midMs = 90 * 0.2 + 5 * 0.3 + 8 * 0.6
    expect(report.totals.upperSec).toBeCloseTo(upperMs / 1000, 9)
    expect(report.totals.midpointSec).toBeCloseTo(midMs / 1000, 9)
    expect(report.totals.lowerSec).toBe(0)
    expect(report.totals.upperShare).toBeCloseTo(upperMs / serialInTestMs, 9)
    expect(report.totals.midpointShare).toBeCloseTo(midMs / serialInTestMs, 9)
  })

  test('carries a version, serial-time source, and explicit eligibility assumptions', () => {
    const report = project()
    expect(report.schemaVersion).toBe(1)
    expect(report.projectionVersion).toBe(PROJECTION_VERSION)
    expect(report.serialInTestMs).toBe(serialInTestMs)
    expect(report.serialInTestSource.length).toBeGreaterThan(0)
    expect(report.assumptions.length).toBeGreaterThan(0)
    const joined = report.assumptions.join('\n')
    expect(joined).toContain('heaviest-first')
    expect(joined).toContain('single-or-zero-assert')
  })
})
