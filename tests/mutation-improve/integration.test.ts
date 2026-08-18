// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import path from 'node:path'

import type { BaselineMap } from '../../mutation-improve/src/baseline.js'
import type { MutationImproveConfig } from '../../mutation-improve/src/config.js'
import { runFinalize } from '../../mutation-improve/src/finalize.js'
import { runPipeline, type PipelineDeps } from '../../mutation-improve/src/pipeline.js'
import type { Result } from '../../mutation-improve/src/result-schema.js'
import { createRunState } from '../../mutation-improve/src/run-state.js'
import type { MeasuredScore } from '../../mutation-improve/src/score-reader.js'
import type { Selection } from '../../mutation-improve/src/selection-schema.js'
import type { AgentUsage } from '../../review-loop/src/agent-runner.js'
import { cleanupTempDirs, makeTempDir } from './test-helpers.js'

afterEach(cleanupTempDirs)

const emptyUsage = (): AgentUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cachedReadTokens: 0,
  cachedWriteTokens: 0,
  costUsd: 0,
  wallMs: 0,
})

const selection: Selection = {
  file: 'src/foo.ts',
  beforeScore: 0.4,
  rationale: 'x',
  runnerUps: [],
}

const improvedResult: Result = {
  specPath: 'docs/superpowers/specs/x-design.md',
  planPath: 'docs/superpowers/plans/x.md',
  testPaths: ['tests/foo.test.ts'],
  residuals: [],
  notes: '',
}

// Sequence-based measureScore: first call returns the before score (below
// threshold so the iteration enters improve), second returns the after score
// (above threshold so the iteration ratchets and merges).
const sequenceMeasure = (scores: readonly number[]): PipelineDeps['measureScore'] => {
  let calls = 0
  return (): Promise<MeasuredScore> => {
    calls += 1
    const idx = Math.min(calls - 1, scores.length - 1)
    return Promise.resolve({ score: scores[idx] ?? 0, survivingMutantIds: [] })
  }
}

describe('integration', () => {
  test('runPipeline + runFinalize end-to-end with all externals faked', async () => {
    const repoRoot = makeTempDir('e2e-')
    // C1 changed the baseline WRITE target from repoRoot to the worktree path.
    // This composition test fakes createWorktree (no real worktree dir on disk),
    // so writeBaseline must be faked too — otherwise it would ENOENT on the
    // non-existent worktree path. Real baseline.ts persistence is exercised by
    // integration-git.test.ts; this test still proves runPipeline + runFinalize
    // composition end-to-end.
    let baseline: BaselineMap = { 'src/foo.ts': 0.4 }
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
    const runState = await createRunState(config)

    const deps: PipelineDeps = {
      config,
      runState,
      spawn: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
      createWorktree: () => Promise.resolve(),
      resetWorktree: () => Promise.resolve(),
      removeWorktree: () => Promise.resolve(),
      mergeWorktree: () => Promise.resolve({ ok: true }),
      execGit: () => Promise.resolve({ stdout: ' M tests/foo.test.ts\n', stderr: '' }),
      runBuildCheck: () => Promise.resolve({ passed: true, stdout: '', stderr: '' }),
      measureScore: sequenceMeasure([0.4, 0.97]),
      readBaseline: () => Promise.resolve(baseline),
      writeBaseline: (_root: string, map: BaselineMap) => {
        baseline = map
        return Promise.resolve()
      },
      runSelectAgent: () => Promise.resolve({ value: selection, usage: emptyUsage() }),
      runImproveAgent: () => Promise.resolve({ value: improvedResult, usage: emptyUsage() }),
      cappedRegistry: { entries: [], record: () => Promise.resolve() },
      saveRunState: () => Promise.resolve(),
      log: { log: () => undefined },
    }

    const { results, aborted } = await runPipeline(deps)
    expect(aborted).toBe(false)
    expect(results[0]).toMatchObject({ outcome: 'improved', file: 'src/foo.ts', afterScore: 0.97 })

    expect(baseline['src/foo.ts']).toBe(0.97)

    const out = await runFinalize(
      {
        execGit: () => Promise.resolve({ stdout: 'feat\n', stderr: '' }),
        runGh: () => Promise.resolve({ exitCode: 0, stdout: 'https://github.com/x/pull/1\n', stderr: '' }),
      },
      { config, runState },
    )
    expect(out.prUrl).toBe('https://github.com/x/pull/1')
  })
})
