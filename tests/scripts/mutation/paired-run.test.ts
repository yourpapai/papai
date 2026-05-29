// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { pairedRun, parsePairedRunCliArgs, resolvePairedRunExitCode } from '../../../scripts/mutation/paired-run.js'
import type { PairedRunDeps } from '../../../scripts/mutation/paired-run.js'
import type { StrykerReport } from '../../../scripts/mutation/score-merger.js'
import type { MergedScore } from '../../../scripts/mutation/score-merger.js'

const makeReport = (statuses: readonly string[]): StrykerReport => ({
  files: {
    'src/x.ts': { mutants: statuses.map((status, i) => ({ id: `m${i}`, status })) },
  },
})

const makeReportDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'paired-run-'))

const ZERO_SCORE = {
  killed: 0,
  survived: 0,
  noCoverage: 0,
  timeout: 0,
  compileError: 0,
  ignored: 0,
  runtimeError: 0,
  pending: 0,
  total: 0,
  scored: 0,
  score: 0,
} as const satisfies MergedScore

describe('pairedRun', () => {
  test('runs Stryker once per source file and returns merged score', async () => {
    const reportDir = makeReportDir()
    const runStryker = mock(() => {})
    const deps: PairedRunDeps = {
      readBaseConfig: () => ({ bun: { timeout: 120_000 } }),
      resolveCompanion: (srcFile) => `tests/${path.basename(srcFile, '.ts')}.test.ts`,
      loadOverrides: () => ({}),
      runStryker,
      readReport: () => makeReport(['Killed', 'Survived']),
      log: () => {},
    }

    const result = await pairedRun({
      projectRoot: '/repo',
      reportDir,
      sourceFiles: ['src/one.ts', 'src/two.ts'],
      deps,
    })

    expect(runStryker).toHaveBeenCalledTimes(2)
    expect(result.merged.killed).toBe(2)
    expect(result.merged.survived).toBe(2)
    expect(result.merged.score).toBe(0.5)
    expect(result.skipped).toEqual([])
  })

  test('skips files with no companion and no override', async () => {
    const reportDir = makeReportDir()
    const deps: PairedRunDeps = {
      readBaseConfig: () => ({}),
      resolveCompanion: () => null,
      loadOverrides: () => ({}),
      runStryker: mock(() => {}),
      readReport: () => makeReport(['Killed']),
      log: () => {},
    }

    const result = await pairedRun({
      projectRoot: '/repo',
      reportDir,
      sourceFiles: ['src/no-companion.ts'],
      deps,
    })

    expect(result.skipped).toEqual([
      {
        sourceFile: 'src/no-companion.ts',
        reason:
          'no companion test for src/no-companion.ts and no override registered in scripts/mutation/overrides.json',
      },
    ])
    expect(result.merged.total).toBe(0)
  })

  test('writes one ephemeral config file per source file to reportDir', async () => {
    const reportDir = makeReportDir()
    const captured = { configPath: '' }
    const runStryker = mock((configPath: string) => {
      captured.configPath = configPath
    })
    const deps: PairedRunDeps = {
      readBaseConfig: () => ({ bun: { timeout: 120_000 }, ignoreStatic: true }),
      resolveCompanion: () => 'tests/foo.test.ts',
      loadOverrides: () => ({}),
      runStryker,
      readReport: () => makeReport(['Killed']),
      log: () => {},
    }

    await pairedRun({
      projectRoot: '/repo',
      reportDir,
      sourceFiles: ['src/foo.ts'],
      deps,
    })

    const { configPath } = captured
    expect(configPath).not.toBe('')
    expect(configPath.startsWith(reportDir)).toBe(true)
    expect(fs.existsSync(configPath)).toBe(true)

    const written: unknown = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    expect(written).toMatchObject({
      mutate: ['src/foo.ts'],
      ignoreStatic: false,
      bun: { testFiles: ['tests/foo.test.ts'] },
    })
  })
})

describe('parsePairedRunCliArgs', () => {
  test('treats invalid threshold values as usage errors', () => {
    expect(parsePairedRunCliArgs(['src/foo.ts', '--threshold=not-a-number'])).toEqual({
      kind: 'usageError',
      reason: 'threshold must be a finite number',
    })
  })
})

describe('resolvePairedRunExitCode', () => {
  test('fails when a zero-score run is below a positive threshold', () => {
    expect(resolvePairedRunExitCode(ZERO_SCORE, 0.1)).toBe(1)
  })
})
