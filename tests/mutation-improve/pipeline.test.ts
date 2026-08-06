// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { MutationImproveConfig } from '../../mutation-improve/src/config.js'
import { runIteration, runPipeline, type PipelineDeps } from '../../mutation-improve/src/pipeline.js'
import type { Result } from '../../mutation-improve/src/result-schema.js'
import type { MutationImproveRunState } from '../../mutation-improve/src/run-state.js'
import type { Selection } from '../../mutation-improve/src/selection-schema.js'
import { agentWritePath, type AgentUsage } from '../../review-loop/src/agent-runner.js'
import { cleanupTempDirs, makeTempDir } from './test-helpers.js'

afterEach(cleanupTempDirs)

const emptyUsage = (): AgentUsage => ({ inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0, wallMs: 0 })

const config = (repoRoot: string, overrides: Partial<MutationImproveConfig> = {}): MutationImproveConfig => ({
  repoRoot,
  workDir: path.join(repoRoot, '.mutation-improve'),
  base: 'master',
  upstream: 'origin',
  count: 1,
  threshold: 0.95,
  epsilon: 0.02,
  agentTimeoutMs: 1_800_000,
  buildTimeoutMs: 600_000,
  checkCommand: 'bun check:full',
  mutateFileCommand: 'bun test:mutate:file',
  agent: { model: 'm', extraArgs: [], timeoutMs: 1_800_000 },
  prBranchPrefix: 'mutation-improve',
  ...overrides,
})

const runState = (repoRoot: string, overrides: Partial<MutationImproveRunState> = {}): MutationImproveRunState => ({
  runId: 'r1',
  repoRoot,
  workDir: path.join(repoRoot, '.mutation-improve'),
  runDir: path.join(repoRoot, '.mutation-improve', 'runs', 'r1'),
  statePath: path.join(repoRoot, '.mutation-improve', 'runs', 'r1', 'state.json'),
  base: 'master',
  threshold: 0.95,
  count: 1,
  currentIteration: 0,
  doneSet: [],
  merged: [],
  failed: [],
  status: 'running',
  ...overrides,
})

const selection: Selection = {
  file: 'src/live-status/tool-status-labels.ts',
  beforeScore: 0.46,
  rationale: 'pure',
  runnerUps: [],
}

const result: Result = {
  specPath: 'docs/superpowers/specs/x-design.md',
  planPath: 'docs/superpowers/plans/x.md',
  testPaths: ['tests/live-status/x.test.ts'],
  residuals: [],
  notes: '',
}

// Sequence-based measureScore fake: returns scores[0] on first call, scores[1] on
// second, etc. The impl calls measureScore twice per iteration (before/after), so
// a 2-element array covers one iteration; chaining uses a 4-element array. We
// clamp to the last element past the end (avoids `??` inside test bodies, which
// trips vitest/no-conditional-in-test).
const sequenceMeasure = (scores: readonly number[]): PipelineDeps['measureScore'] => {
  let calls = 0
  return (): Promise<number> => {
    calls += 1
    const idx = Math.min(calls - 1, scores.length - 1)
    return Promise.resolve(scores[idx] ?? 0)
  }
}

// Sequence-based runSelectAgent fake: returns picks[0] on first call, picks[1] on
// second, etc. Clamps past the end so we never produce `file: string | undefined`.
const sequenceSelect = (picks: readonly string[], selectionTemplate: Selection): PipelineDeps['runSelectAgent'] => {
  let calls = 0
  return (): Promise<{ value: Selection; usage: AgentUsage }> => {
    calls += 1
    const idx = Math.min(calls - 1, picks.length - 1)
    const file = picks[idx] ?? ''
    return Promise.resolve({
      value: { ...selectionTemplate, file, beforeScore: 0.5 },
      usage: emptyUsage(),
    })
  }
}

