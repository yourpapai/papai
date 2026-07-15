// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import path from 'node:path'

import { execGit } from '../../review-loop/src/worktree.js'
import { createWorktree, mergeWorktree, removeWorktree, worktreeExists } from '../../review-loop/src/worktree.js'
import { cleanupTempDirs, makeTempDir } from './test-helpers.js'

afterEach(cleanupTempDirs)

describe('worktree', () => {
  test('createWorktree creates a linked worktree on a new branch', async () => {
    const repoRoot = makeTempDir('worktree-repo-')
    await execGit(repoRoot, ['init'])
    await execGit(repoRoot, ['config', 'user.email', 'test@test.com'])
    await execGit(repoRoot, ['config', 'user.name', 'Test'])
    await execGit(repoRoot, ['checkout', '-b', 'main'])

    const { writeFileSync } = await import('node:fs')
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
    const { writeFileSync } = await import('node:fs')
    writeFileSync(path.join(repoRoot, 'README.md'), 'hello')
    await execGit(repoRoot, ['add', '.'])
    await execGit(repoRoot, ['commit', '-m', 'init'])

    const wtPath = path.join(repoRoot, '.review-loop', 'worktree')

    expect(await worktreeExists(wtPath)).toBe(false)

    await createWorktree(repoRoot, wtPath, 'test-run')
    expect(await worktreeExists(wtPath)).toBe(true)

    await removeWorktree(repoRoot, wtPath, 'test-run')
    expect(await worktreeExists(wtPath)).toBe(false)
  })

  test('mergeWorktree merges the branch back to current HEAD', async () => {
    const repoRoot = makeTempDir('worktree-repo-')
    await execGit(repoRoot, ['init'])
    await execGit(repoRoot, ['config', 'user.email', 'test@test.com'])
    await execGit(repoRoot, ['config', 'user.name', 'Test'])
    await execGit(repoRoot, ['checkout', '-b', 'main'])
    const { writeFileSync } = await import('node:fs')
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
})
