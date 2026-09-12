// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Projection CLI (design test-consolidation-speed-evidence D2): reads the persisted
 * benchmark + fragmentation artifacts, parses them with Zod (artifact boundary), joins
 * them via buildProjection against the last persisted run's serial in-test time, and
 * prints + writes the projection report.
 */

import fs from 'node:fs'
import path from 'node:path'

import { Glob } from 'bun'
import { z } from 'zod'

import { parseArmJUnit } from './benchmark.js'
import { PROJECTION_REPORT_PATH, buildProjection, type ProjectionDeps, type ProjectionReport } from './project.js'

const LAST_RUN_JUNIT_PATH = 'reports/test/last-run.junit.xml'

const dispersionSchema = z.object({
  median: z.number(),
  q1: z.number(),
  q3: z.number(),
  iqr: z.number(),
})

const benchmarkSchema = z.object({
  schemaVersion: z.literal(1),
  classManifestVersion: z.number(),
  repeats: z.number(),
  inputsPerArm: z.number(),
  bunVersion: z.string(),
  hostLoad: z.array(z.number()),
  cores: z.number(),
  classes: z.array(
    z.object({
      id: z.enum(['none', 'cheap-before-each', 'setup-test-db', 'mock-heavy']),
      label: z.string(),
      fixtureSource: z.string(),
      inputsPerArm: z.number(),
      spreadCases: z.number(),
      groupedCases: z.number(),
      spreadMsByRepeat: z.array(z.number()),
      groupedMsByRepeat: z.array(z.number()),
      marginalMsByRepeat: z.array(z.number()),
      marginal: dispersionSchema,
    }),
  ),
})

const fragmentationSchema = z.object({
  heuristicVersion: z.number(),
  files: z.array(
    z.object({
      file: z.string(),
      caseCount: z.number(),
      matcherCallCount: z.number(),
      singleOrZeroAssertShare: z.number(),
    }),
  ),
  totals: z.object({
    files: z.number(),
    caseCount: z.number(),
    matcherCallCount: z.number(),
    singleOrZeroAssertShare: z.number(),
  }),
})

const readTextOr = (relPath: string, instead: string): string => {
  try {
    return fs.readFileSync(relPath, 'utf8')
  } catch {
    throw new Error(`${instead} (missing or unreadable: ${relPath})`)
  }
}

const parseJsonOr = <T>(relPath: string, schema: z.ZodType<T>, instead: string): T => {
  const parsed = schema.safeParse(JSON.parse(readTextOr(relPath, instead)))
  if (!parsed.success) {
    throw new Error(`${instead} (${relPath} does not match the expected shape: ${parsed.error.message})`)
  }
  return parsed.data
}

const realDeps: ProjectionDeps = {
  scan: (pattern) => new Glob(pattern).scanSync({ cwd: process.cwd(), onlyFiles: true }),
  read: (relPath) => {
    try {
      return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8')
    } catch {
      return null
    }
  },
  exists: (relPath) => fs.existsSync(path.join(process.cwd(), relPath)),
}

const pct = (share: number): string => `${(share * 100).toFixed(2)}%`

const printProjection = (report: ProjectionReport): void => {
  console.log(
    `consolidation projection (v${report.projectionVersion}): serial in-test total ` +
      `${(report.serialInTestMs / 1000).toFixed(1)} s (${report.serialInTestSource})`,
  )
  for (const row of report.classes) {
    console.log(
      `  ${row.id.padEnd(18)} ${row.candidateCases} cases in ${row.files} files  cost ${row.costPerCaseMs.toFixed(3)} ms/case  ` +
        `midpoint ${row.midpointCases} -> ${row.savingsMidpointSec.toFixed(3)} s  (upper ${row.upperBoundCases} -> ${row.savingsUpperSec.toFixed(3)} s)`,
    )
  }
  console.log(
    `  total: midpoint ${report.totals.midpointSec.toFixed(3)} s = ${pct(report.totals.midpointShare)} of serial in-test time ` +
      `(upper ${report.totals.upperSec.toFixed(3)} s = ${pct(report.totals.upperShare)}; lower 0)`,
  )
  for (const row of report.reviewRequired) {
    console.log(`  review required: ${row.id} ${row.cases.toFixed(0)} cases in ${row.files} files — ${row.reason}`)
  }
  console.log(`-> ${PROJECTION_REPORT_PATH}`)
}

/** CLI entry: joins the persisted benchmark + audit artifacts into the projection. */
export function projectCli(): void {
  const benchmark = parseJsonOr(
    'reports/test-audit/benchmark.json',
    benchmarkSchema,
    'run bun run test:benchmark first',
  )
  const fragmentation = parseJsonOr(
    'reports/test-audit/fragmentation.json',
    fragmentationSchema,
    'run bun run test:audit first',
  )
  const serialInTestMs = parseArmJUnit(
    readTextOr(LAST_RUN_JUNIT_PATH, 'run bun run test first (junit report required)'),
  ).inTestMs
  const report = buildProjection({ deps: realDeps, benchmark, fragmentation, serialInTestMs })
  fs.mkdirSync(path.dirname(PROJECTION_REPORT_PATH), { recursive: true })
  fs.writeFileSync(PROJECTION_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
  printProjection(report)
}

if (import.meta.main) {
  projectCli()
}
