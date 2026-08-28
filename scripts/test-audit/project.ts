// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Population projection (design test-consolidation-speed-evidence D2): joins the
 * persisted benchmark (per-class per-case marginal cost) with the fragmentation audit
 * (population counts) over hook-signature detection on the audit's scan set, and
 * reports candidate counts, eligibility bounds, a stated midpoint heuristic, projected
 * seconds against the suite's serial in-test time, and the populations static signals
 * cannot clear (named as requiring per-file eligibility review, never folded in).
 */

import type { BenchmarkReport, ClassResult } from './benchmark.js'
import { AUDIT_SCAN_PATTERN, EXCLUDED_TREES, type FragmentationReport } from './fragmentation.js'

/** Bump when the classification signatures or eligibility heuristic change. */
export const PROJECTION_VERSION = 1

export const PROJECTION_REPORT_PATH = 'reports/test-audit/projection.json'

const SERIAL_IN_TEST_SOURCE = 'reports/test/last-run.junit.xml (sum of <testcase> durations, last persisted run)'

export type PopulationClassId = 'none' | 'cheap-before-each' | 'setup-test-db' | 'mock-heavy'

/** Same injected-fs shape as the audit, so the projection is exercisable in memory. */
export interface ProjectionDeps {
  readonly scan: (pattern: string) => Iterable<string>
  readonly read: (relPath: string) => string | null
  readonly exists: (relPath: string) => boolean
}

