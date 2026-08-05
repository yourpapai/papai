// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readStrykerReport } from '../../scripts/mutation/json-readers.js'
import { mergeReports, type StrykerReport } from '../../scripts/mutation/score-merger.js'

export const safeFileStem = (srcFile: string): string => srcFile.replaceAll(/[^a-zA-Z0-9._-]+/gu, '__')

export const reportPathFor = (reportDir: string, srcFile: string): string =>
  `${reportDir}/${safeFileStem(srcFile)}.stryker-report.json`

export interface MeasureDeps {
  exec: () => Promise<{ exitCode: number; stdout: string; stderr: string }>
  readReport?: (reportPath: string) => StrykerReport
}

export async function measureMutationScore(deps: MeasureDeps, reportDir: string, srcFile: string): Promise<number> {
  const read = deps.readReport ?? readStrykerReport
  const reportPath = reportPathFor(reportDir, srcFile)
  const attempt = async (): Promise<number> => {
    await deps.exec()
    return mergeReports([read(reportPath)]).score
  }
  try {
    const score = await attempt()
    return score
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/enoent|malformed|must contain a stryker/iu.test(message)) {
      const retried = await attempt()
      return retried
    }
    throw error
  }
}
