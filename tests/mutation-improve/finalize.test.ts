// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import type { MutationImproveConfig } from '../../mutation-improve/src/config.js'
import {
  assertIntegrationBranch,
  buildSummaryBody,
  runFinalize,
  type ExecGitFn,
  type RunGhFn,
} from '../../mutation-improve/src/finalize.js'
import type { MutationImproveRunState } from '../../mutation-improve/src/run-state.js'
import { cleanupTempDirs, makeTempDir } from './test-helpers.js'

afterEach(cleanupTempDirs)

const config = (repoRoot: string): MutationImproveConfig => ({
  repoRoot,
  workDir: `${repoRoot}/.mutation-improve`,
  base: 'master',
  upstream: 'origin',
  count: 1,
  threshold: 0.95,
  epsilon: 0.02,
  agentTimeoutMs: 1,
  buildTimeoutMs: 1,
  checkCommand: 'x',
  mutateFileCommand: 'x',
  agent: { model: 'm', extraArgs: [], timeoutMs: 1 },
  prBranchPrefix: 'mutation-improve',
})

describe('finalize', () => {
  test('buildSummaryBody renders one row per merged file plus a failures section when present', () => {
    const body = buildSummaryBody(
      [{ file: 'src/a.ts', beforeScore: 0.4, afterScore: 0.97, iter: 1 }],
      [{ iter: 2, gate: 'score', reason: 'below' }],
    )
    expect(body).toContain('| src/a.ts | 0.4 | 0.97 |')
    expect(body).toContain('Failed iterations')
    expect(body).toContain('| 2 | score |')
  })

  test('runFinalize pushes and opens a PR via gh, returning the URL', async () => {
    const repoRoot = makeTempDir('fin-')
    const runState: MutationImproveRunState = {
      runId: 'r',
      repoRoot,
      workDir: `${repoRoot}/.mi`,
      runDir: `${repoRoot}/.mi/runs/r`,
      statePath: `${repoRoot}/.mi/runs/r/state.json`,
      base: 'master',
      threshold: 0.95,
      count: 1,
      currentIteration: 1,
      doneSet: ['src/a.ts'],
      merged: [{ file: 'src/a.ts', beforeScore: 0.4, afterScore: 0.97, iter: 1 }],
      failed: [],
      status: 'completed',
    }
    const seen: string[] = []
    const execGit: ExecGitFn = (_cwd, args) => {
      seen.push(args.join(' '))
      return Promise.resolve({ stdout: '', stderr: '' })
    }
    const runGh: RunGhFn = () => Promise.resolve({ exitCode: 0, stdout: 'https://github.com/x/pull/9\n', stderr: '' })
    const out = await runFinalize({ execGit, runGh }, { config: config(repoRoot), runState })
    expect(out.pushed).toBe(true)
    expect(out.prUrl).toBe('https://github.com/x/pull/9')
    expect(seen.some((s) => s.startsWith('push origin master'))).toBe(true)
  })

  test('runFinalize survives gh failure and still reports pushed=true', async () => {
    const repoRoot = makeTempDir('fin-fail-')
    const runState: MutationImproveRunState = {
      runId: 'r',
      repoRoot,
      workDir: `${repoRoot}/.mi`,
      runDir: `${repoRoot}/.mi/runs/r`,
      statePath: `${repoRoot}/.mi/runs/r/state.json`,
      base: 'master',
      threshold: 0.95,
      count: 1,
      currentIteration: 1,
      doneSet: [],
      merged: [{ file: 'src/a.ts', beforeScore: 0.4, afterScore: 0.97, iter: 1 }],
      failed: [],
      status: 'completed',
    }
    const execGit: ExecGitFn = () => Promise.resolve({ stdout: '', stderr: '' })
    const runGh: RunGhFn = () => Promise.resolve({ exitCode: 1, stdout: '', stderr: 'no gh' })
    const out = await runFinalize({ execGit, runGh }, { config: config(repoRoot), runState })
    expect(out.pushed).toBe(true)
    expect(out.prUrl).toBeUndefined()
  })
})

describe('assertIntegrationBranch', () => {
  const branchExec =
    (branch: string): ExecGitFn =>
    () =>
      Promise.resolve({ stdout: `${branch}\n`, stderr: '' })

  test('passes on a non-base branch', async () => {
    await expect(assertIntegrationBranch(branchExec('mutation-improve-10'), '/repo', 'master')).resolves.toBeUndefined()
  })

  test('throws on the base branch', async () => {
    await expect(assertIntegrationBranch(branchExec('master'), '/repo', 'master')).rejects.toThrow(
      /integration branch/u,
    )
  })

  test('throws on a detached HEAD', async () => {
    await expect(assertIntegrationBranch(branchExec('HEAD'), '/repo', 'master')).rejects.toThrow(/integration branch/u)
  })
})
