// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

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
  mutateTimeoutMs: 1,
  buildTimeoutMs: 1,
  buildFixAttempts: 0,
  checkCommand: 'x',
  mutateFileCommand: 'x',
  agent: { model: 'm', extraArgs: [], timeoutMs: 1, inactivityTimeoutMs: 600_000 },
  prBranchPrefix: 'mutation-improve',
})

const branchExecGit =
  (branch: string, seen?: string[]): ExecGitFn =>
  (_cwd, args) => {
    seen?.push(args.join(' '))
    return Promise.resolve({ stdout: args[0] === 'rev-parse' ? `${branch}\n` : '', stderr: '' })
  }

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

  test('reports accepted residuals and their reasoning instead of two document links', () => {
    // The two Spec/Plan cells were the only place a pull-request reader could
    // see why a file was accepted below target. Reading it from `residuals` is
    // strictly better: that array is the one the runner set-matched against its
    // own measurement, so the reader sees the checked answer rather than prose
    // beside it.
    const body = buildSummaryBody(
      [
        {
          file: 'src/a.ts',
          beforeScore: 0.4,
          afterScore: 0.88,
          iter: 1,
          residuals: [
            { loc: 'src/a.ts:12', why: 'equivalent mutant: jitter bound', mutantIds: ['7'] },
            { loc: 'src/a.ts:30', why: 'dead branch only a src edit removes', mutantIds: ['9', '11'] },
          ],
        },
      ],
      [],
    )
    expect(body).toContain('| src/a.ts | 0.4 | 0.88 | 2 |')
    expect(body).toContain('equivalent mutant: jitter bound')
    expect(body).toContain('dead branch only a src edit removes')
    expect(body).not.toContain('| Spec | Plan |')
  })

  test('renders a file with no residuals without an empty reasoning cell', () => {
    const body = buildSummaryBody([{ file: 'src/a.ts', beforeScore: 0.4, afterScore: 0.97, iter: 1 }], [])
    expect(body).toContain('| src/a.ts | 0.4 | 0.97 | 0 | — |')
  })

  test('a resumed row still carrying document paths renders from residuals, not paths', () => {
    // --resume-run reads rows stored before the documents were dropped. The
    // report reads residuals, so such a row renders exactly like a fresh one.
    const body = buildSummaryBody(
      [{ file: 'src/a.ts', beforeScore: 0.4, afterScore: 0.97, iter: 1, specPath: 's.md', planPath: 'p.md' }],
      [],
    )
    expect(body).not.toContain('s.md')
    expect(body).not.toContain('p.md')
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
    const execGit = branchExecGit('mutation-improve-10', seen)
    let ghArgs: readonly string[] = []
    const runGh: RunGhFn = (args) => {
      ghArgs = args
      return Promise.resolve({ exitCode: 0, stdout: 'https://github.com/x/pull/9\n', stderr: '' })
    }
    const out = await runFinalize({ execGit, runGh }, { config: config(repoRoot), runState })
    expect(out.pushed).toBe(true)
    expect(out.prUrl).toBe('https://github.com/x/pull/9')
    expect(seen).toContain('push origin mutation-improve-10')
    expect(ghArgs).toContain('--head')
    expect(ghArgs[ghArgs.indexOf('--head') + 1]).toBe('mutation-improve-10')
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
    const execGit = branchExecGit('mutation-improve-10')
    const runGh: RunGhFn = () => Promise.resolve({ exitCode: 1, stdout: '', stderr: 'no gh' })
    const out = await runFinalize({ execGit, runGh }, { config: config(repoRoot), runState })
    expect(out.pushed).toBe(true)
    expect(out.prUrl).toBeUndefined()
    const log = await readFile(`${repoRoot}/.mi/runs/r/finalize.log`, 'utf8')
    expect(log).toContain('--head mutation-improve-10')
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
