// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { segmentLog } from './console-log.js'
import type { LogSummary } from './console-log.js'
import { joinFailures } from './join.js'
import { parseJUnit } from './junit.js'
import type { JUnitRun } from './junit.js'
import { LAST_RUN_JSON, PREVIOUS_RUN_JSON } from './paths.js'

/** Bump only for a breaking change; `readReport` refuses anything it does not recognise. */
const SCHEMA_VERSION = 1

/** Enough to answer "which file is costing me the wall time" without reading the index. */
const MAX_SLOWEST_FILES = 20

const detailSchema = z.object({ logOffset: z.number(), logLength: z.number() })

const failureSchema = z.object({
  id: z.number(),
  file: z.string(),
  line: z.number().nullable(),
  suite: z.array(z.string()),
  name: z.string(),
  ms: z.number(),
  detail: detailSchema.nullable(),
})

const scopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('full') }),
  z.object({ kind: z.literal('paths'), paths: z.array(z.string()), selectedBy: z.string().optional() }),
])

export const RunReportSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  startedAt: z.string(),
  wallMs: z.number(),
  argv: z.array(z.string()),
  scope: scopeSchema,
  mode: z.enum(['parallel', 'serial']),
  /** True only when load demotion picked serial; absent reports (older artifacts) read as false. */
  loadDemoted: z.boolean().default(false),
  fingerprint: z.string(),
  gitSha: z.string().nullable(),
  totals: z.object({
    files: z.number(),
    tests: z.number(),
    pass: z.number(),
    fail: z.number(),
    skip: z.number(),
    expects: z.number(),
  }),
  /** Per-file pass/fail, so a gate can ask "did tests/analytics/x.test.ts pass in this run?" */
  files: z.record(z.string(), z.object({ tests: z.number(), failures: z.number() })),
  failures: z.array(failureSchema),
  /** Files that never produced a testcase — a load error, not a test failure. */
  runErrors: z.array(z.object({ file: z.string().nullable(), message: z.string() })),
  slowestFiles: z.array(z.object({ file: z.string(), ms: z.number(), tests: z.number() })),
  joinWarnings: z.array(z.string()),
})

export type RunReport = z.infer<typeof RunReportSchema>
export type RunScope = z.infer<typeof scopeSchema>

export interface BuildReportInput {
  /** `null` when Bun wrote no JUnit file — which is what happens when every file fails to load. */
  junitXml: string | null
  logText: string
  cwd: string
  startedAt: string
  wallMs: number
  argv: readonly string[]
  scope: RunScope
  mode: 'parallel' | 'serial'
  loadDemoted: boolean
  fingerprint: string
  gitSha: string | null
}

export interface ReportReader {
  read: (path: string) => string | null
}

export interface ReportWriter extends ReportReader {
  write: (path: string, contents: string) => void
}

const perFileCounts = (junit: JUnitRun): RunReport['files'] => {
  const files: RunReport['files'] = {}
  for (const [file, cases] of junit.byFile) {
    files[file] = { tests: cases.length, failures: cases.filter((testCase) => testCase.failed).length }
  }
  return files
}

const rankBySlowest = (junit: JUnitRun): RunReport['slowestFiles'] =>
  [...junit.byFile]
    .map(([file, cases]) => ({
      file,
      ms: cases.reduce((total, testCase) => total + testCase.ms, 0),
      tests: cases.length,
    }))
    .sort((left, right) => right.ms - left.ms)
    .slice(0, MAX_SLOWEST_FILES)

/**
 * Run totals, from the console summary.
 *
 * Never from `<testsuites>`: Bun omits files that fail to load and does not raise its
 * failure count, so a JUnit document reads `tests="2" failures="0"` for a run that
 * exited 1. The console summary is the only place the real counts appear.
 */
const totalsFrom = (summary: LogSummary | null, junit: JUnitRun, runErrorCount: number): RunReport['totals'] => {
  if (summary !== null) return { ...summary }
  // No summary line at all — a killed or truncated run. Reconstruct what can be known
  // and let `joinWarnings` say the numbers are inferred.
  const failures = junit.totals.failures + runErrorCount
  return {
    files: junit.byFile.size,
    tests: junit.totals.tests,
    pass: Math.max(0, junit.totals.tests - junit.totals.failures),
    fail: failures,
    skip: junit.totals.skipped,
    expects: junit.totals.assertions,
  }
}

/** Fold one run's two output formats into the single artifact everything else reads. */
export function buildReport(input: BuildReportInput): RunReport {
  const junit = parseJUnit(input.junitXml ?? '', input.cwd)
  const { segments, runErrors, summary } = segmentLog(input.logText, input.cwd)
  const { failures, joinWarnings } = joinFailures(junit, segments)

  const warnings = [...joinWarnings]
  if (summary === null) warnings.push('the run printed no summary line; totals are inferred from junit')
  if (input.junitXml === null) {
    warnings.push('bun wrote no junit report; failure identity and per-file counts come from the log alone')
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    startedAt: input.startedAt,
    wallMs: input.wallMs,
    argv: [...input.argv],
    scope: input.scope,
    mode: input.mode,
    loadDemoted: input.loadDemoted,
    fingerprint: input.fingerprint,
    gitSha: input.gitSha,
    totals: totalsFrom(summary, junit, runErrors.length),
    files: perFileCounts(junit),
    failures,
    runErrors: runErrors.map((error) => ({ ...error })),
    slowestFiles: rankBySlowest(junit),
    joinWarnings: warnings,
  }
}

/**
 * Read a persisted report, or `null` if there is not a usable one.
 *
 * Fails open by design: a missing, truncated, or future-schema report must degrade a
 * *query* to "run the suite first", never throw at the caller. Gates are responsible for
 * turning that `null` into a refusal.
 */
export function readReport(path: string, io: ReportReader): RunReport | null {
  const raw = io.read(path)
  if (raw === null) return null
  try {
    const parsed = RunReportSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/**
 * Persist a report, rotating the prior one to `previous-run.json`.
 *
 * Exactly one generation of history: enough to answer "did my change fix it?" without a
 * third run, and not so much that the directory becomes something to manage.
 */
export function writeReport(report: RunReport, io: ReportWriter): void {
  const previous = io.read(LAST_RUN_JSON)
  if (previous !== null) io.write(PREVIOUS_RUN_JSON, previous)
  io.write(LAST_RUN_JSON, `${JSON.stringify(report, null, 2)}\n`)
}
