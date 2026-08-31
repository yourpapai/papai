// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { ReportReadError, readStrykerReport } from '../../scripts/mutation/json-readers.js'
import { mergeReports, survivingMutantIds, type StrykerReport } from '../../scripts/mutation/score-merger.js'

export const safeFileStem = (srcFile: string): string => srcFile.replaceAll(/[^a-zA-Z0-9._-]+/gu, '__')

export const reportPathFor = (reportDir: string, srcFile: string): string =>
  `${reportDir}/${safeFileStem(srcFile)}.stryker-report.json`

export interface MeasureDeps {
  exec: () => Promise<{ exitCode: number; stdout: string; stderr: string }>
  readReport?: (reportPath: string) => StrykerReport
}

// survivingMutantIds rides along with the score so the pipeline's capped-gate
// can set-match the improve agent's declared residual mutant ids against the
// runner-measured survivors without re-running the mutation command. The
// killed/timeout/scored counts ride along too: the record-level baseline bump
// needs the counts behind the measured score, and they come from the same
// report the score is computed from (no extra measurement or re-read).
export interface MeasuredScore {
  readonly score: number
  readonly killed: number
  readonly timeout: number
  readonly scored: number
  readonly survivingMutantIds: readonly string[]
}

function isRetryable(error: unknown): boolean {
  if (error instanceof ReportReadError) return true
  return (
    typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 'ENOENT'
  )
}

export async function measureMutationScore(
  deps: MeasureDeps,
  reportDir: string,
  srcFile: string,
): Promise<MeasuredScore> {
  const read = deps.readReport ?? readStrykerReport
  const reportPath = reportPathFor(reportDir, srcFile)
  const attempt = async (): Promise<MeasuredScore> => {
    const result = await deps.exec()
    if (result.exitCode !== 0) {
      throw new Error(`mutation run failed (exit ${result.exitCode}): ${result.stderr}`)
    }
    const report = read(reportPath)
    const merged = mergeReports([report])
    return {
      score: merged.score,
      killed: merged.killed,
      timeout: merged.timeout,
      scored: merged.scored,
      survivingMutantIds: survivingMutantIds(report),
    }
  }
  try {
    const score = await attempt()
    return score
  } catch (error) {
    if (isRetryable(error)) {
      return attempt()
    }
    throw error
  }
}
