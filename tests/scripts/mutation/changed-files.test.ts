// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import {
  changedFilesRun,
  parseChangedFilesCliArgs,
  selectChangedMutationTargets,
  type ChangedFilesDeps,
  type ChangedFilesRunDeps,
} from '../../../scripts/mutation/changed-files.js'

const makeDeps = (gitOutput: string, isGateableImpl: ChangedFilesDeps['isGateableImpl']): ChangedFilesDeps => ({
  runGit: mock(() => gitOutput),
  isGateableImpl,
})

describe('selectChangedMutationTargets', () => {
  test('returns gateable .ts files changed vs base ref sorted and deduped', () => {
    const gateableFiles = new Set(['src/a.ts', 'src/m.ts', 'src/z.ts'])
    const deps = makeDeps(
      ['src/z.ts', 'src/a.ts', 'README.md', 'src/a.ts', 'tests/a.test.ts', '', '  src/m.ts  '].join('\n'),
      (relPath) => gateableFiles.has(relPath),
    )

    const result = selectChangedMutationTargets({
      baseRef: 'origin/main',
      projectRoot: '/repo',
      deps,
    })

    expect(result).toEqual(['src/a.ts', 'src/m.ts', 'src/z.ts'])
  })

  test('returns empty list for empty git output', () => {
    const deps = makeDeps('', () => true)

    const result = selectChangedMutationTargets({
      baseRef: 'origin/master',
      projectRoot: '/repo',
      deps,
    })

    expect(result).toEqual([])
  })

  test('excludes test files and non-implementation assets using injected gateable predicate', () => {
    const isGateableImpl = mock((relPath: string) => relPath === 'src/impl.ts')
    const deps = makeDeps(['src/impl.ts', 'src/impl.test.ts', 'docs/guide.md'].join('\n'), isGateableImpl)

    const result = selectChangedMutationTargets({
      baseRef: 'origin/master',
      projectRoot: '/repo',
      deps,
    })

    expect(result).toEqual(['src/impl.ts'])
    expect(isGateableImpl).toHaveBeenCalledWith('src/impl.test.ts', '/repo')
    expect(isGateableImpl).toHaveBeenCalledWith('docs/guide.md', '/repo')
  })

  test('passes duplicate paths through the gateable predicate before deduping results', () => {
    const isGateableImpl = mock((relPath: string) => relPath === 'src/impl.ts')
    const deps = makeDeps(['src/impl.ts', 'src/impl.ts'].join('\n'), isGateableImpl)

    const result = selectChangedMutationTargets({
      baseRef: 'origin/master',
      projectRoot: '/repo',
      deps,
    })

    expect(result).toEqual(['src/impl.ts'])
    expect(isGateableImpl).toHaveBeenCalledTimes(2)
    expect(isGateableImpl).toHaveBeenNthCalledWith(1, 'src/impl.ts', '/repo')
    expect(isGateableImpl).toHaveBeenNthCalledWith(2, 'src/impl.ts', '/repo')
  })

  test("passes git args ['diff', '--name-only', '--diff-filter=ACMRT', 'origin/master...HEAD']", () => {
    const runGit = mock(() => 'src/impl.ts\n')
    const deps: ChangedFilesDeps = {
      runGit,
      isGateableImpl: () => true,
    }

    selectChangedMutationTargets({
      baseRef: 'origin/master',
      projectRoot: '/repo',
      deps,
    })

    expect(runGit).toHaveBeenCalledWith(['diff', '--name-only', '--diff-filter=ACMRT', 'origin/master...HEAD'])
  })
})

describe('parseChangedFilesCliArgs', () => {
  test('returns defaults for no args', () => {
    expect(parseChangedFilesCliArgs([])).toEqual({ kind: 'ok', baseRef: 'origin/master', threshold: 0, verbose: false })
  })

  test('parses verbose mode', () => {
    expect(parseChangedFilesCliArgs(['--verbose'])).toEqual({
      kind: 'ok',
      baseRef: 'origin/master',
      threshold: 0,
      verbose: true,
    })
  })

  test('rejects unexpected positional arguments', () => {
    expect(parseChangedFilesCliArgs(['src/impl.ts'])).toEqual({
      kind: 'usageError',
      reason: 'unexpected positional argument src/impl.ts',
    })
  })

  test('rejects unknown flags', () => {
    expect(parseChangedFilesCliArgs(['--unknown'])).toEqual({
      kind: 'usageError',
      reason: 'unknown argument --unknown',
    })
  })
})

describe('changedFilesRun', () => {
  test('passes verbose mode to pairedRun', async () => {
    const runPaired = mock(() =>
      Promise.resolve({
        merged: {
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
        },
        perFile: [],
        skipped: [],
      }),
    )
    const deps: ChangedFilesRunDeps = {
      selectTargets: mock(() => ['src/impl.ts']),
      runPaired,
      log: mock(() => {}),
    }

    await changedFilesRun({
      projectRoot: '/repo',
      reportDir: '/repo/reports/paired',
      baseRef: 'origin/master',
      verbose: true,
      deps,
    })

    expect(runPaired).toHaveBeenCalledWith({
      projectRoot: '/repo',
      reportDir: '/repo/reports/paired',
      sourceFiles: ['src/impl.ts'],
      verbose: true,
      deps: undefined,
    })
  })
})