const happyDeps = (): PipelineDeps => {
  const repoRoot = makeTempDir('pipe-')
  let baseline: Record<string, number> = {
    'src/live-status/tool-status-labels.ts': 0.46,
    'src/tools/memory.ts': 0.5,
  }
  const deps: PipelineDeps = {
    config: config(repoRoot),
    runState: runState(repoRoot),
    spawn: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
    createWorktree: () => Promise.resolve(),
    resetWorktree: () => Promise.resolve(),
    removeWorktree: () => Promise.resolve(),
    mergeWorktree: () => Promise.resolve({ ok: true }),
    execGit: () => Promise.resolve({ stdout: ' M tests/live-status/x.test.ts\n', stderr: '' }),
    runBuildCheck: () => Promise.resolve({ passed: true, stdout: '', stderr: '' }),
    measureScore: sequenceMeasure([0.46, 0.97]),
    readBaseline: () => Promise.resolve(baseline),
    writeBaseline: (_root: string, map: Record<string, number>) => {
      baseline = map
      return Promise.resolve()
    },
    runSelectAgent: () => Promise.resolve({ value: selection, usage: emptyUsage() }),
    runImproveAgent: () => Promise.resolve({ value: result, usage: emptyUsage() }),
    saveRunState: () => Promise.resolve(),
    log: { log: () => undefined, issue: undefined },
  }
  return deps
}