const MOCK_MODULE_SITE = /(?:^|[^\w.$])mock\.module\s*\(/u
const MOCK_LOGGER_SITE = /(?:^|[^\w.$])mockLogger\s*\(/u
const SETUP_DB_SITE = /(?:^|[^\w.$])setupTestDb\s*\(/u
const BEFORE_EACH_SITE = /(?:^|[^\w.$])beforeEach\s*\(/u

const STATEFUL_SIGNALS: readonly RegExp[] = [
  /(?:^|[^\w.$])waitFor\s*\(/u,
  /(?:^|[^\w.$])setTimeout\s*\(/u,
  /(?:^|[^\w.$])spyOn\s*\(/u,
  MOCK_MODULE_SITE,
  MOCK_LOGGER_SITE,
  /(?:^|[^\w.$])setMockFetch\s*\(/u,
  /(?:^|[^\w.$])restoreFetch\s*\(/u,
]

/** Heaviest-first classification: a file pays the heaviest hook signature it carries. */
export function classifyFile(source: string): PopulationClassId {
  if (MOCK_MODULE_SITE.test(source) || (MOCK_LOGGER_SITE.test(source) && SETUP_DB_SITE.test(source))) {
    return 'mock-heavy'
  }
  if (SETUP_DB_SITE.test(source)) return 'setup-test-db'
  if (BEFORE_EACH_SITE.test(source)) return 'cheap-before-each'
  return 'none'
}

/** Stated midpoint heuristic (tests-consolidation D4 rule): no timing, spy, or stateful-mock call sites. */
export const staticClean = (source: string): boolean => !STATEFUL_SIGNALS.some((signal) => signal.test(source))

export interface ClassProjection {
  readonly id: PopulationClassId
  readonly files: number
  readonly candidateCases: number
  readonly upperBoundCases: number
  readonly lowerBoundCases: 0
  readonly midpointCases: number
  readonly costPerCaseMs: number
  readonly savingsUpperSec: number
  readonly savingsMidpointSec: number
  readonly savingsLowerSec: 0
}

export interface ReviewRequiredRow {
  readonly id: PopulationClassId
  readonly files: number
  readonly cases: number
  readonly reason: string
}

export interface ProjectionTotals {
  readonly upperSec: number
  readonly midpointSec: number
  readonly lowerSec: 0
  readonly upperShare: number
  readonly midpointShare: number
}

export interface ProjectionReport {
  readonly schemaVersion: 1
  readonly projectionVersion: number
  readonly serialInTestMs: number
  readonly serialInTestSource: string
  readonly assumptions: readonly string[]
  readonly classes: readonly ClassProjection[]
  readonly reviewRequired: readonly ReviewRequiredRow[]
  readonly totals: ProjectionTotals
}

export const ASSUMPTIONS: readonly string[] = [
  'candidates are classified heaviest-first: mock.module (or mockLogger+setupTestDb, the auth.test.ts shape) over setupTestDb over bare beforeEach over none',
  'upper bound = every single-or-zero-assert case in the class files (everything could group)',
  'lower bound = zero: no cases are eligible without per-file review',
  'midpoint heuristic (tests-consolidation D4 static rule): the single-or-zero-assert cases of files with no waitFor/setTimeout/spyOn/mock.module/mockLogger/setMockFetch/restoreFetch call sites',
  'savings multiply each class candidate count by the benchmark median marginal ms/case; populations failing the static rule are reported as requiring per-file eligibility review, never folded into savings',
  'the denominator is serial in-test time only (sum of JUnit testcase durations); no parallel wall-time claim is made',
]

interface PopulationClassAccumulator {
  files: number
  candidateCases: number
  upperCases: number
  midpointCases: number
  reviewFiles: number
  reviewCases: number
}

const newAccumulator = (): PopulationClassAccumulator => ({
  files: 0,
  candidateCases: 0,
  upperCases: 0,
  midpointCases: 0,
  reviewFiles: 0,
  reviewCases: 0,
})

const isExcluded = (file: string): boolean => EXCLUDED_TREES.some((tree) => file.startsWith(tree))

const singleOrZeroCases = (row: { caseCount: number; singleOrZeroAssertShare: number }): number =>
  row.singleOrZeroAssertShare * row.caseCount

const costFor = (benchmark: BenchmarkReport, id: PopulationClassId): number =>
  benchmark.classes.find((row: ClassResult) => row.id === id)?.marginal.median ?? 0

export interface BuildProjectionInput {
  readonly deps: ProjectionDeps
  readonly benchmark: BenchmarkReport
  readonly fragmentation: FragmentationReport
  readonly serialInTestMs: number
}

/** Accumulate one audited file's population into its class bucket. */
const accumulateFile = (
  byClass: Map<PopulationClassId, PopulationClassAccumulator>,
  source: string,
  row: { caseCount: number; singleOrZeroAssertShare: number },
): void => {
  const acc = byClass.get(classifyFile(source))
  if (acc === undefined) return
  acc.files += 1
  acc.candidateCases += row.caseCount
  acc.upperCases += singleOrZeroCases(row)
  if (staticClean(source)) acc.midpointCases += singleOrZeroCases(row)
  else {
    acc.reviewFiles += 1
    acc.reviewCases += singleOrZeroCases(row)
  }
}

const projectClasses = (
  benchmark: BenchmarkReport,
  byClass: Map<PopulationClassId, PopulationClassAccumulator>,
): readonly ClassProjection[] =>
  [...byClass.entries()].map(([id, acc]) => {
    const costPerCaseMs = costFor(benchmark, id)
    return {
      id,
      files: acc.files,
      candidateCases: acc.candidateCases,
      upperBoundCases: acc.upperCases,
      lowerBoundCases: 0,
      midpointCases: acc.midpointCases,
      costPerCaseMs,
      savingsUpperSec: (acc.upperCases * costPerCaseMs) / 1000,
      savingsMidpointSec: (acc.midpointCases * costPerCaseMs) / 1000,
      savingsLowerSec: 0,
    } satisfies ClassProjection
  })

const reviewRows = (byClass: Map<PopulationClassId, PopulationClassAccumulator>): readonly ReviewRequiredRow[] =>
  [...byClass.entries()]
    .filter(([, acc]) => acc.reviewCases > 0)
    .map(([id, acc]) => ({
      id,
      files: acc.reviewFiles,
      cases: acc.reviewCases,
      reason: 'static signals cannot clear these cases; requires per-file eligibility review',
    }))

/** Join benchmark costs with audit population counts into the decision projection. */
export function buildProjection(input: BuildProjectionInput): ProjectionReport {
  const rowsByFile = new Map(input.fragmentation.files.map((row) => [row.file, row]))
  const byClass = new Map<PopulationClassId, PopulationClassAccumulator>([
    ['none', newAccumulator()],
    ['cheap-before-each', newAccumulator()],
    ['setup-test-db', newAccumulator()],
    ['mock-heavy', newAccumulator()],
  ])
  for (const file of [...input.deps.scan(AUDIT_SCAN_PATTERN)].filter((entry) => !isExcluded(entry)).sort()) {
    const row = rowsByFile.get(file)
    const source = row === undefined ? null : input.deps.read(file)
    if (row === undefined || source === null) continue
    accumulateFile(byClass, source, row)
  }
  const classes = projectClasses(input.benchmark, byClass)
  const upperMs = classes.reduce((sum, row) => sum + row.upperBoundCases * row.costPerCaseMs, 0)
  const midMs = classes.reduce((sum, row) => sum + row.midpointCases * row.costPerCaseMs, 0)
  return {
    schemaVersion: 1,
    projectionVersion: PROJECTION_VERSION,
    serialInTestMs: input.serialInTestMs,
    serialInTestSource: SERIAL_IN_TEST_SOURCE,
    assumptions: ASSUMPTIONS,
    classes,
    reviewRequired: reviewRows(byClass),
    totals: {
      upperSec: upperMs / 1000,
      midpointSec: midMs / 1000,
      lowerSec: 0,
      upperShare: input.serialInTestMs === 0 ? 0 : upperMs / input.serialInTestMs,
      midpointShare: input.serialInTestMs === 0 ? 0 : midMs / input.serialInTestMs,
    },
  }
}
