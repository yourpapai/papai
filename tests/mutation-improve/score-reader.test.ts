// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'
import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

import { measureMutationScore, reportPathFor, safeFileStem } from '../../mutation-improve/src/score-reader.js'
import { ReportReadError, readStrykerReport } from '../../scripts/mutation/json-readers.js'
import type { StrykerReport } from '../../scripts/mutation/score-merger.js'

const reportWith = (killed: number, survived: number, noCoverage = 0, timeout = 0): StrykerReport => ({
  files: {
    'src/foo.ts': {
      mutants: [
        ...Array.from({ length: killed }, () => ({ status: 'Killed' })),
        ...Array.from({ length: survived }, () => ({ status: 'Survived' })),
        ...Array.from({ length: noCoverage }, () => ({ status: 'NoCoverage' })),
        ...Array.from({ length: timeout }, () => ({ status: 'Timeout' })),
      ],
    },
  },
})

type ExecResult = { exitCode: number; stdout: string; stderr: string }

const successfulExec = (): Promise<ExecResult> => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })

describe('score-reader', () => {
  test('safeFileStem escapes path separators', () => {
    expect(safeFileStem('src/live-status/x.ts')).toBe('src__live-status__x.ts')
    expect(reportPathFor('reports/paired', 'src/live-status/x.ts')).toBe(
      'reports/paired/src__live-status__x.ts.stryker-report.json',
    )
  })

  test('measureMutationScore reads the report after exec and returns (killed+timeout)/scored', async () => {
    // 8 killed / (8+2) scored = 0.8
    const exec = mock(successfulExec)
    const score = await measureMutationScore(
      { exec, readReport: () => reportWith(8, 2) },
      'reports/paired',
      'src/foo.ts',
    )
    expect(exec).toHaveBeenCalledTimes(1)
    expect(score).toBeCloseTo(0.8, 5)
  })

  test('measureMutationScore retries exec once when the report read throws, then succeeds', async () => {
    const exec = mock(successfulExec)
    const readReport = mock((): StrykerReport => reportWith(10, 0)).mockImplementationOnce((): StrykerReport => {
      throw new Error('malformed')
    })
    const score = await measureMutationScore({ exec, readReport }, 'reports/paired', 'src/foo.ts')
    expect(exec).toHaveBeenCalledTimes(2)
    expect(score).toBe(1)
  })

  test('measureMutationScore throws when exec exits non-zero, even if a stale report exists', async () => {
    const exec = mock(
      (): Promise<ExecResult> => Promise.resolve({ exitCode: 1, stdout: '', stderr: 'stryker crashed' }),
    )
    await expect(
      measureMutationScore({ exec, readReport: () => reportWith(10, 0) }, 'reports/paired', 'src/foo.ts'),
    ).rejects.toThrow(/mutation run failed/iu)
    expect(exec).toHaveBeenCalledTimes(1)
  })

  test('measureMutationScore throws after a failed retry', async () => {
    const exec = mock(successfulExec)
    await expect(
      measureMutationScore(
        {
          exec,
          readReport: (): StrykerReport => {
            throw new Error('still malformed')
          },
        },
        'reports/paired',
        'src/foo.ts',
      ),
    ).rejects.toThrow(/malformed|stryker/iu)
  })
})

describe('readStrykerReport (json-readers contract)', () => {
  test('throws ReportReadError when the parsed JSON is not a Stryker report', () => {
    const tmpFile = `${tmpdir()}/mi-not-a-report-${Date.now()}.json`
    // `files` must be a record; an array is not a valid Stryker report shape
    writeFileSync(tmpFile, JSON.stringify({ files: [] }))
    try {
      expect(() => readStrykerReport(tmpFile)).toThrow(ReportReadError)
    } finally {
      rmSync(tmpFile, { force: true })
    }
  })

  test('returns the report when the shape is valid', () => {
    const tmpFile = `${tmpdir()}/mi-valid-${Date.now()}.json`
    writeFileSync(tmpFile, JSON.stringify({ files: { 'src/x.ts': { mutants: [{ status: 'Killed' }] } } }))
    try {
      expect(readStrykerReport(tmpFile).files?.['src/x.ts']?.mutants?.length).toBe(1)
    } finally {
      rmSync(tmpFile, { force: true })
    }
  })
})