describe('pipeline runIteration', () => {
  test('happy path: improved, merged, baseline ratcheted', async () => {
    const deps = happyDeps()
    const outcome = await runIteration(deps, 1)
    expect(outcome).toEqual({
      iter: 1,
      outcome: 'improved',
      file: 'src/live-status/tool-status-labels.ts',
      beforeScore: 0.46,
      afterScore: 0.97,
    })
    expect(deps.runState.merged).toHaveLength(1)
    expect(deps.runState.merged[0]?.afterScore).toBe(0.97)
    expect(deps.runState.doneSet).toContain('src/live-status/tool-status-labels.ts')
    // baseline bump is runner-owned
    const bumped = await deps.readBaseline(deps.config.repoRoot)
    expect(bumped['src/live-status/tool-status-labels.ts']).toBe(0.97)
  })

  // The runner reads agent output ONLY from agentWritePath(worktree, outputPath)
  // (<worktree>/.review-loop/<basename>); the prompt must direct the agent to
  // that exact scratch path or the iteration dies with an exception gate (the
  // 2026-08-05 run failed all 10 iterations this way).
  test('select prompt directs the agent to the worktree scratch path the runner reads', async () => {
    const deps = happyDeps()
    let selectPrompt = ''
    deps.runSelectAgent = (_worktreePath: string, prompt: string): Promise<{ value: Selection; usage: AgentUsage }> => {
      selectPrompt = prompt
      return Promise.resolve({ value: selection, usage: emptyUsage() })
    }
    await runIteration(deps, 1)
    const worktreePath = path.join(deps.config.workDir, 'worktrees', 'r1-iter1')
    const selectOut = path.join(deps.runState.runDir, 'iter', '1', 'selection.json')
    expect(selectPrompt).toContain(agentWritePath(worktreePath, selectOut))
  })

  test('improve prompt directs the agent to the worktree scratch path the runner reads', async () => {
    const deps = happyDeps()
    let improvePrompt = ''
    deps.runImproveAgent = (_worktreePath: string, prompt: string): Promise<{ value: Result; usage: AgentUsage }> => {
      improvePrompt = prompt
      return Promise.resolve({ value: result, usage: emptyUsage() })
    }
    await runIteration(deps, 1)
    const worktreePath = path.join(deps.config.workDir, 'worktrees', 'r1-iter1')
    const improveOut = path.join(deps.runState.runDir, 'iter', '1', 'result.json')
    expect(improvePrompt).toContain(agentWritePath(worktreePath, improveOut))
  })

  test('diff-scope violation fails the iteration without merging or ratcheting', async () => {
    const deps = happyDeps()
    deps.execGit = (): Promise<{ stdout: string; stderr: string }> =>
      Promise.resolve({ stdout: ' M src/foo.ts\n', stderr: '' })
    const outcome = await runIteration(deps, 1)
    expect(outcome.outcome).toBe('failed')
    expect(outcome.gate).toBe('diff-scope')
    expect(deps.runState.merged).toHaveLength(0)
    const baseline = await deps.readBaseline('/repo')
    // baseline is unchanged because ratchet runs only after a green verify
    expect(baseline['src/live-status/tool-status-labels.ts']).toBe(0.46)
  })

  test('score below threshold with no residuals fails the iteration', async () => {
    const deps = happyDeps()
    // before and after both 0.46 (< 0.95); no residuals → fail 'score'
    deps.measureScore = sequenceMeasure([0.46, 0.46])
    deps.runImproveAgent = (): Promise<{ value: Result; usage: AgentUsage }> =>
      Promise.resolve({ value: { ...result, residuals: [] }, usage: emptyUsage() })
    const outcome = await runIteration(deps, 1)
    expect(outcome.outcome).toBe('failed')
    expect(outcome.gate).toBe('score')
  })

  test('score below threshold WITH justified residuals passes', async () => {
    const deps = happyDeps()
    // before 0.46 (< 0.95), after 0.94 (within epsilon of 0.95) + residuals → pass
    deps.measureScore = sequenceMeasure([0.46, 0.94])
    deps.runImproveAgent = (): Promise<{ value: Result; usage: AgentUsage }> =>
      Promise.resolve({
        value: { ...result, residuals: [{ loc: 'L21', why: 'equivalent' }] },
        usage: emptyUsage(),
      })
    const outcome = await runIteration(deps, 1)
    expect(outcome.outcome).toBe('improved')
    expect(outcome.afterScore).toBe(0.94)
  })

  // I2: pins the AND of the residual escape. The existing "no residuals → fail"
  // test uses afterScore=0.46 (also below threshold − ε), so deleting the
  // `residuals.length > 0 &&` would still leave that test green. This case puts
  // afterScore INSIDE epsilon with NO residuals: a correct impl fails (no
  // residuals → not justified); a mutant deleting `&&` would wrongly pass it.
  test('score within epsilon with NO residuals fails (pins residual-escape AND)', async () => {
    const deps = happyDeps()
    // before 0.46 (< 0.95), after 0.94 (within epsilon of 0.95), residuals
    // empty → must fail 'score'. 0.94 >= 0.95 − 0.02, so the AND is the only
    // thing standing between this iteration and an unjustified pass.
    deps.measureScore = sequenceMeasure([0.46, 0.94])
    deps.runImproveAgent = (): Promise<{ value: Result; usage: AgentUsage }> =>
      Promise.resolve({ value: { ...result, residuals: [] }, usage: emptyUsage() })
    const outcome = await runIteration(deps, 1)
    expect(outcome.outcome).toBe('failed')
    expect(outcome.gate).toBe('score')
  })

  test('merge conflict produces a failed merge-gate outcome', async () => {
    const deps = happyDeps()
    deps.mergeWorktree = (): Promise<{ ok: false; conflictFiles: string[] }> =>
      Promise.resolve({ ok: false, conflictFiles: ['scripts/mutation/baseline.json'] })
    const outcome = await runIteration(deps, 1)
    expect(outcome.outcome).toBe('failed')
    expect(outcome.gate).toBe('merge')
  })

  // C2: an unexpected throw mid-pipeline must route through failIter so the
  // worktree is reset/removed and the failure is recorded — not leaked.
  test('thrown exception after worktree creation resets/removes worktree and records exception gate', async () => {
    const deps = happyDeps()
    const calls = { reset: 0, remove: 0 }
    deps.runImproveAgent = (): Promise<{ value: Result; usage: AgentUsage }> =>
      Promise.reject(new Error('agent blew up'))
    deps.resetWorktree = (): Promise<void> => {
      calls.reset += 1
      return Promise.resolve()
    }
    deps.removeWorktree = (): Promise<void> => {
      calls.remove += 1
      return Promise.resolve()
    }
    const outcome = await runIteration(deps, 1)
    expect(outcome.outcome).toBe('failed')
    expect(outcome.gate).toBe('exception')
    expect(outcome.reason).toBe('agent blew up')
    expect(calls.reset).toBe(1)
    expect(calls.remove).toBe(1)
    expect(deps.runState.failed).toEqual([
      { iter: 1, gate: 'exception', reason: 'agent blew up', file: 'src/live-status/tool-status-labels.ts' },
    ])
    const failure = JSON.parse(
      await readFile(path.join(deps.runState.runDir, 'iter', '1', 'failure.json'), 'utf8'),
    ) as unknown
    expect(failure).toEqual({
      iter: 1,
      gate: 'exception',
      reason: 'agent blew up',
      file: 'src/live-status/tool-status-labels.ts',
    })
    expect(deps.runState.merged).toHaveLength(0)
  })

  // C2: if createWorktree itself throws, the catch must not attempt to
  // reset/remove a worktree that was never created (resetWorktree would throw
  // on a missing path); it still records the failure.
  test('createWorktree throwing records exception gate without touching reset/remove', async () => {
    const deps = happyDeps()
    const calls = { reset: 0, remove: 0 }
    deps.createWorktree = (): Promise<void> => Promise.reject(new Error('worktree add failed'))
    deps.resetWorktree = (): Promise<void> => {
      calls.reset += 1
      return Promise.resolve()
    }
    deps.removeWorktree = (): Promise<void> => {
      calls.remove += 1
      return Promise.resolve()
    }
    const outcome = await runIteration(deps, 1)
    expect(outcome.outcome).toBe('failed')
    expect(outcome.gate).toBe('exception')
    expect(outcome.reason).toBe('worktree add failed')
    expect(calls.reset).toBe(0)
    expect(calls.remove).toBe(0)
    expect(deps.runState.failed).toEqual([{ iter: 1, gate: 'exception', reason: 'worktree add failed' }])
  })

  test('build gate runs checkCommand inside the iteration worktree', async () => {
    const deps = happyDeps()
    let buildCwd = ''
    deps.runBuildCheck = (worktreePath: string): Promise<{ passed: boolean; stdout: string; stderr: string }> => {
      buildCwd = worktreePath
      return Promise.resolve({ passed: true, stdout: '', stderr: '' })
    }
    await runIteration(deps, 1)
    expect(buildCwd).toBe(path.join(deps.config.workDir, 'worktrees', 'r1-iter1'))
  })

  test('select agent receives the per-iteration outputPath', async () => {
    const deps = happyDeps()
    let seenOut = ''
    deps.runSelectAgent = (
      _worktreePath: string,
      _prompt: string,
      outputPath: string,
    ): Promise<{ value: Selection; usage: AgentUsage }> => {
      seenOut = outputPath
      return Promise.resolve({ value: selection, usage: emptyUsage() })
    }
    await runIteration(deps, 1)
    expect(seenOut).toBe(path.join(deps.runState.runDir, 'iter', '1', 'selection.json'))
  })

  test('improve agent receives the per-iteration outputPath', async () => {
    const deps = happyDeps()
    let seenOut = ''
    deps.runImproveAgent = (
      _worktreePath: string,
      _prompt: string,
      outputPath: string,
    ): Promise<{ value: Result; usage: AgentUsage }> => {
      seenOut = outputPath
      return Promise.resolve({ value: result, usage: emptyUsage() })
    }
    await runIteration(deps, 1)
    expect(seenOut).toBe(path.join(deps.runState.runDir, 'iter', '1', 'result.json'))
  })

  test('select-gate rejection records the invalidly picked file and writes failure.json', async () => {
    const deps = happyDeps()
    deps.runSelectAgent = (): Promise<{ value: Selection; usage: AgentUsage }> =>
      Promise.resolve({ value: { ...selection, file: 'src/not-in-baseline.ts' }, usage: emptyUsage() })
    const outcome = await runIteration(deps, 1)
    expect(outcome.outcome).toBe('failed')
    expect(outcome.gate).toBe('select')
    expect(deps.runState.failed[0]).toEqual({
      iter: 1,
      gate: 'select',
      reason: 'selection file not in baseline or already done',
      file: 'src/not-in-baseline.ts',
    })
    const failure = JSON.parse(
      await readFile(path.join(deps.runState.runDir, 'iter', '1', 'failure.json'), 'utf8'),
    ) as unknown
    expect(failure).toEqual({
      iter: 1,
      gate: 'select',
      reason: 'selection file not in baseline or already done',
      file: 'src/not-in-baseline.ts',
    })
  })

  test('createWorktree throw still writes failure.json without a file', async () => {
    const deps = happyDeps()
    deps.createWorktree = (): Promise<void> => Promise.reject(new Error('worktree add failed'))
    const outcome = await runIteration(deps, 1)
    expect(outcome.outcome).toBe('failed')
    const failure = JSON.parse(
      await readFile(path.join(deps.runState.runDir, 'iter', '1', 'failure.json'), 'utf8'),
    ) as unknown
    expect(failure).toEqual({ iter: 1, gate: 'exception', reason: 'worktree add failed' })
  })
})

