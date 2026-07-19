// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { execGit } from '../../review-loop/src/worktree.js'
import {
  cleanWorkerWorktrees,
  createWorktree,
  detectGitRoot,
  mergeWorktree,
  removeWorktree,
  resetWorktree,
  resetWorktreeTo,
  worktreeExists,
  worktreeIsDirty,
} from '../../review-loop/src/worktree.js'
import { cleanupTempDirs, makeTempDir } from './test-helpers.js'

afterEach(cleanupTempDirs)

describe('worktree', () => {
  test('createWorktree creates a linked worktree on a new branch', async () => {
    const repoRoot = makeTempDir('worktree-repo-')
    await execGit(repoRoot, ['init'])
    await execGit(repoRoot, ['config', 'user.email', 'test@test.com'])
    await execGit(repoRoot, ['config', 'user.name', 'Test'])
    await execGit(repoRoot, ['checkout', '-b', 'main'])

    writeFileSync(path.join(repoRoot, 'README.md'), 'hello')
    await execGit(repoRoot, ['add', '.'])
    await execGit(repoRoot, ['commit', '-m', 'init'])

    const wtPath = path.join(repoRoot, '.review-loop', 'worktree')
    await createWorktree(repoRoot, wtPath, 'test-run')

    expect(existsSync(wtPath)).toBe(true)
    const branch = await execGit(repoRoot, ['branch', '--list', 'review-loop/test-run'])
    expect(branch.stdout.trim()).toContain('review-loop/test-run')
  })

  test('worktreeExists returns true after create, false after remove', async () => {
    const repoRoot = makeTempDir('worktree-repo-')
    await execGit(repoRoot, ['init'])
    await execGit(repoRoot, ['config', 'user.email', 'test@test.com'])
    await execGit(repoRoot, ['config', 'user.name', 'Test'])
    await execGit(repoRoot, ['checkout', '-b', 'main'])
    writeFileSync(path.join(repoRoot, 'README.md'), 'hello')
    await execGit(repoRoot, ['add', '.'])
    await execGit(repoRoot, ['commit', '-m', 'init'])

    const wtPath = path.join(repoRoot, '.review-loop', 'worktree')

    expect(worktreeExists(wtPath)).toBe(false)

    await createWorktree(repoRoot, wtPath, 'test-run')
    expect(worktreeExists(wtPath)).toBe(true)

    await removeWorktree(repoRoot, wtPath, 'test-run')
    expect(worktreeExists(wtPath)).toBe(false)
  })

  test('mergeWorktree merges the branch back to current HEAD', async () => {
    const repoRoot = makeTempDir('worktree-repo-')
    await execGit(repoRoot, ['init'])
    await execGit(repoRoot, ['config', 'user.email', 'test@test.com'])
    await execGit(repoRoot, ['config', 'user.name', 'Test'])
    await execGit(repoRoot, ['checkout', '-b', 'main'])
    writeFileSync(path.join(repoRoot, 'README.md'), 'hello')
    await execGit(repoRoot, ['add', '.'])
    await execGit(repoRoot, ['commit', '-m', 'init'])

    const wtPath = path.join(repoRoot, '.review-loop', 'worktree')
    await createWorktree(repoRoot, wtPath, 'test-run')

    writeFileSync(path.join(wtPath, 'fix.txt'), 'fixed')
    await execGit(wtPath, ['add', '.'])
    await execGit(wtPath, ['commit', '-m', 'fix(review-loop): test fix'])

    await mergeWorktree(repoRoot, 'review-loop/test-run')

    expect(existsSync(path.join(repoRoot, 'fix.txt'))).toBe(true)
  })

  test('detectGitRoot returns the repository toplevel', async () => {
    const repoRoot = makeTempDir('gitroot-')
    await execGit(repoRoot, ['init'])
    const result = await detectGitRoot(repoRoot)
    expect(result).toBe(realpathSync(repoRoot))
  })
})

