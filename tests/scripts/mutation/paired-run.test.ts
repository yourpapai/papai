// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  pairedRun,
  parsePairedRunCliArgs,
  resolvePairedRunCliUsageExitCode,
  resolvePairedRunExitCode,
} from '../../../scripts/mutation/paired-run.js'
import type { PairedRunDeps } from '../../../scripts/mutation/paired-run.js'
import type { StrykerReport } from '../../../scripts/mutation/score-merger.js'
import type { MergedScore } from '../../../scripts/mutation/score-merger.js'

const makeReport = (statuses: readonly string[]): StrykerReport => ({
  files: {
    'src/x.ts': { mutants: statuses.map((status, i) => ({ id: `m${i}`, status })) },
  },
})

const makeReportDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'paired-run-'))

const isReportConfig = (value: unknown): value is { readonly jsonReporter: { readonly fileName: string } } =>
  value !== null &&
  typeof value === 'object' &&
  'jsonReporter' in value &&
  value.jsonReporter !== null &&
  typeof value.jsonReporter === 'object' &&
  'fileName' in value.jsonReporter &&
  typeof value.jsonReporter.fileName === 'string'

const isStrykerReport = (value: unknown): value is StrykerReport => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  if (!('files' in value)) return true
  const files = value.files
  return files !== null && typeof files === 'object' && !Array.isArray(files)
}

const readConfiguredReportPath = (configPath: string): string => {
  const parsed: unknown = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  if (!isReportConfig(parsed)) {
    throw new Error('Expected paired config to contain jsonReporter.fileName')
  }
  return parsed.jsonReporter.fileName
}

const writeConfiguredReport = (configPath: string, report: StrykerReport): void => {
  fs.writeFileSync(readConfiguredReportPath(configPath), `${JSON.stringify(report)}\n`)
}

