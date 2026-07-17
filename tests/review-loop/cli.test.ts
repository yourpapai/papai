// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { runBuildCheck } from '../../review-loop/src/build-checker.js'
import { finalizeRun, parseCliArgs, resolvePlanPath, type FinalizeDeps } from '../../review-loop/src/cli.js'
import type { ReviewLoopConfig } from '../../review-loop/src/config.js'
import { createRunState, type RunState } from '../../review-loop/src/run-state.js'
import { cleanupTempDirs, createReviewLoopConfigFixture, makeTempDir } from './test-helpers.js'

afterEach(cleanupTempDirs)

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

describe('parseCliArgs', () => {
  test('defaults configPath to review-loop/config.json', () => {
    const args = parseCliArgs(['--plan', '/path/to/plan.md'])
    expect(args.configPath.endsWith('review-loop/config.json')).toBe(true)
    expect(args.repoRoot).toBeUndefined()
  })

  test('parses --config and --plan', () => {
    const args = parseCliArgs(['--config', '/path/to/config.json', '--plan', '/path/to/plan.md'])
    expect(args.configPath).toBe('/path/to/config.json')
    expect(args.planPath).toBe('/path/to/plan.md')
  })

  test('parses --resume-run', () => {
    const args = parseCliArgs([
      '--config',
      '/path/to/config.json',
      '--plan',
      '/path/to/plan.md',
      '--resume-run',
      '2026-07-15T10-30-00-000Z',
    ])
    expect(args.resumeRunId).toBe('2026-07-15T10-30-00-000Z')
  })

  test('resetWorktree defaults to false', () => {
    const args = parseCliArgs(['--plan', '/path/to/plan.md'])
    expect(args.resetWorktree).toBe(false)
  })

  test('parses --reset-worktree as a boolean flag', () => {
    const args = parseCliArgs(['--plan', '/path/to/plan.md', '--reset-worktree'])
    expect(args.resetWorktree).toBe(true)
  })

  test('throws on missing --plan', () => {
    expect(() => parseCliArgs(['--config', '/path/to/config.json'])).toThrow('Missing required --plan')
  })
})

async function setupFinalizeFixtures(): Promise<{ config: ReviewLoopConfig; runState: RunState }> {
  const repoRoot = makeTempDir('cli-')
  const config = createReviewLoopConfigFixture(repoRoot)
  const planPath = path.join(repoRoot, 'plan.md')
  writeFileSync(planPath, '# Plan')
  const runState = await createRunState(config, planPath)
  return { config, runState }
}

describe('resolvePlanPath', () => {
  test('resolves a repo-root-relative plan path against the repo root', async () => {
    const repoRoot = makeTempDir('plan-rel-')
    writeFileSync(path.join(repoRoot, 'plan.md'), '# Plan')

    const resolved = await resolvePlanPath('./plan.md', repoRoot)

    expect(resolved).toBe(path.join(repoRoot, 'plan.md'))
  })

  test('passes through an existing absolute plan path', async () => {
    const repoRoot = makeTempDir('plan-abs-repo-')
    const dir = makeTempDir('plan-abs-')
    const absolute = path.join(dir, 'plan.md')
    writeFileSync(absolute, '# Plan')

    await expect(resolvePlanPath(absolute, repoRoot)).resolves.toBe(absolute)
  })

  test('throws a clear error naming the resolved path when the plan is missing', async () => {
    const repoRoot = makeTempDir('plan-missing-')
    const expected = path.resolve(repoRoot, 'docs/plans/nope.md')

    await expect(resolvePlanPath('./docs/plans/nope.md', repoRoot)).rejects.toThrow(expected)
  })
})

describe('finalizeRun', () => {
  test('aborts merge and preserves worktree when final build fails', async () => {
    const { config, runState } = await setupFinalizeFixtures()
    let merged = 0
    let removed = 0
    const deps: FinalizeDeps = {
      exec: () => Promise.resolve({ exitCode: 1, stdout: '', stderr: 'TypeError: broken' }),
      runBuildCheck,
      mergeWorktree: () => {
        merged += 1
        return Promise.resolve()
      },
      removeWorktree: () => {
        removed += 1
        return Promise.resolve()
      },
    }

    const promise = finalizeRun(config, runState, deps)
    await expect(promise).rejects.toThrow(/Final build check failed[\s\S]*TypeError: broken/u)
    expect(readFileSync(path.join(runState.runDir, 'build-check.log'), 'utf8')).toContain('TypeError: broken')
    expect(merged).toBe(0)
    expect(removed).toBe(0)
  })

  test('truncates long build output in the error but keeps the full log', async () => {
    const { config, runState } = await setupFinalizeFixtures()
    const firstLine = 'LINE-ZERO-SHOULD-BE-TRUNCATED-FROM-TAIL'
    const stdout = [firstLine, ...Array.from({ length: 60 }, (_, i) => `output-line-${i + 1}`)].join('\n')
    const deps: FinalizeDeps = {
      exec: () => Promise.resolve({ exitCode: 1, stdout, stderr: '' }),
      runBuildCheck,
      mergeWorktree: () => Promise.resolve(),
      removeWorktree: () => Promise.resolve(),
    }

    let message = ''
    await finalizeRun(config, runState, deps).catch((error: unknown) => {
      message = errorMessage(error)
    })

    expect(message).toContain('Final build check failed')
    expect(message).toContain('output-line-60')
    expect(message).toContain('truncated')
    expect(message).not.toContain(firstLine)

    const log = readFileSync(path.join(runState.runDir, 'build-check.log'), 'utf8')
    expect(log).toContain(firstLine)
    expect(log).toContain('output-line-60')
  })

  test('merges and removes worktree when final build passes', async () => {
    const { config, runState } = await setupFinalizeFixtures()
    let merged = 0
    let removed = 0
    const deps: FinalizeDeps = {
      exec: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
      runBuildCheck,
      mergeWorktree: () => {
        merged += 1
        return Promise.resolve()
      },
      removeWorktree: () => {
        removed += 1
        return Promise.resolve()
      },
    }

    await finalizeRun(config, runState, deps)

    expect(merged).toBe(1)
    expect(removed).toBe(1)
  })
})
