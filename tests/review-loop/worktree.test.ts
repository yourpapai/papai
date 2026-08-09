// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { execGit, rebaseOnto } from '../../review-loop/src/worktree.js'
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

  test('createWorktree installs dependencies when the worktree has a package.json', async () => {
    const repoRoot = makeTempDir('worktree-repo-')
    await execGit(repoRoot, ['init'])
    await execGit(repoRoot, ['config', 'user.email', 'test@test.com'])
    await execGit(repoRoot, ['config', 'user.name', 'Test'])
    await execGit(repoRoot, ['checkout', '-b', 'main'])

    writeFileSync(path.join(repoRoot, 'package.json'), '{"name":"wt-test","dependencies":{}}')
    await execGit(repoRoot, ['add', '.'])
    await execGit(repoRoot, ['commit', '-m', 'init'])

    const wtPath = path.join(repoRoot, '.review-loop', 'worktree')
    await createWorktree(repoRoot, wtPath, 'test-run')

    expect(existsSync(path.join(wtPath, 'node_modules'))).toBe(true)
  })

  test('createWorktree without a package.json skips the install', async () => {
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
    expect(existsSync(path.join(wtPath, 'node_modules'))).toBe(false)
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

    const result = await mergeWorktree(repoRoot, 'review-loop/test-run')

    expect(result).toEqual({ ok: true })
    expect(existsSync(path.join(repoRoot, 'fix.txt'))).toBe(true)
  })

  test('mergeWorktree returns conflictFiles and aborts on conflict', async () => {
    // Regression: previously mergeWorktree threw raw on conflict, leaving the
    // user's repo in a half-merged state with no structured recovery info.
    // The new contract mirrors rebaseOnto: detect conflict, abort, return the
    // list of conflicted paths so the caller can surface an actionable message.
    const repoRoot = makeTempDir('worktree-conflict-')
    await execGit(repoRoot, ['init'])
    await execGit(repoRoot, ['config', 'user.email', 't@t.com'])
    await execGit(repoRoot, ['config', 'user.name', 'T'])
    await execGit(repoRoot, ['checkout', '-b', 'main'])
    writeFileSync(path.join(repoRoot, 'file.txt'), 'base\n')
    await execGit(repoRoot, ['add', '.'])
    await execGit(repoRoot, ['commit', '-m', 'init'])

    const wtPath = path.join(repoRoot, '.review-loop', 'worktree')
    await createWorktree(repoRoot, wtPath, 'test-run')

    // Diverge: edit same line on main and on the loop branch.
    writeFileSync(path.join(repoRoot, 'file.txt'), 'main edit\n')
    await execGit(repoRoot, ['add', 'file.txt'])
    await execGit(repoRoot, ['commit', '-m', 'main edit'])

    writeFileSync(path.join(wtPath, 'file.txt'), 'loop edit\n')
    await execGit(wtPath, ['add', 'file.txt'])
    await execGit(wtPath, ['commit', '-m', 'loop edit'])

    const result = await mergeWorktree(repoRoot, 'review-loop/test-run')

    expect(result).toEqual({ ok: false, conflictFiles: ['file.txt'] })
    // Merge must have been aborted — no conflict markers in file.txt, and no
    // unmerged paths in the index. (.review-loop/ may show as untracked because
    // the worktree lives there; that's expected and unrelated to the abort.)
    const fileContent = readFileSync(path.join(repoRoot, 'file.txt'), 'utf8')
    expect(fileContent).toBe('main edit\n')
    const status = (await execGit(repoRoot, ['status', '--porcelain'])).stdout
    expect(status).not.toMatch(/^UU /mu)
    expect(status).not.toMatch(/^file\.txt /mu)
  })

  test('detectGitRoot returns the repository toplevel', async () => {
    const repoRoot = makeTempDir('gitroot-')
    await execGit(repoRoot, ['init'])
    const result = await detectGitRoot(repoRoot)
    expect(result).toBe(realpathSync(repoRoot))
  })

  test('createWorktree uses the branchPrefix argument', async () => {
    const repoRoot = makeTempDir('wt-prefix-')
    await execGit(repoRoot, ['init', '--quiet'])
    await execGit(repoRoot, ['config', 'user.email', 't@t'])
    await execGit(repoRoot, ['config', 'user.name', 't'])
    writeFileSync(path.join(repoRoot, 'a.txt'), 'x')
    await execGit(repoRoot, ['add', '.'])
    await execGit(repoRoot, ['commit', '-m', 'init', '--quiet'])
    const wt = path.join(repoRoot, 'wt')
    await createWorktree(repoRoot, wt, 'run-1', 'mutation-improve')
    const { stdout } = await execGit(repoRoot, ['branch', '--list'])
    expect(stdout).toContain('mutation-improve/run-1')
  })

  test('removeWorktree deletes a branch under branchPrefix', async () => {
    const repoRoot = makeTempDir('wt-prefix-rm-')
    await execGit(repoRoot, ['init', '--quiet'])
    await execGit(repoRoot, ['config', 'user.email', 't@t'])
    await execGit(repoRoot, ['config', 'user.name', 't'])
    writeFileSync(path.join(repoRoot, 'a.txt'), 'x')
    await execGit(repoRoot, ['add', '.'])
    await execGit(repoRoot, ['commit', '-m', 'init', '--quiet'])
    const wt = path.join(repoRoot, 'wt')
    await createWorktree(repoRoot, wt, 'run-2', 'mutation-improve')
    const { stdout: afterCreate } = await execGit(repoRoot, ['branch', '--list'])
    expect(afterCreate).toContain('mutation-improve/run-2')
    await removeWorktree(repoRoot, wt, 'run-2', 'mutation-improve')
    const { stdout } = await execGit(repoRoot, ['branch', '--list'])
    expect(stdout).not.toContain('mutation-improve/run-2')
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

describe('rebaseOnto', () => {
  function rebaseInProgress(repoRoot: string): boolean {
    return (
      existsSync(path.join(repoRoot, '.git', 'rebase-merge')) || existsSync(path.join(repoRoot, '.git', 'rebase-apply'))
    )
  }

  async function setupConflictRepo(): Promise<string> {
    const repoRoot = makeTempDir('rebase-')
    await execGit(repoRoot, ['init'])
    await execGit(repoRoot, ['config', 'user.email', 't@t.com'])
    await execGit(repoRoot, ['config', 'user.name', 'T'])
    await execGit(repoRoot, ['checkout', '-b', 'main'])
    writeFileSync(path.join(repoRoot, 'file.txt'), 'base\n')
    await execGit(repoRoot, ['add', '.'])
    await execGit(repoRoot, ['commit', '-m', 'init'])
    await execGit(repoRoot, ['checkout', '-b', 'feature'])
    // Diverge main and feature with conflicting edits to the same line
    await execGit(repoRoot, ['checkout', 'main'])
    writeFileSync(path.join(repoRoot, 'file.txt'), 'main change\n')
    await execGit(repoRoot, ['add', '.'])
    await execGit(repoRoot, ['commit', '-m', 'main edit'])
    await execGit(repoRoot, ['checkout', 'feature'])
    writeFileSync(path.join(repoRoot, 'file.txt'), 'feature change\n')
    await execGit(repoRoot, ['add', '.'])
    await execGit(repoRoot, ['commit', '-m', 'feature edit'])
    return repoRoot
  }

  test('returns ok=true on a clean (fast-forward) rebase', async () => {
    const repoRoot = makeTempDir('rebase-clean-')
    await execGit(repoRoot, ['init'])
    await execGit(repoRoot, ['config', 'user.email', 't@t.com'])
    await execGit(repoRoot, ['config', 'user.name', 'T'])
    await execGit(repoRoot, ['checkout', '-b', 'main'])
    writeFileSync(path.join(repoRoot, 'a.txt'), 'a')
    await execGit(repoRoot, ['add', '.'])
    await execGit(repoRoot, ['commit', '-m', 'init'])
    await execGit(repoRoot, ['checkout', '-b', 'feature'])
    writeFileSync(path.join(repoRoot, 'b.txt'), 'b')
    await execGit(repoRoot, ['add', '.'])
    await execGit(repoRoot, ['commit', '-m', 'add b'])

    const result = await rebaseOnto(repoRoot, 'main', 'feature')
    expect(result.ok).toBe(true)
    expect(rebaseInProgress(repoRoot)).toBe(false)
  })

  test('returns conflictFiles and aborts the rebase on conflict', async () => {
    const repoRoot = await setupConflictRepo()
    const result = await rebaseOnto(repoRoot, 'main', 'feature')
    expect(result).toEqual({ ok: false, conflictFiles: ['file.txt'] })
    // The abort must have run — no rebase metadata should remain.
    // This also covers the listUnmergedPaths-throws case: the try/finally
    // guarantees the abort runs regardless of whether the diff succeeds.
    expect(rebaseInProgress(repoRoot)).toBe(false)
  })
})