const readStrykerReport = (reportPath: string): StrykerReport => {
  const parsed: unknown = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
  if (!isStrykerReport(parsed)) {
    throw new Error('Expected Stryker report JSON object')
  }
  return parsed
}

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
    const runStryker = mock((configPath: string) => {
      writeConfiguredReport(configPath, makeReport(['Killed', 'Survived']))
    })
    const deps: PairedRunDeps = {
      readBaseConfig: () => ({ bun: { timeout: 120_000 } }),
      resolveCompanion: (srcFile) => `tests/${path.basename(srcFile, '.ts')}.test.ts`,
      loadOverrides: () => ({}),
      runStryker,
      readReport: readStrykerReport,
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

  test('removes stale reports before running Stryker', async () => {
    const reportDir = makeReportDir()
    const staleReportPath = path.join(reportDir, 'src__foo.ts.stryker-report.json')
    fs.writeFileSync(staleReportPath, `${JSON.stringify(makeReport(['Survived']))}\n`)
    const runStryker = mock((configPath: string) => {
      expect(fs.existsSync(staleReportPath)).toBe(false)
      writeConfiguredReport(configPath, makeReport(['Killed']))
    })
    const deps: PairedRunDeps = {
      readBaseConfig: () => ({}),
      resolveCompanion: () => 'tests/foo.test.ts',
      loadOverrides: () => ({}),
      runStryker,
      readReport: readStrykerReport,
      log: () => {},
    }

    const result = await pairedRun({
      projectRoot: '/repo',
      reportDir,
      sourceFiles: ['src/foo.ts'],
      deps,
    })

    expect(result.merged.killed).toBe(1)
    expect(result.merged.survived).toBe(0)
  })

  test('fails when Stryker does not write the expected report', async () => {
    const reportDir = makeReportDir()
    const deps: PairedRunDeps = {
      readBaseConfig: () => ({}),
      resolveCompanion: () => 'tests/foo.test.ts',
      loadOverrides: () => ({}),
      runStryker: mock(() => {}),
      readReport: () => makeReport(['Killed']),
      log: () => {},
    }

    await expect(
      Promise.resolve().then(() =>
        pairedRun({
          projectRoot: '/repo',
          reportDir,
          sourceFiles: ['src/foo.ts'],
          deps,
        }),
      ),
    ).rejects.toThrow(/missing Stryker JSON report/u)
  })

  test('continues when Stryker throws after writing the expected report', async () => {
    const reportDir = makeReportDir()
    const deps: PairedRunDeps = {
      readBaseConfig: () => ({}),
      resolveCompanion: () => 'tests/foo.test.ts',
      loadOverrides: () => ({}),
      runStryker: mock((configPath: string) => {
        writeConfiguredReport(configPath, makeReport(['Killed', 'Survived']))
        throw new Error('stryker threshold failed')
      }),
      readReport: readStrykerReport,
      log: () => {},
    }

    const result = await pairedRun({
      projectRoot: '/repo',
      reportDir,
      sourceFiles: ['src/foo.ts'],
      deps,
    })

    expect(result.merged.killed).toBe(1)
    expect(result.merged.survived).toBe(1)
  })

  test('fails with missing-report error when Stryker throws without writing the report', async () => {
    const reportDir = makeReportDir()
    const deps: PairedRunDeps = {
      readBaseConfig: () => ({}),
      resolveCompanion: () => 'tests/foo.test.ts',
      loadOverrides: () => ({}),
      runStryker: mock(() => {
        throw new Error('stryker crashed')
      }),
      readReport: () => makeReport(['Killed']),
      log: () => {},
    }

    await expect(
      Promise.resolve().then(() =>
        pairedRun({
          projectRoot: '/repo',
          reportDir,
          sourceFiles: ['src/foo.ts'],
          deps,
        }),
      ),
    ).rejects.toThrow(/missing Stryker JSON report/u)
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
      writeConfiguredReport(configPath, makeReport(['Killed']))
    })
    const deps: PairedRunDeps = {
      readBaseConfig: () => ({ bun: { timeout: 120_000 }, ignoreStatic: true }),
      resolveCompanion: () => 'tests/foo.test.ts',
      loadOverrides: () => ({}),
      runStryker,
      readReport: readStrykerReport,
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
  test('parses source files with a threshold value', () => {
    expect(parsePairedRunCliArgs(['src/foo.ts', 'src/bar.ts', '--threshold=0.75'])).toEqual({
      kind: 'ok',
      sourceFiles: ['src/foo.ts', 'src/bar.ts'],
      threshold: 0.75,
    })
  })

  test('treats invalid threshold values as usage errors', () => {
    expect(parsePairedRunCliArgs(['src/foo.ts', '--threshold=not-a-number'])).toEqual({
      kind: 'usageError',
      reason: 'threshold must be a finite number',
    })
  })

  test('treats empty threshold values as usage errors', () => {
    expect(parsePairedRunCliArgs(['src/foo.ts', '--threshold='])).toEqual({
      kind: 'usageError',
      reason: 'threshold must be a finite number',
    })
  })

  test('rejects duplicate threshold arguments', () => {
    expect(parsePairedRunCliArgs(['src/foo.ts', '--threshold=0.5', '--threshold=0.75'])).toEqual({
      kind: 'usageError',
      reason: 'threshold must be provided at most once',
    })
  })

  test('rejects duplicate threshold arguments with an invalid later value', () => {
    expect(parsePairedRunCliArgs(['src/foo.ts', '--threshold=1', '--threshold=not-a-number'])).toEqual({
      kind: 'usageError',
      reason: 'threshold must be provided at most once',
    })
  })

  test('rejects unknown flags', () => {
    expect(parsePairedRunCliArgs(['src/foo.ts', '--threshod=0.75'])).toEqual({
      kind: 'usageError',
      reason: 'unknown argument --threshod=0.75',
    })
  })

  test('rejects unknown short flags', () => {
    expect(parsePairedRunCliArgs(['src/foo.ts', '-x'])).toEqual({
      kind: 'usageError',
      reason: 'unknown argument -x',
    })
  })

  test('rejects split threshold syntax', () => {
    expect(parsePairedRunCliArgs(['src/foo.ts', '--threshold', '0.75'])).toEqual({
      kind: 'usageError',
      reason: 'unknown argument --threshold',
    })
  })
})

describe('resolvePairedRunExitCode', () => {
  test('returns 0 when score meets threshold', () => {
    expect(resolvePairedRunExitCode({ ...ZERO_SCORE, score: 0.75, scored: 4, total: 4 }, 0.75)).toBe(0)
  })

  test('returns 1 when score is below threshold', () => {
    expect(resolvePairedRunExitCode({ ...ZERO_SCORE, score: 0.74, scored: 4, total: 4 }, 0.75)).toBe(1)
  })

  test('fails when a zero-score run is below a positive threshold', () => {
    expect(resolvePairedRunExitCode(ZERO_SCORE, 0.1)).toBe(1)
  })
})

describe('resolvePairedRunCliUsageExitCode', () => {
  test('returns 2 for usage-error CLI parse results', () => {
    expect(resolvePairedRunCliUsageExitCode({ kind: 'usageError', reason: 'threshold must be a finite number' })).toBe(
      2,
    )
  })
})
