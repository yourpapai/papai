// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import {
  allFilesRun,
  parseAllFilesCliArgs,
  selectAllMutationTargets,
  type AllFilesDeps,
} from '../../../scripts/mutation/all-files.js'

const BASE_CONFIG = {
  mutate: [
    'src/providers/**/*.ts',
    '!src/providers/**/index.ts',
    '!src/providers/**/constants.ts',
    '!src/providers/types.ts',
    'src/tools/**/*.ts',
    '!src/tools/index.ts',
    'src/config.ts',
  ],
}

const FILES = [
  'src/config.ts',
  'src/providers/kaneo/label-resource.ts',
  'src/providers/kaneo/index.ts',
  'src/providers/kaneo/constants.ts',
  'src/providers/types.ts',
  'src/tools/update-status.ts',
  'src/tools/index.ts',
  'tests/tools/update-status.test.ts',
]

describe('selectAllMutationTargets', () => {
  test('expands configured mutate includes and excludes sorted targets', () => {
    const result = selectAllMutationTargets({
      baseConfig: BASE_CONFIG,
      projectFiles: FILES,
    })

    expect(result).toEqual(['src/config.ts', 'src/providers/kaneo/label-resource.ts', 'src/tools/update-status.ts'])
  })

  test('rejects configs without mutate patterns', () => {
    expect(() =>
      selectAllMutationTargets({
        baseConfig: {},
        projectFiles: FILES,
      }),
    ).toThrow(/mutate/u)
  })
})

describe('parseAllFilesCliArgs', () => {
  test('returns defaults for no args', () => {
    expect(parseAllFilesCliArgs([])).toEqual({ kind: 'ok', threshold: 0, verbose: false })
  })

  test('accepts a fractional threshold', () => {
    expect(parseAllFilesCliArgs(['--threshold=0.75'])).toEqual({ kind: 'ok', threshold: 0.75, verbose: false })
  })

  test('accepts verbose mode', () => {
    expect(parseAllFilesCliArgs(['--verbose'])).toEqual({ kind: 'ok', threshold: 0, verbose: true })
  })

  test('rejects unknown and positional arguments', () => {
    expect(parseAllFilesCliArgs(['src/config.ts'])).toEqual({
      kind: 'usageError',
      reason: 'unexpected positional argument src/config.ts',
    })
    expect(parseAllFilesCliArgs(['--unknown'])).toEqual({
      kind: 'usageError',
      reason: 'unknown argument --unknown',
    })
  })

  test('rejects invalid thresholds', () => {
    expect(parseAllFilesCliArgs(['--threshold=1.1'])).toEqual({
      kind: 'usageError',
      reason: 'threshold must be a decimal number between 0 and 1',
    })
  })
})

describe('allFilesRun', () => {
  test('runs paired mutation over all selected targets', async () => {
    const runPaired = mock(() =>
      Promise.resolve({
        merged: {
          killed: 1,
          survived: 1,
          noCoverage: 0,
          timeout: 0,
          compileError: 0,
          ignored: 0,
          runtimeError: 0,
          pending: 0,
          total: 2,
          scored: 2,
          score: 0.5,
        },
        perFile: [],
        skipped: [],
      }),
    )
    const deps: AllFilesDeps = {
      readBaseConfig: mock(() => BASE_CONFIG),
      listProjectFiles: mock(() => FILES),
      runPaired,
      log: mock(() => {}),
    }

    const result = await allFilesRun({
      projectRoot: '/repo',
      reportDir: '/repo/reports/paired',
      verbose: undefined,
      deps,
    })

    expect(runPaired).toHaveBeenCalledWith({
      projectRoot: '/repo',
      reportDir: '/repo/reports/paired',
      sourceFiles: ['src/config.ts', 'src/providers/kaneo/label-resource.ts', 'src/tools/update-status.ts'],
      verbose: false,
      deps: undefined,
    })
    expect(result.merged.score).toBe(0.5)
  })
})
