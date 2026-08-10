// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { BaselineMap } from '../../mutation-improve/src/baseline.js'
import type { CappedEntry } from '../../mutation-improve/src/capped-registry.js'
import type { MutationImproveConfig } from '../../mutation-improve/src/config.js'
import { runIteration, runPipeline, type PipelineDeps } from '../../mutation-improve/src/pipeline.js'
import type { Result } from '../../mutation-improve/src/result-schema.js'
import type { MutationImproveRunState } from '../../mutation-improve/src/run-state.js'
import type { MeasuredScore } from '../../mutation-improve/src/score-reader.js'
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
  mutateTimeoutMs: 1_800_000,
  buildTimeoutMs: 600_000,
  buildFixAttempts: 2,
  checkCommand: 'bun check:full',
  mutateFileCommand: 'bun test:mutate:file',
  agent: { model: 'm', extraArgs: [], timeoutMs: 1_800_000, inactivityTimeoutMs: 600_000 },
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
// trips vitest/no-conditional-in-test). Plain numbers map to empty surviving ids.
const measured = (score: number, survivingMutantIds: readonly string[] = []): MeasuredScore => ({
  score,
  survivingMutantIds,
})

const sequenceMeasureDetailed = (steps: readonly MeasuredScore[]): PipelineDeps['measureScore'] => {
  let calls = 0
  return (): Promise<MeasuredScore> => {
    calls += 1
    const idx = Math.min(calls - 1, steps.length - 1)
    return Promise.resolve(steps[idx] ?? measured(0))
  }
}

const sequenceMeasure = (scores: readonly number[]): PipelineDeps['measureScore'] =>
  sequenceMeasureDetailed(scores.map((score) => measured(score)))

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

// Sequence-based runBuildCheck fake: returns outcomes[0] on first call, etc.,
// clamping to the last element past the end (same pattern as sequenceMeasure).
const sequenceBuild = (
  outcomes: readonly { passed: boolean; stdout: string; stderr: string }[],
): PipelineDeps['runBuildCheck'] => {
  let calls = 0
  return (): Promise<{ passed: boolean; stdout: string; stderr: string }> => {
    calls += 1
    const idx = Math.min(calls - 1, outcomes.length - 1)
    return Promise.resolve(outcomes[idx] ?? { passed: true, stdout: '', stderr: '' })
  }
}

// Sequence-based execGit fake returning porcelain-status stdout per call.
const sequenceGitStatus = (statuses: readonly string[]): PipelineDeps['execGit'] => {
  let calls = 0
  return (): Promise<{ stdout: string; stderr: string }> => {
    calls += 1
    const idx = Math.min(calls - 1, statuses.length - 1)
    return Promise.resolve({ stdout: statuses[idx] ?? '', stderr: '' })
  }
}

// Subcommand-keyed execGit fake: returns canned stdout for args[0] (e.g.
// 'rev-parse'/'diff'), empty otherwise. Keeps conditionals out of test bodies
// (no-conditional-in-test) and yields zeros for unscripted subcommands.
const scriptedExecGit =
  (responses: Record<string, string>): PipelineDeps['execGit'] =>
  (_cwd: string, args: readonly string[]): Promise<{ stdout: string; stderr: string }> =>
    Promise.resolve({ stdout: responses[args[0] ?? ''] ?? '', stderr: '' })

