// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

import type { MutationImproveConfig } from '../../mutation-improve/src/config.js'
import { gatePhase } from '../../mutation-improve/src/gate.js'
import type { GateOutcome, PhaseFail, PhaseOk, PhaseResult } from '../../mutation-improve/src/gate.js'
import type { PipelineDeps } from '../../mutation-improve/src/pipeline.js'
import type { Result } from '../../mutation-improve/src/result-schema.js'
import type { MutationImproveRunState } from '../../mutation-improve/src/run-state.js'
import type { MeasuredScore } from '../../mutation-improve/src/score-reader.js'
import { cleanupTempDirs, makeTempDir } from './test-helpers.js'

afterEach(cleanupTempDirs)

const expectFail = (outcome: PhaseResult<GateOutcome>): PhaseFail => {
  if (outcome.ok) throw new Error('expected a gate failure, got ok')
  return outcome
}

const expectOk = (outcome: PhaseResult<GateOutcome>): PhaseOk<GateOutcome> => {
  if (!outcome.ok) throw new Error(`expected ok, got gate ${outcome.gate}: ${outcome.reason}`)
  return outcome
}

const baseResult: Result = {
  specPath: 'docs/superpowers/specs/x-design.md',
  planPath: 'docs/superpowers/plans/x.md',
  testPaths: ['tests/x.test.ts'],
  residuals: [],
  notes: '',
}

const withResiduals = (residuals: Result['residuals']): Result => ({ ...baseResult, residuals })

interface GateFake {
  deps: PipelineDeps
  calls: { builds: number; measures: number }
  iterPath: string
  worktreePath: string
}

const gateDeps = (
  overrides: { gitStatus?: string; buildPassed?: boolean; measured?: MeasuredScore } = {},
): GateFake => {
  const repoRoot = makeTempDir('gate-')
  const worktreePath = path.join(repoRoot, 'wt')
  const iterPath = path.join(repoRoot, 'iter', '1')
  // recordBuildFailure writes build-output.log into iterPath on any build failure
  mkdirSync(iterPath, { recursive: true })
  const calls = { builds: 0, measures: 0 }
  const config: MutationImproveConfig = {
    repoRoot,
    workDir: path.join(repoRoot, '.mutation-improve'),
    base: 'master',
    upstream: 'origin',
    count: 1,
    threshold: 0.95,
    epsilon: 0.02,
    mutateTimeoutMs: 1_800_000,
    buildTimeoutMs: 600_000,
    buildFixAttempts: 0,
    checkCommand: 'bun check:full',
    mutateFileCommand: 'bun test:mutate:file',
    agent: { model: 'm', extraArgs: [], timeoutMs: 1_800_000, inactivityTimeoutMs: 600_000 },
    prBranchPrefix: 'mutation-improve',
  }
  const runState: MutationImproveRunState = {
    runId: 'r1',
    repoRoot,
    workDir: config.workDir,
    runDir: path.join(config.workDir, 'runs', 'r1'),
    statePath: path.join(config.workDir, 'runs', 'r1', 'state.json'),
    base: 'master',
    threshold: 0.95,
    count: 1,
    currentIteration: 0,
    doneSet: [],
    merged: [],
    failed: [],
    status: 'running',
  }
  const deps: PipelineDeps = {
    config,
    runState,
    spawn: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
    createWorktree: () => Promise.resolve(),
    resetWorktree: () => Promise.resolve(),
    removeWorktree: () => Promise.resolve(),
    mergeWorktree: () => Promise.resolve({ ok: true }),
    execGit: () => Promise.resolve({ stdout: overrides.gitStatus ?? ' M tests/x.test.ts\n', stderr: '' }),
    runBuildCheck: () => {
      calls.builds += 1
      return Promise.resolve({ passed: overrides.buildPassed ?? true, stdout: '', stderr: '' })
    },
    measureScore: () => {
      calls.measures += 1
      return Promise.resolve(overrides.measured ?? { score: 0.97, survivingMutantIds: [] })
    },
    readBaseline: () => Promise.resolve({}),
    writeBaseline: () => Promise.resolve(),
    runSelectAgent: () => Promise.reject(new Error('unused in gate')),
    runImproveAgent: () =>
      Promise.resolve({
        value: baseResult,
        usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0, wallMs: 0 },
      }),
    cappedRegistry: { entries: [], record: () => Promise.resolve() },
    saveRunState: () => Promise.resolve(),
    log: { log: () => undefined, issue: undefined },
  }
  return { deps, calls, iterPath, worktreePath }
}