describe('cleanWorkerWorktrees', () => {
  async function setupRepoWithStaleWorkers(): Promise<{
    repoRoot: string
    worktreesDir: string
    workerPath: (runId: string, id: number) => string
  }> {
    const repoRoot = makeTempDir('worktree-repo-')
    await execGit(repoRoot, ['init'])
    await execGit(repoRoot, ['config', 'user.email', 'test@test.com'])
    await execGit(repoRoot, ['config', 'user.name', 'Test'])
    await execGit(repoRoot, ['checkout', '-b', 'main'])
    writeFileSync(path.join(repoRoot, 'README.md'), 'hello')
    await execGit(repoRoot, ['add', '.'])
    await execGit(repoRoot, ['commit', '-m', 'init'])
    const worktreesDir = path.join(repoRoot, '.review-loop', 'worktrees')
    const workerPath = (runId: string, id: number): string => path.join(worktreesDir, `${runId}-worker-${id}`)
    return { repoRoot, worktreesDir, workerPath }
  }

  test('without a runId, sweeps all worker worktrees regardless of runId', async () => {
    const { repoRoot, workerPath } = await setupRepoWithStaleWorkers()
    const crashedA = workerPath('2026-07-15T10-30-00-000Z-crashedA', 1)
    const crashedB = workerPath('2026-07-15T11-00-00-000Z-crashedB', 2)
    await execGit(repoRoot, [
      'worktree',
      'add',
      crashedA,
      '-b',
      'review-loop/2026-07-15T10-30-00-000Z-crashedA-worker-1',
    ])
    await execGit(repoRoot, [
      'worktree',
      'add',
      crashedB,
      '-b',
      'review-loop/2026-07-15T11-00-00-000Z-crashedB-worker-2',
    ])

    await cleanWorkerWorktrees(repoRoot)

    expect(existsSync(crashedA)).toBe(false)
    expect(existsSync(crashedB)).toBe(false)
  })

  test('with a runId, removes only workers tagged with that runId', async () => {
    const { repoRoot, workerPath } = await setupRepoWithStaleWorkers()
    const sameRun = workerPath('2026-07-15T10-30-00-000Z-stale', 1)
    const otherRun = workerPath('2026-07-15T11-00-00-000Z-other', 1)
    await execGit(repoRoot, ['worktree', 'add', sameRun, '-b', 'review-loop/2026-07-15T10-30-00-000Z-stale-worker-1'])
    await execGit(repoRoot, ['worktree', 'add', otherRun, '-b', 'review-loop/2026-07-15T11-00-00-000Z-other-worker-1'])

    await cleanWorkerWorktrees(repoRoot, '2026-07-15T10-30-00-000Z-stale')

    expect(existsSync(sameRun)).toBe(false)
    expect(existsSync(otherRun)).toBe(true)
  })
})

describe('worktree dirty-state helpers', () => {
  async function setupRepoWithWorktree(): Promise<{ repoRoot: string; wtPath: string }> {
    const repoRoot = makeTempDir('worktree-repo-')
    await execGit(repoRoot, ['init'])
    await execGit(repoRoot, ['config', 'user.email', 'test@test.com'])
    await execGit(repoRoot, ['config', 'user.name', 'Test'])
    await execGit(repoRoot, ['checkout', '-b', 'main'])
    writeFileSync(path.join(repoRoot, 'README.md'), 'hello')
    await execGit(repoRoot, ['add', '.'])
    await execGit(repoRoot, ['commit', '-m', 'init'])
    const wtPath = path.join(repoRoot, '.review-loop', 'worktree')
    await createWorktree(repoRoot, wtPath, 'test-run')
    return { repoRoot, wtPath }
  }

  test('worktreeIsDirty returns false for a clean worktree', async () => {
    const { wtPath } = await setupRepoWithWorktree()
    expect(await worktreeIsDirty(wtPath)).toBe(false)
  })

  test('worktreeIsDirty returns true when there are uncommitted changes', async () => {
    const { wtPath } = await setupRepoWithWorktree()
    writeFileSync(path.join(wtPath, 'dirty.txt'), 'uncommitted')
    expect(await worktreeIsDirty(wtPath)).toBe(true)
  })

  test('resetWorktree discards tracked modifications and untracked files', async () => {
    const { wtPath } = await setupRepoWithWorktree()
    writeFileSync(path.join(wtPath, 'README.md'), 'changed')
    writeFileSync(path.join(wtPath, 'untracked.txt'), 'temp')
    expect(await worktreeIsDirty(wtPath)).toBe(true)

    await resetWorktree(wtPath)

    expect(await worktreeIsDirty(wtPath)).toBe(false)
    expect(readFileSync(path.join(wtPath, 'README.md'), 'utf8')).toBe('hello')
    expect(existsSync(path.join(wtPath, 'untracked.txt'))).toBe(false)
  })

  test('resetWorktreeTo resets to a sha AND removes untracked files', async () => {
    const repo = makeTempDir('wt-')
    await execGit(repo, ['init'])
    await execGit(repo, ['config', 'user.email', 't@t.com'])
    await execGit(repo, ['config', 'user.name', 'T'])
    writeFileSync(path.join(repo, 'a.txt'), 'a')
    await execGit(repo, ['add', '.'])
    await execGit(repo, ['commit', '-m', 'init'])
    const baseline = (await execGit(repo, ['rev-parse', 'HEAD'])).stdout.trim()

    // second commit + an untracked scratch file
    writeFileSync(path.join(repo, 'b.txt'), 'b')
    await execGit(repo, ['add', '.'])
    await execGit(repo, ['commit', '-m', 'second'])
    writeFileSync(path.join(repo, 'scratch.txt'), 'leak')

    await resetWorktreeTo(repo, baseline)

    expect((await execGit(repo, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(baseline)
    const status = (await execGit(repo, ['status', '--porcelain'])).stdout.trim()
    // scratch.txt gone, no untracked files
    expect(status).toBe('')
  })
})