// Sequence-based runImproveAgent fake: records each prompt into `prompts` and
// returns results[0] on first call, etc., clamping to the last element.
const sequenceImprove = (
  results: readonly Result[],
  prompts: string[],
  fallback: Result,
): PipelineDeps['runImproveAgent'] => {
  return (_worktreePath: string, prompt: string): Promise<{ value: Result; usage: AgentUsage }> => {
    prompts.push(prompt)
    const idx = Math.min(prompts.length - 1, results.length - 1)
    return Promise.resolve({ value: results[idx] ?? fallback, usage: emptyUsage() })
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
    cappedRegistry: { entries: [], record: () => Promise.resolve() },
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
        value: { ...result, residuals: [{ loc: 'L21', why: 'equivalent', mutantIds: [] }] },
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

  test('finalize measures merge diff and reports it via log.diff', async () => {
    const deps = happyDeps()
    const diffs: Array<{ label: string; added: number; removed: number }> = []
    deps.log = {
      log: (): void => undefined,
      diff: (label: string, d: { added: number; removed: number }): void => {
        diffs.push({ label, ...d })
      },
    }
    deps.execGit = scriptedExecGit({
      'rev-parse': 'abc123\n',
      diff: '301\t12\ttests/x.test.ts\n',
    })
    const outcome = await runIteration(deps, 1)
    expect(outcome.outcome).toBe('improved')
    expect(diffs).toEqual([{ label: 'iter-1', added: 301, removed: 12 }])
  })

  test('merge conflict reports no diff', async () => {
    const deps = happyDeps()
    const diffs: unknown[] = []
    deps.log = {
      log: (): void => undefined,
      diff: (): void => {
        diffs.push(1)
      },
    }
    deps.mergeWorktree = (): Promise<{ ok: false; conflictFiles: string[] }> =>
      Promise.resolve({ ok: false, conflictFiles: ['scripts/mutation/baseline.json'] })
    const outcome = await runIteration(deps, 1)
    expect(outcome.gate).toBe('merge')
    expect(diffs).toEqual([])
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

  // bun always prints `error: script ... exited with code 1` to stderr when the
  // check command fails, so a `stderr || stdout` reason never shows check.sh's
  // stdout breakdown naming the failing check. Both streams must survive.
  test('build gate failure reason includes stdout details even when stderr is non-empty', async () => {
    const deps = happyDeps()
    deps.runBuildCheck = (): Promise<{ passed: boolean; stdout: string; stderr: string }> =>
      Promise.resolve({
        passed: false,
        stdout: '✗ test failed (exit code 1):\n---\n(fail) WorkerPool > closes cleanly\n---',
        stderr: 'error: script "check:full" exited with code 1\n',
      })
    const outcome = await runIteration(deps, 1)
    expect(outcome.outcome).toBe('failed')
    expect(outcome.gate).toBe('build')
    expect(outcome.reason).toContain('error: script "check:full" exited with code 1')
    expect(outcome.reason).toContain('(fail) WorkerPool > closes cleanly')
  })

  test('build gate failure persists the full combined output to build-output.log and tail-bounds the reason', async () => {
    const deps = happyDeps()
    const marker = 'UNIQUE-BUILD-FAILURE-MARKER'
    deps.runBuildCheck = (): Promise<{ passed: boolean; stdout: string; stderr: string }> =>
      Promise.resolve({
        passed: false,
        stdout: `${'x'.repeat(6000)}\n${marker}\n`,
        stderr: 'error: script "check:full" exited with code 1\n',
      })
    const outcome = await runIteration(deps, 1)
    expect(outcome.outcome).toBe('failed')
    expect(outcome.gate).toBe('build')
    expect(outcome.reason).toContain(marker)
    expect(outcome.reason?.length).toBeLessThan(4500)
    const log = await readFile(path.join(deps.runState.runDir, 'iter', '1', 'build-output.log'), 'utf8')
    expect(log).toContain('error: script "check:full" exited with code 1')
    expect(log).toContain(marker)
    expect(log.length).toBeGreaterThan(6000)
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

  test('skip ratchets a stale baseline floor with a baseline-only commit in repoRoot', async () => {
    const deps = happyDeps()
    deps.measureScore = sequenceMeasure([0.97])
    const gitCalls: string[] = []
    deps.execGit = (cwd: string, args: readonly string[]): Promise<{ stdout: string; stderr: string }> => {
      gitCalls.push(`${cwd} ${args.join(' ')}`)
      return Promise.resolve({ stdout: '', stderr: '' })
    }
    const outcome = await runIteration(deps, 1)
    expect(outcome).toEqual({
      iter: 1,
      outcome: 'skipped',
      file: 'src/live-status/tool-status-labels.ts',
      beforeScore: 0.97,
    })
    const baseline = await deps.readBaseline(deps.config.repoRoot)
    expect(baseline['src/live-status/tool-status-labels.ts']).toBe(0.97)
    const repoRoot = deps.config.repoRoot
    expect(gitCalls).toContain(`${repoRoot} add scripts/mutation/baseline.json`)
    const commitPrefix = `${repoRoot} commit -m chore(mutation): ratchet src/live-status/tool-status-labels.ts baseline to 0.97`
    expect(gitCalls.some((c) => c.startsWith(commitPrefix))).toBe(true)
  })

  test('skip with an accurate floor does not rewrite or commit the baseline', async () => {
    const deps = happyDeps()
    deps.readBaseline = (): Promise<BaselineMap> => Promise.resolve({ 'src/live-status/tool-status-labels.ts': 0.97 })
    let writes = 0
    deps.writeBaseline = (): Promise<void> => {
      writes += 1
      return Promise.resolve()
    }
    const gitCalls: string[] = []
    deps.execGit = (_cwd: string, args: readonly string[]): Promise<{ stdout: string; stderr: string }> => {
      gitCalls.push(args.join(' '))
      return Promise.resolve({ stdout: '', stderr: '' })
    }
    deps.measureScore = sequenceMeasure([0.96])
    const outcome = await runIteration(deps, 1)
    expect(outcome.outcome).toBe('skipped')
    expect(writes).toBe(0)
    expect(gitCalls.some((c) => c.startsWith('commit'))).toBe(false)
  })
})

describe('pipeline capped gate', () => {
  // The 2026-08-06 mappers.ts pattern: a file whose tests-only ceiling sits
  // below threshold − ε was attempted 3x in one run, each attempt merged
  // nothing and forced exit 1. With full residual coverage the runner now
  // merges at the measured ceiling ('capped') instead of discarding the work.
  const cappedDeps = (
    after: MeasuredScore,
    residuals: Result['residuals'],
  ): { deps: PipelineDeps; recorded: [string, number][] } => {
    const deps = happyDeps()
    deps.measureScore = sequenceMeasureDetailed([measured(0.46), after])
    deps.runImproveAgent = (): Promise<{ value: Result; usage: AgentUsage }> =>
      Promise.resolve({ value: { ...result, residuals }, usage: emptyUsage() })
    const recorded: [string, number][] = []
    deps.cappedRegistry = {
      entries: [],
      record: (file: string, score: number): Promise<void> => {
        recorded.push([file, score])
        return Promise.resolve()
      },
    }
    return { deps, recorded }
  }

  test('below-hatch score with full residual coverage merges as capped and records the cap', async () => {
    const { deps, recorded } = cappedDeps(measured(0.85, ['s1', 's2']), [
      { loc: 'src/x.ts:24', why: 'equivalent guard', mutantIds: ['s1', 's2'] },
    ])
    const outcome = await runIteration(deps, 1)
    expect(outcome).toEqual({
      iter: 1,
      outcome: 'capped',
      file: 'src/live-status/tool-status-labels.ts',
      beforeScore: 0.46,
      afterScore: 0.85,
    })
    expect(deps.runState.merged[0]?.capped).toBe(true)
    expect(deps.runState.doneSet).toContain('src/live-status/tool-status-labels.ts')
    expect(deps.runState.failed).toHaveLength(0)
    const bumped = await deps.readBaseline(deps.config.repoRoot)
    expect(bumped['src/live-status/tool-status-labels.ts']).toBe(0.85)
    expect(recorded).toEqual([['src/live-status/tool-status-labels.ts', 0.85]])
  })

  // The real mappers.ts result.json grouped 9 mutants into 3 per-loc entries;
  // the union across entries is what must equal the surviving set.
  test('grouped residual entries cap when their union equals the surviving set', async () => {
    const { deps } = cappedDeps(measured(0.857, ['2', '3', '4', '6', '16', '17', '18', '20', '37']), [
      { loc: 'mappers.ts:24', why: 'equivalent null guard', mutantIds: ['2', '3', '4', '6'] },
      { loc: 'mappers.ts:31', why: 'equivalent null guard', mutantIds: ['16', '17', '18', '20'] },
      { loc: 'mappers.ts:92', why: 'unreachable fallback', mutantIds: ['37'] },
    ])
    const outcome = await runIteration(deps, 1)
    expect(outcome.outcome).toBe('capped')
  })

  test('epsilon-hatch pass stays improved and does NOT record a cap', async () => {
    const { deps, recorded } = cappedDeps(measured(0.94), [{ loc: 'L21', why: 'equivalent', mutantIds: ['s1'] }])
    const outcome = await runIteration(deps, 1)
    expect(outcome.outcome).toBe('improved')
    expect(deps.runState.merged[0]?.capped).toBeUndefined()
    expect(recorded).toEqual([])
  })

  test('partial residual coverage fails the score gate (not capped)', async () => {
    const { deps, recorded } = cappedDeps(measured(0.85, ['s1', 's2']), [
      { loc: 'src/x.ts:24', why: 'equivalent guard', mutantIds: ['s1'] },
    ])
    const outcome = await runIteration(deps, 1)
    expect(outcome.outcome).toBe('failed')
    expect(outcome.gate).toBe('score')
    expect(deps.runState.merged).toHaveLength(0)
    expect(recorded).toEqual([])
  })

  // Set equality, not subset: a declared id that is not an actual survivor
  // means the agent's bookkeeping is wrong (or padded) — fail closed.
  test('declared ids naming a non-survivor fail the score gate', async () => {
    const { deps } = cappedDeps(measured(0.85, ['s1']), [
      { loc: 'src/x.ts:24', why: 'equivalent guard', mutantIds: ['s1', 's999'] },
    ])
    const outcome = await runIteration(deps, 1)
    expect(outcome.outcome).toBe('failed')
    expect(outcome.gate).toBe('score')
  })

  // Without the improvement guard an agent could declare residuals over every
  // survivor of a no-op run and "merge" spec docs that changed nothing.
  test('full coverage without a score improvement fails the score gate', async () => {
    const deps = happyDeps()
    deps.measureScore = sequenceMeasureDetailed([measured(0.85, ['s1']), measured(0.85, ['s1'])])
    deps.runImproveAgent = (): Promise<{ value: Result; usage: AgentUsage }> =>
      Promise.resolve({
        value: { ...result, residuals: [{ loc: 'src/x.ts:24', why: 'equivalent', mutantIds: ['s1'] }] },
        usage: emptyUsage(),
      })
    const outcome = await runIteration(deps, 1)
    expect(outcome.outcome).toBe('failed')
    expect(outcome.gate).toBe('score')
  })
})

describe('pipeline select exclusions', () => {
  const cappedEntry = (file: string): CappedEntry => ({
    file,
    score: 0.85,
    cappedAt: '2026-08-06T00:00:00.000Z',
    runId: 'r0',
  })

  test('select prompt lists this run’s failed files and the capped registry as do-not-pick', async () => {
    const deps = happyDeps()
    deps.runState.failed = [{ iter: 1, gate: 'score', reason: 'x', file: 'src/tools/memory.ts' }]
    deps.cappedRegistry = { entries: [cappedEntry('src/capped.ts')], record: (): Promise<void> => Promise.resolve() }
    let selectPrompt = ''
    deps.runSelectAgent = (_worktreePath: string, prompt: string): Promise<{ value: Selection; usage: AgentUsage }> => {
      selectPrompt = prompt
      return Promise.resolve({ value: selection, usage: emptyUsage() })
    }
    await runIteration(deps, 1)
    expect(selectPrompt).toContain('src/tools/memory.ts')
    expect(selectPrompt).toContain('src/capped.ts')
  })

  test('picking a file that already failed this run is rejected at the select gate', async () => {
    const deps = happyDeps()
    deps.runState.failed = [{ iter: 1, gate: 'score', reason: 'x', file: 'src/tools/memory.ts' }]
    deps.runSelectAgent = (): Promise<{ value: Selection; usage: AgentUsage }> =>
      Promise.resolve({ value: { ...selection, file: 'src/tools/memory.ts' }, usage: emptyUsage() })
    const outcome = await runIteration(deps, 1)
    expect(outcome.outcome).toBe('failed')
    expect(outcome.gate).toBe('select')
    expect(outcome.reason).toContain('already failed this run')
  })

  test('picking a capped-registry file is rejected at the select gate', async () => {
    const deps = happyDeps()
    deps.cappedRegistry = {
      entries: [cappedEntry('src/tools/memory.ts')],
      record: (): Promise<void> => Promise.resolve(),
    }
    deps.runSelectAgent = (): Promise<{ value: Selection; usage: AgentUsage }> =>
      Promise.resolve({ value: { ...selection, file: 'src/tools/memory.ts' }, usage: emptyUsage() })
    const outcome = await runIteration(deps, 1)
    expect(outcome.outcome).toBe('failed')
    expect(outcome.gate).toBe('select')
    expect(outcome.reason).toContain('capped')
  })
})

describe('pipeline build-fix retry', () => {
  // A failed check:full (e.g. oxfmt on an agent-authored test file) used to burn
  // the whole iteration. The runner now feeds the failed check output back to
  // the agent and re-gates, up to config.buildFixAttempts times.
  test('build failure feeds the check output back to the agent and passes on retry', async () => {
    const deps = happyDeps()
    const marker = '✗ format:check failed (exit code 1)'
    let builds = 0
    const check = sequenceBuild([
      {
        passed: false,
        stdout: `${marker}\ntests/x.test.ts\n`,
        stderr: 'error: script "check:full" exited with code 1\n',
      },
      { passed: true, stdout: '', stderr: '' },
    ])
    deps.runBuildCheck = (worktreePath: string): Promise<{ passed: boolean; stdout: string; stderr: string }> => {
      builds += 1
      return check(worktreePath)
    }
    const prompts: string[] = []
    const fixedResult: Result = { ...result, specPath: 'docs/superpowers/specs/fixed-design.md' }
    deps.runImproveAgent = sequenceImprove([result, fixedResult], prompts, result)
    const outcome = await runIteration(deps, 1)
    expect(outcome.outcome).toBe('improved')
    expect(builds).toBe(2)
    expect(prompts).toHaveLength(2)
    expect(prompts[1]).toContain(marker)
    expect(prompts[1]).toContain('MUST NOT edit anything under src/')
    const worktreePath = path.join(deps.config.workDir, 'worktrees', 'r1-iter1')
    const improveOut = path.join(deps.runState.runDir, 'iter', '1', 'result.json')
    expect(prompts[1]).toContain(agentWritePath(worktreePath, improveOut))
    // the fix agent's rewritten result replaces the original for finalize
    expect(deps.runState.merged[0]?.specPath).toBe('docs/superpowers/specs/fixed-design.md')
  })

  test('exhausts buildFixAttempts then fails the build gate', async () => {
    const deps = happyDeps()
    let builds = 0
    deps.runBuildCheck = (): Promise<{ passed: boolean; stdout: string; stderr: string }> => {
      builds += 1
      return Promise.resolve({
        passed: false,
        stdout: '✗ test failed\n',
        stderr: 'error: script "check:full" exited with code 1\n',
      })
    }
    let improveCalls = 0
    deps.runImproveAgent = (): Promise<{ value: Result; usage: AgentUsage }> => {
      improveCalls += 1
      return Promise.resolve({ value: result, usage: emptyUsage() })
    }
    const outcome = await runIteration(deps, 1)
    expect(outcome.outcome).toBe('failed')
    expect(outcome.gate).toBe('build')
    expect(outcome.reason).toContain('✗ test failed')
    // 1 initial build + 2 re-gates after fix attempts
    expect(builds).toBe(3)
    // 1 improve + 2 fix invocations
    expect(improveCalls).toBe(3)
  })

  test('buildFixAttempts 0 fails immediately without a fix attempt', async () => {
    const deps = happyDeps()
    deps.config = config(deps.config.repoRoot, { buildFixAttempts: 0 })
    let builds = 0
    deps.runBuildCheck = (): Promise<{ passed: boolean; stdout: string; stderr: string }> => {
      builds += 1
      return Promise.resolve({ passed: false, stdout: '✗ lint failed\n', stderr: '' })
    }
    let improveCalls = 0
    deps.runImproveAgent = (): Promise<{ value: Result; usage: AgentUsage }> => {
      improveCalls += 1
      return Promise.resolve({ value: result, usage: emptyUsage() })
    }
    const outcome = await runIteration(deps, 1)
    expect(outcome.outcome).toBe('failed')
    expect(outcome.gate).toBe('build')
    expect(builds).toBe(1)
    expect(improveCalls).toBe(1)
  })

  test('diff-scope violation introduced during a fix attempt fails without further build retries', async () => {
    const deps = happyDeps()
    let builds = 0
    const check = sequenceBuild([{ passed: false, stdout: '✗ format:check failed\n', stderr: '' }])
    deps.runBuildCheck = (worktreePath: string): Promise<{ passed: boolean; stdout: string; stderr: string }> => {
      builds += 1
      return check(worktreePath)
    }
    deps.execGit = sequenceGitStatus([' M tests/live-status/x.test.ts\n', ' M src/foo.ts\n'])
    const outcome = await runIteration(deps, 1)
    expect(outcome.outcome).toBe('failed')
    expect(outcome.gate).toBe('diff-scope')
    expect(builds).toBe(1)
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

  test('capped iteration completes the run without aborting or recording a failure', async () => {
    const deps = happyDeps()
    deps.measureScore = sequenceMeasureDetailed([measured(0.46), measured(0.85, ['s1'])])
    deps.runImproveAgent = (): Promise<{ value: Result; usage: AgentUsage }> =>
      Promise.resolve({
        value: { ...result, residuals: [{ loc: 'src/x.ts:24', why: 'equivalent', mutantIds: ['s1'] }] },
        usage: emptyUsage(),
      })
    const { results, aborted } = await runPipeline(deps)
    expect(aborted).toBe(false)
    expect(results).toHaveLength(1)
    expect(results[0]?.outcome).toBe('capped')
    expect(deps.runState.status).toBe('completed')
    expect(deps.runState.failed).toHaveLength(0)
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

describe('pipeline iteration commit line', () => {
  const commitLog = (): { log: PipelineDeps['log']; commits: Array<readonly [string, string | undefined]> } => {
    const commits: Array<readonly [string, string | undefined]> = []
    return {
      commits,
      log: {
        log: () => undefined,
        commit: (key: string, line?: string) => {
          commits.push([key, line] as const)
        },
      },
    }
  }

  test('commits an improved summary line after a merged iteration', async () => {
    const deps = happyDeps()
    const { log, commits } = commitLog()
    deps.log = log
    await runPipeline(deps)
    expect(commits).toHaveLength(1)
    expect(commits[0]![0]).toBe('iter')
    expect(commits[0]![1]).toContain('iter 1 ✓ improved')
    expect(commits[0]![1]).toContain('src/live-status/tool-status-labels.ts')
    expect(commits[0]![1]).toContain('46.0%→97.0%')
  })

  test('commits a failed summary line when the score gate fails', async () => {
    const deps = happyDeps()
    deps.measureScore = sequenceMeasure([0.46, 0.46])
    deps.runImproveAgent = (): Promise<{ value: Result; usage: AgentUsage }> =>
      Promise.resolve({ value: { ...result, residuals: [] }, usage: emptyUsage() })
    const { log, commits } = commitLog()
    deps.log = log
    await runPipeline(deps)
    expect(commits).toHaveLength(1)
    expect(commits[0]![1]).toContain('iter 1 ✗ failed')
    expect(commits[0]![1]).toContain('score:')
  })

  test('commits a skipped summary line when the file is already at threshold', async () => {
    const deps = happyDeps()
    deps.measureScore = sequenceMeasure([0.97])
    const { log, commits } = commitLog()
    deps.log = log
    await runPipeline(deps)
    expect(commits).toHaveLength(1)
    expect(commits[0]![1]).toContain('iter 1 – skipped')
    expect(commits[0]![1]).toContain('97.0% ≥ threshold')
  })

  test('a merge-abort still commits the failed line for its iteration', async () => {
    const deps = happyDeps()
    deps.mergeWorktree = (): Promise<{ ok: false; conflictFiles: string[] }> =>
      Promise.resolve({ ok: false, conflictFiles: ['scripts/mutation/baseline.json'] })
    const { log, commits } = commitLog()
    deps.log = log
    const { aborted } = await runPipeline(deps)
    expect(aborted).toBe(true)
    expect(commits).toHaveLength(1)
    expect(commits[0]![1]).toContain('✗ failed')
    expect(commits[0]![1]).toContain('merge:')
  })

  test('a log without commit runs the pipeline unchanged', async () => {
    const deps = happyDeps()
    const { results, aborted } = await runPipeline(deps)
    expect(aborted).toBe(false)
    expect(results[0]?.outcome).toBe('improved')
  })
})