describe('gatePhase', () => {
  test('diff-scope violation short-circuits before the build check and the score run', async () => {
    const { deps, calls, iterPath, worktreePath } = gateDeps({ gitStatus: ' M src/foo.ts\n' })
    const outcome = await gatePhase(deps, iterPath, worktreePath, 'src/foo.ts', 0.4, baseResult)
    const fail = expectFail(outcome)
    expect(fail.gate).toBe('diff-scope')
    expect(fail.reason).toBe('forbidden paths changed: src/foo.ts')
    expect(calls.builds).toBe(0)
    expect(calls.measures).toBe(0)
  })

  test('build-gate failure short-circuits before the score run', async () => {
    const { deps, calls, iterPath, worktreePath } = gateDeps({ buildPassed: false })
    const outcome = await gatePhase(deps, iterPath, worktreePath, 'src/foo.ts', 0.4, baseResult)
    expect(expectFail(outcome).gate).toBe('build')
    expect(calls.measures).toBe(0)
  })

  test('caps when the score improved and declared mutant ids equal the surviving set', async () => {
    const { deps, iterPath, worktreePath } = gateDeps({
      measured: { score: 0.85, survivingMutantIds: ['s1', 's2'] },
    })
    const improved = withResiduals([{ loc: 'src/foo.ts:1', why: 'equivalent', mutantIds: ['s1', 's2'] }])
    const outcome = await gatePhase(deps, iterPath, worktreePath, 'src/foo.ts', 0.4, improved)
    expect(expectOk(outcome).value).toEqual({ afterScore: 0.85, result: improved, capped: true })
  })

  test('fails the score gate when declared ids are a strict subset of survivors', async () => {
    const { deps, iterPath, worktreePath } = gateDeps({
      measured: { score: 0.85, survivingMutantIds: ['s1', 's2'] },
    })
    const improved = withResiduals([{ loc: 'src/foo.ts:1', why: 'equivalent', mutantIds: ['s1'] }])
    const outcome = await gatePhase(deps, iterPath, worktreePath, 'src/foo.ts', 0.4, improved)
    expect(expectFail(outcome).gate).toBe('score')
  })

  test('does not cap when the score did not improve, even with full coverage', async () => {
    const { deps, iterPath, worktreePath } = gateDeps({
      measured: { score: 0.85, survivingMutantIds: ['s1'] },
    })
    const improved = withResiduals([{ loc: 'src/foo.ts:1', why: 'equivalent', mutantIds: ['s1'] }])
    const outcome = await gatePhase(deps, iterPath, worktreePath, 'src/foo.ts', 0.85, improved)
    expect(expectFail(outcome).gate).toBe('score')
  })

  test('at-threshold score passes uncapped even with full residual coverage', async () => {
    const { deps, iterPath, worktreePath } = gateDeps({
      measured: { score: 0.97, survivingMutantIds: ['s1'] },
    })
    const improved = withResiduals([{ loc: 'src/foo.ts:1', why: 'equivalent', mutantIds: ['s1'] }])
    const outcome = await gatePhase(deps, iterPath, worktreePath, 'src/foo.ts', 0.4, improved)
    expect(expectOk(outcome).value).toEqual({ afterScore: 0.97, result: improved, capped: false })
  })
})
