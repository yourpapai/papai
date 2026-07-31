// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { isBaselineMap } from '../../../scripts/mutation/baseline.js'
import type { PerFileScore } from '../../../scripts/mutation/baseline.js'
import {
  changedFilesRun,
  parseChangedFilesCliArgs,
  runUpdateBaseline,
  seedBaseline,
  selectChangedMutationTargets,
  type ChangedFilesDeps,
  type ChangedFilesRunDeps,
} from '../../../scripts/mutation/changed-files.js'

const makeDeps = (gitOutput: string, isGateableImpl: ChangedFilesDeps['isGateableImpl']): ChangedFilesDeps => ({
  runGit: mock(() => gitOutput),
  isGateableImpl,
})

const scored = (sourceFile: string, scoreValue: number): PerFileScore => ({
  sourceFile,
  merged: {
    killed: 0,
    survived: 0,
    noCoverage: 0,
    timeout: 0,
    compileError: 0,
    ignored: 0,
    runtimeError: 0,
    pending: 0,
    total: 1,
    scored: 1,
    score: scoreValue,
  },
})

const unscored = (sourceFile: string): PerFileScore => ({
  sourceFile,
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
})

const tmpBaselinePath = (): string => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'papai-seed-')), 'baseline.json')

const readBaseline = (baselinePath: string): Record<string, number> => {
  const parsed: unknown = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
  if (!isBaselineMap(parsed)) throw new Error(`baseline at ${baselinePath} is not a BaselineMap`)
  return parsed
}

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
    expect(parseChangedFilesCliArgs([])).toEqual({
      kind: 'ok',
      baseRef: 'origin/master',
      threshold: 0,
      noRatchet: false,
      verbose: false,
      updateBaseline: false,
    })
  })

  test('parses verbose mode', () => {
    expect(parseChangedFilesCliArgs(['--verbose'])).toEqual({
      kind: 'ok',
      baseRef: 'origin/master',
      threshold: 0,
      noRatchet: false,
      verbose: true,
      updateBaseline: false,
    })
  })

  test('parses --no-ratchet', () => {
    expect(parseChangedFilesCliArgs(['--no-ratchet'])).toEqual({
      kind: 'ok',
      baseRef: 'origin/master',
      threshold: 0,
      noRatchet: true,
      verbose: false,
      updateBaseline: false,
    })
  })

  test('parses --update-baseline', () => {
    expect(parseChangedFilesCliArgs(['--update-baseline'])).toEqual({
      kind: 'ok',
      baseRef: 'origin/master',
      threshold: 0,
      noRatchet: false,
      verbose: false,
      updateBaseline: true,
    })
  })

  test('rejects the removed --ratchet-floor flag', () => {
    expect(parseChangedFilesCliArgs(['--ratchet-floor=0.6'])).toEqual({
      kind: 'usageError',
      reason: 'unknown argument --ratchet-floor=0.6',
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
        errored: [],
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
      baseline: {},
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

  test('warns on first-touch unbaselined files inside changedFilesRun', async () => {
    const logs: string[] = []
    const deps: ChangedFilesRunDeps = {
      selectTargets: () => ['src/a.ts', 'src/new.ts', 'src/unscored.ts'],
      runPaired: () =>
        Promise.resolve({
          merged: {
            killed: 5,
            survived: 15,
            noCoverage: 0,
            timeout: 0,
            compileError: 0,
            ignored: 0,
            runtimeError: 0,
            pending: 0,
            total: 20,
            scored: 20,
            score: 0.25,
          },
          perFile: [
            {
              sourceFile: 'src/a.ts',
              testFiles: [],
              configPath: '',
              reportPath: '',
              merged: {
                killed: 4,
                survived: 6,
                noCoverage: 0,
                timeout: 0,
                compileError: 0,
                ignored: 0,
                runtimeError: 0,
                pending: 0,
                total: 10,
                scored: 10,
                score: 0.4,
              },
            },
            {
              sourceFile: 'src/new.ts',
              testFiles: [],
              configPath: '',
              reportPath: '',
              merged: {
                killed: 1,
                survived: 9,
                noCoverage: 0,
                timeout: 0,
                compileError: 0,
                ignored: 0,
                runtimeError: 0,
                pending: 0,
                total: 10,
                scored: 10,
                score: 0.1,
              },
            },
            {
              sourceFile: 'src/unscored.ts',
              testFiles: [],
              configPath: '',
              reportPath: '',
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
            },
          ],
          skipped: [],
          errored: [],
        }),
      log: (m) => {
        logs.push(m)
      },
    }

    await changedFilesRun({
      projectRoot: '<tmp>',
      reportDir: '<tmp>',
      baseRef: 'origin/master',
      baseline: { 'src/a.ts': 0.5 },
      verbose: false,
      deps,
    })

    expect(logs.some((m) => m.includes('First measurement for src/new.ts: score 0.1000'))).toBe(true)
    expect(logs.every((m) => !m.includes('First measurement for src/a.ts'))).toBe(true)
    expect(logs.every((m) => !m.includes('First measurement for src/unscored.ts'))).toBe(true)
  })
})

describe('seedBaseline', () => {
  test('preserves untouched baseline entries and adds changed entries via seedMerge', () => {
    const baselinePath = tmpBaselinePath()
    fs.writeFileSync(baselinePath, JSON.stringify({ 'src/untouched.ts': 0.8 }))

    const count = seedBaseline(baselinePath, [scored('src/changed.ts', 0.5), scored('src/new.ts', 0.3)])

    const written = readBaseline(baselinePath)
    expect(written['src/untouched.ts']).toBe(0.8)
    expect(written['src/changed.ts']).toBe(0.5)
    expect(written['src/new.ts']).toBe(0.3)
    expect(count).toBe(3)
  })

  test('keeps the higher score when latest exceeds existing (seedMerge max)', () => {
    const baselinePath = tmpBaselinePath()
    fs.writeFileSync(baselinePath, JSON.stringify({ 'src/raised.ts': 0.7 }))

    seedBaseline(baselinePath, [scored('src/raised.ts', 0.9)])

    const written = readBaseline(baselinePath)
    expect(written['src/raised.ts']).toBe(0.9)
  })

  test('never lowers an existing score (seedMerge, not ratchetMerge)', () => {
    const baselinePath = tmpBaselinePath()
    fs.writeFileSync(baselinePath, JSON.stringify({ 'src/high.ts': 0.9, 'src/untouched.ts': 0.6 }))

    seedBaseline(baselinePath, [scored('src/high.ts', 0.5)])

    const written = readBaseline(baselinePath)
    expect(written['src/high.ts']).toBe(0.9)
    expect(written['src/untouched.ts']).toBe(0.6)
  })

  test('creates a new baseline file when none exists', () => {
    const baselinePath = tmpBaselinePath()

    const count = seedBaseline(baselinePath, [scored('src/fresh.ts', 0.5)])

    expect(count).toBe(1)
    const written = readBaseline(baselinePath)
    expect(written['src/fresh.ts']).toBe(0.5)
  })

  test('skips entries with no scoreable mutants', () => {
    const baselinePath = tmpBaselinePath()

    const count = seedBaseline(baselinePath, [unscored('src/empty.ts')])

    expect(count).toBe(0)
  })
})

describe('runUpdateBaseline', () => {
  test('seeds the baseline and writes the scores file consumed by the CI re-seed step', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'papai-update-baseline-'))
    const reportDir = path.join(dir, 'reports', 'paired')
    const baselinePath = path.join(dir, 'baseline.json')
    fs.writeFileSync(baselinePath, JSON.stringify({ 'src/old.ts': 0.6 }))

    const count = runUpdateBaseline({
      baselinePath,
      reportDir,
      perFile: [scored('src/a.ts', 0.5), unscored('src/u.ts')],
    })

    expect(count).toBe(2)
    expect(readBaseline(baselinePath)).toEqual({ 'src/a.ts': 0.5, 'src/old.ts': 0.6 })
    expect(readBaseline(path.join(reportDir, 'scores.json'))).toEqual({ 'src/a.ts': 0.5 })
  })
})