describe('pipeline runPipeline', () => {
  test('count chains: iteration 2 sees iteration 1 baseline bump; merge conflict aborts', async () => {
    const deps = happyDeps()
    deps.config = config(deps.config.repoRoot, { count: 2 })
    // impl call order is interleaved: iter1.before, iter1.after, iter2.before, iter2.after
    deps.measureScore = sequenceMeasure([0.46, 0.97, 0.5, 0.96])
    const picks = ['src/live-status/tool-status-labels.ts', 'src/tools/memory.ts']
    deps.runSelectAgent = sequenceSelect(picks, selection)
    const { results, aborted } = await runPipeline(deps)
    expect(aborted).toBe(false)
    expect(results).toHaveLength(2)
    expect(results[0]?.outcome).toBe('improved')
    expect(results[1]?.outcome).toBe('improved')
    expect(deps.runState.doneSet).toEqual(picks)
  })

  test('merge conflict in iteration 1 aborts the pipeline and skips iteration 2', async () => {
    const deps = happyDeps()
    deps.config = config(deps.config.repoRoot, { count: 2 })
    deps.mergeWorktree = (): Promise<{ ok: false; conflictFiles: string[] }> =>
      Promise.resolve({ ok: false, conflictFiles: ['scripts/mutation/baseline.json'] })
    const { results, aborted } = await runPipeline(deps)
    // merge-gate fail aborts: stops chaining, status 'aborted', iter 2 never runs
    expect(aborted).toBe(true)
    expect(results).toHaveLength(1)
    expect(results[0]?.outcome).toBe('failed')
    expect(results[0]?.gate).toBe('merge')
    expect(deps.runState.status).toBe('aborted')
    expect(deps.runState.currentIteration).toBe(1)
  })

  test('saves run state after each iteration', async () => {
    const deps = happyDeps()
    deps.config = config(deps.config.repoRoot, { count: 2 })
    deps.measureScore = sequenceMeasure([0.46, 0.97, 0.5, 0.96])
    const picks = ['src/live-status/tool-status-labels.ts', 'src/tools/memory.ts']
    deps.runSelectAgent = sequenceSelect(picks, selection)
    const savedIterations: number[] = []
    deps.saveRunState = (state: MutationImproveRunState): Promise<void> => {
      savedIterations.push(state.currentIteration)
      return Promise.resolve()
    }
    await runPipeline(deps)
    expect(savedIterations).toEqual([1, 2])
  })

  test('merge-abort saves state with status aborted', async () => {
    const deps = happyDeps()
    deps.mergeWorktree = (): Promise<{ ok: false; conflictFiles: string[] }> =>
      Promise.resolve({ ok: false, conflictFiles: ['scripts/mutation/baseline.json'] })
    const savedStatuses: string[] = []
    deps.saveRunState = (state: MutationImproveRunState): Promise<void> => {
      savedStatuses.push(state.status)
      return Promise.resolve()
    }
    const { aborted } = await runPipeline(deps)
    expect(aborted).toBe(true)
    expect(savedStatuses).toEqual(['aborted'])
  })
})
