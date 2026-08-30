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
  selectChangedMutationTargets,
  type ChangedFilesDeps,
  type ChangedFilesRunDeps,
} from '../../../scripts/mutation/changed-files.js'
import { isGeneratedSourceFile, isInstrumentationIncompatibleFile } from '../../../scripts/mutation/exclusions.js'
import { resolveChangedFilesGates, resolveErroredGate } from '../../../scripts/mutation/gates.js'
import type { GateInput } from '../../../scripts/mutation/gates.js'
import type { IncrementalDeps, IncrementalPlan } from '../../../scripts/mutation/incremental-run.js'
import type { PairedRunFileResult, PairedRunInput, PairedRunResult } from '../../../scripts/mutation/paired-run.js'
import { runUpdateBaseline, seedBaseline } from '../../../scripts/mutation/seed-from.js'

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

/** changedFilesRun returns null only for an empty target list; every gate assertion has targets. */
const expectGateInput = (result: GateInput | null): GateInput => {
  if (result === null) throw new Error('expected changedFilesRun to return a gate input')
  return result
}

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

  test('drops generated modules even when the gateable predicate accepts them', () => {
    const deps = makeDeps(
      ['src/analytics/generated/tool-slugs.ts', 'src/analytics/tool-slug-generation.ts'].join('\n'),
      () => true,
    )

    const result = selectChangedMutationTargets({
      baseRef: 'origin/master',
      projectRoot: '/repo',
      deps,
    })

    expect(result).toEqual(['src/analytics/tool-slug-generation.ts'])
  })

  test('drops the kaneo auto-provision wrapper whose instrumented source fails the static settlement guard', () => {
    const deps = makeDeps(
      ['plugins/task-provider-kaneo/auto-provision.ts', 'plugins/task-provider-kaneo/provision.ts'].join('\n'),
      () => true,
    )

    const result = selectChangedMutationTargets({
      baseRef: 'origin/master',
      projectRoot: '/repo',
      deps,
    })

    expect(result).toEqual(['plugins/task-provider-kaneo/provision.ts'])
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

describe('isGeneratedSourceFile', () => {
  test('matches a "generated" directory segment at any depth, on either separator', () => {
    expect(isGeneratedSourceFile('src/analytics/generated/tool-slugs.ts')).toBe(true)
    expect(isGeneratedSourceFile('generated/tool-slugs.ts')).toBe(true)
    expect(isGeneratedSourceFile('src\\analytics\\generated\\tool-slugs.ts')).toBe(true)
  })

  test('does not match a segment that merely contains "generated"', () => {
    expect(isGeneratedSourceFile('src/analytics/tool-slug-generation.ts')).toBe(false)
    expect(isGeneratedSourceFile('src/analytics/generated.ts')).toBe(false)
    expect(isGeneratedSourceFile('src/generated-slugs/index.ts')).toBe(false)
    expect(isGeneratedSourceFile('src/regenerated/index.ts')).toBe(false)
  })
})

describe('isInstrumentationIncompatibleFile', () => {
  test('matches exactly the kaneo auto-provision wrapper, not its neighbors', () => {
    expect(isInstrumentationIncompatibleFile('plugins/task-provider-kaneo/auto-provision.ts')).toBe(true)
    expect(isInstrumentationIncompatibleFile('plugins/task-provider-kaneo/provision.ts')).toBe(false)
    expect(isInstrumentationIncompatibleFile('src/providers/auto-provision.ts')).toBe(false)
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
      noScoreCache: false,
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
      noScoreCache: false,
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
      noScoreCache: false,
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
      noScoreCache: false,
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
      incremental: undefined,
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
      incremental: undefined,
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

  test('writes an empty scores file and preserves the baseline when no files were measured', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'papai-update-baseline-'))
    const reportDir = path.join(dir, 'reports', 'paired')
    const baselinePath = path.join(dir, 'baseline.json')
    fs.writeFileSync(baselinePath, JSON.stringify({ 'src/old.ts': 0.6 }))

    const count = runUpdateBaseline({ baselinePath, reportDir, perFile: [] })

    expect(count).toBe(1)
    expect(readBaseline(baselinePath)).toEqual({ 'src/old.ts': 0.6 })
    expect(readBaseline(path.join(reportDir, 'scores.json'))).toEqual({})
  })
})

describe('resolveErroredGate', () => {
  test('passes when no file errored', () => {
    expect(resolveErroredGate([])).toEqual({ exitCode: 0, message: null })
  })

  test('fails and names every errored file', () => {
    const gate = resolveErroredGate([
      { sourceFile: 'client/a.ts', error: 'ConfigError: tests failed' },
      { sourceFile: 'client/b.ts', error: 'timeout' },
    ])

    expect(gate.exitCode).toBe(1)
    expect(gate.message).toContain('client/a.ts')
    expect(gate.message).toContain('ConfigError: tests failed')
    expect(gate.message).toContain('client/b.ts')
    expect(gate.message).toContain('timeout')
  })
})

describe('changedFilesRun with carried-over scores', () => {
  const merged = (score: number, scoredCount = 10): PerFileScore['merged'] => ({
    killed: Math.round(score * scoredCount),
    survived: scoredCount - Math.round(score * scoredCount),
    noCoverage: 0,
    timeout: 0,
    compileError: 0,
    ignored: 0,
    runtimeError: 0,
    pending: 0,
    total: scoredCount,
    scored: scoredCount,
    score,
  })

  const fileResult = (sourceFile: string, score: number): PairedRunFileResult => ({
    sourceFile,
    testFiles: [],
    configPath: '',
    reportPath: '',
    merged: merged(score),
  })

  const runResult = (
    perFile: readonly PairedRunFileResult[],
    over: Partial<PairedRunResult> = {},
  ): PairedRunResult => ({
    merged: merged(1),
    perFile,
    skipped: [],
    errored: [],
    ...over,
  })

  const incrementalDeps = (
    plan: IncrementalPlan,
    record = mock((_fresh: readonly PerFileScore[]) => {}),
  ): { deps: IncrementalDeps; record: typeof record } => ({
    deps: { plan: mock(() => plan), record },
    record,
  })

  /**
   * The headline scenario, and the reason this feature exists at all.
   *
   * Commit A drops src/x.ts from its 0.9 floor to 0.5. Commit B changes only src/y.ts, which
   * is fine. The run for commit B measures ONLY src/y.ts — but src/x.ts is still in the branch
   * diff, its carried-over 0.5 is still what the branch contains, and the gate must still fail
   * naming it. An implementation that gated only what it measured would go green here.
   */
  test("still fails on an earlier commit's regression while measuring only the newly-changed file", async () => {
    const runPaired = mock((_input: PairedRunInput) => Promise.resolve(runResult([fileResult('src/y.ts', 0.95)])))
    const { deps: incremental } = incrementalDeps({
      toMeasure: ['src/y.ts'],
      reused: [{ sourceFile: 'src/x.ts', merged: merged(0.5), measuredAt: Date.now() }],
    })

    const result = await changedFilesRun({
      projectRoot: '/repo',
      reportDir: '/repo/reports/paired',
      baseRef: 'origin/master',
      baseline: { 'src/x.ts': 0.9, 'src/y.ts': 0.9 },
      verbose: false,
      incremental,
      deps: { selectTargets: () => ['src/x.ts', 'src/y.ts'], runPaired, log: () => {} },
    })

    expect(runPaired).toHaveBeenCalledTimes(1)
    expect(runPaired.mock.calls[0]?.[0]?.sourceFiles).toEqual(['src/y.ts'])
    expect(result?.perFile.map((f) => f.sourceFile).toSorted()).toEqual(['src/x.ts', 'src/y.ts'])

    const verdict = resolveChangedFilesGates({
      result: expectGateInput(result),
      threshold: 0,
      noRatchet: false,
      baseline: { 'src/x.ts': 0.9, 'src/y.ts': 0.9 },
    })
    expect(verdict.exitCode).toBe(1)
    expect(verdict.message).toBe('Mutation ratchet regression: src/x.ts 0.5000 < 0.9000')
  })

  test('passes when the carried-over score still clears its floor', async () => {
    const { deps: incremental } = incrementalDeps({
      toMeasure: ['src/y.ts'],
      reused: [{ sourceFile: 'src/x.ts', merged: merged(0.95), measuredAt: Date.now() }],
    })

    const result = await changedFilesRun({
      projectRoot: '/repo',
      reportDir: '/repo/reports/paired',
      baseRef: 'origin/master',
      baseline: { 'src/x.ts': 0.9, 'src/y.ts': 0.9 },
      verbose: false,
      incremental,
      deps: {
        selectTargets: () => ['src/x.ts', 'src/y.ts'],
        runPaired: () => Promise.resolve(runResult([fileResult('src/y.ts', 0.95)])),
        log: () => {},
      },
    })

    const verdict = resolveChangedFilesGates({
      result: expectGateInput(result),
      threshold: 0,
      noRatchet: false,
      baseline: { 'src/x.ts': 0.9, 'src/y.ts': 0.9 },
    })
    expect(verdict.exitCode).toBe(0)
  })

  // Stryker is never asked to do nothing: pairedRun's coverage-map prelude alone costs real
  // time, so a run with nothing to measure must not call it at all.
  test('does not invoke pairedRun when every target can be carried over', async () => {
    const runPaired = mock((_input: PairedRunInput) => Promise.resolve(runResult([])))
    const { deps: incremental } = incrementalDeps({
      toMeasure: [],
      reused: [{ sourceFile: 'src/x.ts', merged: merged(0.5), measuredAt: Date.now() }],
    })

    const result = await changedFilesRun({
      projectRoot: '/repo',
      reportDir: '/repo/reports/paired',
      baseRef: 'origin/master',
      baseline: { 'src/x.ts': 0.9 },
      verbose: false,
      incremental,
      deps: { selectTargets: () => ['src/x.ts'], runPaired, log: () => {} },
    })

    expect(runPaired).not.toHaveBeenCalled()
    expect(result?.perFile).toEqual([{ sourceFile: 'src/x.ts', merged: merged(0.5) }])
    const verdict = resolveChangedFilesGates({
      result: expectGateInput(result),
      threshold: 0,
      noRatchet: false,
      baseline: { 'src/x.ts': 0.9 },
    })
    expect(verdict.exitCode).toBe(1)
  })

  /**
   * Recording happens before the verdict, so a FAILING run still persists what it measured.
   * Without this the next push re-measures the regressed file from scratch and the gate loses
   * the memory that makes it whole-branch — the feature would not work at all.
   */
  test('records measured scores even when the run is about to fail', async () => {
    const { deps: incremental, record } = incrementalDeps({ toMeasure: ['src/y.ts'], reused: [] })
    const fresh = fileResult('src/y.ts', 0.1)

    await changedFilesRun({
      projectRoot: '/repo',
      reportDir: '/repo/reports/paired',
      baseRef: 'origin/master',
      baseline: { 'src/y.ts': 0.9 },
      verbose: false,
      incremental,
      deps: {
        selectTargets: () => ['src/y.ts'],
        runPaired: () => Promise.resolve(runResult([fresh])),
        log: () => {},
      },
    })

    expect(record).toHaveBeenCalledWith([fresh])
  })

  // An errored file produces no perFile entry, so it can never be recorded — which is what
  // keeps it retryable instead of frozen as an unmeasurable pass.
  test('never records a file whose run errored', async () => {
    const { deps: incremental, record } = incrementalDeps({ toMeasure: ['src/boom.ts'], reused: [] })

    const result = await changedFilesRun({
      projectRoot: '/repo',
      reportDir: '/repo/reports/paired',
      baseRef: 'origin/master',
      baseline: {},
      verbose: false,
      incremental,
      deps: {
        selectTargets: () => ['src/boom.ts'],
        runPaired: () => Promise.resolve(runResult([], { errored: [{ sourceFile: 'src/boom.ts', error: 'dry run' }] })),
        log: () => {},
      },
    })

    expect(record).toHaveBeenCalledWith([])
    expect(result?.errored).toEqual([{ sourceFile: 'src/boom.ts', error: 'dry run' }])
  })

  test('still reports a first measurement for an unbaselined file that was carried over', async () => {
    const logs: string[] = []
    const { deps: incremental } = incrementalDeps({
      toMeasure: [],
      reused: [{ sourceFile: 'src/brand-new.ts', merged: merged(0.42), measuredAt: Date.now() }],
    })

    await changedFilesRun({
      projectRoot: '/repo',
      reportDir: '/repo/reports/paired',
      baseRef: 'origin/master',
      baseline: {},
      verbose: false,
      incremental,
      deps: {
        selectTargets: () => ['src/brand-new.ts'],
        runPaired: () => Promise.resolve(runResult([])),
        log: (message) => {
          logs.push(message)
        },
      },
    })

    expect(logs.some((m) => m.includes('First measurement for src/brand-new.ts: score 0.4200'))).toBe(true)
  })

  test('logs the measured-versus-reused split so a green run reads as whole-branch', async () => {
    const logs: string[] = []
    const { deps: incremental } = incrementalDeps({
      toMeasure: ['src/y.ts'],
      reused: [{ sourceFile: 'src/x.ts', merged: merged(0.68), measuredAt: Date.now() }],
    })

    await changedFilesRun({
      projectRoot: '/repo',
      reportDir: '/repo/reports/paired',
      baseRef: 'origin/master',
      baseline: {},
      verbose: false,
      incremental,
      deps: {
        selectTargets: () => ['src/x.ts', 'src/y.ts'],
        runPaired: () => Promise.resolve(runResult([fileResult('src/y.ts', 0.9)])),
        log: (message) => {
          logs.push(message)
        },
      },
    })

    const joined = logs.join('\n')
    expect(joined).toContain('measured now: 1')
    expect(joined).toContain('reused: 1')
    expect(joined).toContain('src/x.ts')
  })

  // With reuse switched off the runner must behave exactly as it did before this feature:
  // every branch-diff target measured, nothing consulted, nothing recorded.
  test('measures every target when no incremental deps are supplied', async () => {
    const runPaired = mock((_input: PairedRunInput) =>
      Promise.resolve(runResult([fileResult('src/x.ts', 0.9), fileResult('src/y.ts', 0.9)])),
    )

    const result = await changedFilesRun({
      projectRoot: '/repo',
      reportDir: '/repo/reports/paired',
      baseRef: 'origin/master',
      baseline: {},
      verbose: false,
      incremental: undefined,
      deps: { selectTargets: () => ['src/x.ts', 'src/y.ts'], runPaired, log: () => {} },
    })

    expect(runPaired.mock.calls[0]?.[0]?.sourceFiles).toEqual(['src/x.ts', 'src/y.ts'])
    expect(result?.perFile.map((f) => f.sourceFile)).toEqual(['src/x.ts', 'src/y.ts'])
  })
})

describe('parseChangedFilesCliArgs --no-score-cache', () => {
  test('parses the reuse escape hatch', () => {
    expect(parseChangedFilesCliArgs(['--no-score-cache'])).toEqual({
      kind: 'ok',
      baseRef: 'origin/master',
      threshold: 0,
      noRatchet: false,
      verbose: false,
      updateBaseline: false,
      noScoreCache: true,
    })
  })

  test('combines with --update-baseline', () => {
    expect(parseChangedFilesCliArgs(['--update-baseline', '--no-score-cache'])).toMatchObject({
      kind: 'ok',
      updateBaseline: true,
      noScoreCache: true,
    })
  })

  test('still rejects unknown flags', () => {
    expect(parseChangedFilesCliArgs(['--no-score-caches'])).toMatchObject({ kind: 'usageError' })
  })
})
