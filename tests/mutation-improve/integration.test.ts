// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { readBaseline, writeBaseline } from '../../mutation-improve/src/baseline.js'
import type { MutationImproveConfig } from '../../mutation-improve/src/config.js'
import { runFinalize } from '../../mutation-improve/src/finalize.js'
import { runPipeline, type PipelineDeps } from '../../mutation-improve/src/pipeline.js'
import type { Result } from '../../mutation-improve/src/result-schema.js'
import { createRunState } from '../../mutation-improve/src/run-state.js'
import type { Selection } from '../../mutation-improve/src/selection-schema.js'
import type { AgentUsage } from '../../review-loop/src/agent-runner.js'
import { cleanupTempDirs, makeTempDir } from './test-helpers.js'

afterEach(cleanupTempDirs)

const emptyUsage = (): AgentUsage => ({ inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0, wallMs: 0 })

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
  return (): Promise<number> => {
    calls += 1
    const idx = Math.min(calls - 1, scores.length - 1)
    return Promise.resolve(scores[idx] ?? 0)
  }
}

describe('integration', () => {
  test('runPipeline + runFinalize end-to-end with all externals faked', async () => {
    const repoRoot = makeTempDir('e2e-')
    // seed a baseline file (writeBaseline does not mkdir parents)
    await mkdir(path.join(repoRoot, 'scripts', 'mutation'), { recursive: true })
    await writeBaseline(repoRoot, { 'src/foo.ts': 0.4 })
    const config: MutationImproveConfig = {
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
      execGit: () => Promise.resolve({ stdout: 'tests/foo.test.ts\n', stderr: '' }),
      runBuildCheck: () => Promise.resolve({ passed: true, stdout: '', stderr: '' }),
      measureScore: sequenceMeasure([0.4, 0.97]),
      readBaseline: () => readBaseline(repoRoot),
      writeBaseline: (repo: string, map) => writeBaseline(repo, map),
      runSelectAgent: () => Promise.resolve({ value: selection, usage: emptyUsage() }),
      runImproveAgent: () => Promise.resolve({ value: improvedResult, usage: emptyUsage() }),
      log: { log: () => undefined },
    }

    const { results, aborted } = await runPipeline(deps)
    expect(aborted).toBe(false)
    expect(results[0]).toMatchObject({ outcome: 'improved', file: 'src/foo.ts', afterScore: 0.97 })

    const finalBaseline = await readBaseline(repoRoot)
    expect(finalBaseline['src/foo.ts']).toBe(0.97)

    const out = await runFinalize(
      {
        execGit: () => Promise.resolve({ stdout: '', stderr: '' }),
        runGh: () => Promise.resolve({ exitCode: 0, stdout: 'https://github.com/x/pull/1\n', stderr: '' }),
      },
      { config, runState },
    )
    expect(out.prUrl).toBe('https://github.com/x/pull/1')
  })
})
