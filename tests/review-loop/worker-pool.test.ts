// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { createRunState } from '../../review-loop/src/run-state.js'
import { createWorkerPool } from '../../review-loop/src/worker-pool.js'
import { execGit, createWorktree } from '../../review-loop/src/worktree.js'
import { createReviewLoopConfigFixture, cleanupTempDirs, makeTempDir } from './test-helpers.js'

afterEach(cleanupTempDirs)

function getConflictFiles(result: { ok: true } | { ok: false; conflictFiles: string[] }): string[] {
  return result.ok ? [] : result.conflictFiles
}

async function setupPrimary(repoRoot: string, runId: string, runStatePath: string): Promise<void> {
  mkdirSync(repoRoot, { recursive: true })
  await execGit(repoRoot, ['init'])
  await execGit(repoRoot, ['config', 'user.email', 't@t.com'])
  await execGit(repoRoot, ['config', 'user.name', 'T'])
  writeFileSync(path.join(repoRoot, 'README.md'), 'init')
  await execGit(repoRoot, ['add', '.'])
  await execGit(repoRoot, ['commit', '-m', 'init'])
  // Create the primary worktree (mimics cli.ts setup)
  await createWorktree(repoRoot, runStatePath, runId)
}

describe('WorkerPool', () => {
  test('creates K worker worktrees + branches at construction; closes cleanly', async () => {
    const repoRoot = makeTempDir('pool-')
    const config = createReviewLoopConfigFixture(repoRoot, { poolSize: 3 })
    const runState = await createRunState(config, path.join(repoRoot, 'plan.md'))
    await setupPrimary(repoRoot, runState.runId, runState.worktreePath)

    const pool = await createWorkerPool(config, runState)
    for (let i = 1; i <= 3; i++) {
      const workerPath = path.join(config.workDir, 'worktrees', `${runState.runId}-worker-${i}`)
      expect(existsSync(workerPath)).toBe(true)
    }

    await pool.close()
    for (let i = 1; i <= 3; i++) {
      const workerPath = path.join(config.workDir, 'worktrees', `${runState.runId}-worker-${i}`)
      expect(existsSync(workerPath)).toBe(false)
    }
  })

  test('acquire returns a free worker; release makes it available again', async () => {
    const repoRoot = makeTempDir('pool-')
    const config = createReviewLoopConfigFixture(repoRoot, { poolSize: 3 })
    const runState = await createRunState(config, path.join(repoRoot, 'plan.md'))
    await setupPrimary(repoRoot, runState.runId, runState.worktreePath)

    const pool = await createWorkerPool(config, runState)
    const w = await pool.acquire('src/a.ts')
    expect(w.busy).toBe(true)
    pool.release(w)
    const w2 = await pool.acquire('src/a.ts')
    expect(w2.id).toBe(w.id)
    await pool.close()
  })

  test('acquire blocks when all busy; resolves on release', async () => {
    // K=1 pool; second acquire blocks until first releases.
    const repoRoot = makeTempDir('pool-')
    const config = createReviewLoopConfigFixture(repoRoot, { poolSize: 1 })
    const runState = await createRunState(config, path.join(repoRoot, 'plan.md'))
    await setupPrimary(repoRoot, runState.runId, runState.worktreePath)

    const pool = await createWorkerPool(config, runState)
    const w1 = await pool.acquire('src/a.ts')
    let acquired = false
    const p = pool.acquire('src/b.ts').then((w) => {
      acquired = true
      return w
    })
    expect(acquired).toBe(false)
    pool.release(w1)
    await p
    expect(acquired).toBe(true)
    await pool.close()
  })

  test('acquire prefers workers whose peers are not touching the requested file', async () => {
    const repoRoot = makeTempDir('pool-')
    const config = createReviewLoopConfigFixture(repoRoot, { poolSize: 2 })
    const runState = await createRunState(config, path.join(repoRoot, 'plan.md'))
    await setupPrimary(repoRoot, runState.runId, runState.worktreePath)

    const pool = await createWorkerPool(config, runState)
    // locks src/a.ts on worker 1
    const w1 = await pool.acquire('src/a.ts')
    // locks src/b.ts on worker 2
    await pool.acquire('src/b.ts')
    // worker 1 free again
    pool.release(w1)
    // asks for src/b.ts → worker 1 is preferred (peer has b.ts locked)
    const w3 = await pool.acquire('src/b.ts')
    expect(w3.id).toBe(w1.id)
    await pool.close()
  })

  test('mergeWorkerIntoPrimary fast-forwards when primary has not moved', async () => {
    const repoRoot = makeTempDir('pool-')
    const config = createReviewLoopConfigFixture(repoRoot, { poolSize: 3 })
    const runState = await createRunState(config, path.join(repoRoot, 'plan.md'))
    await setupPrimary(repoRoot, runState.runId, runState.worktreePath)

    const pool = await createWorkerPool(config, runState)
    const w = await pool.acquire('src/a.ts')
    writeFileSync(path.join(w.worktreePath, 'fix.txt'), 'fixed')
    await execGit(w.worktreePath, ['add', '.'])
    await execGit(w.worktreePath, ['commit', '-m', 'fix'])
    const result = await pool.mergeWorkerIntoPrimary(w)
    expect(result.ok).toBe(true)
    pool.release(w)
    await pool.close()
  })

  test('mergeWorkerIntoPrimary rebases when primary moved, then ff-merges', async () => {
    // Worker commits to its branch, then primary advances (another worker merges),
    // then this worker merges — should succeed via rebase.
    const repoRoot = makeTempDir('pool-')
    const config = createReviewLoopConfigFixture(repoRoot, { poolSize: 2 })
    const runState = await createRunState(config, path.join(repoRoot, 'plan.md'))
    await setupPrimary(repoRoot, runState.runId, runState.worktreePath)

    const pool = await createWorkerPool(config, runState)
    const w1 = await pool.acquire('src/a.ts')
    const w2 = await pool.acquire('src/b.ts')
    // w1 makes a fix touching a.txt, merges
    writeFileSync(path.join(w1.worktreePath, 'a.txt'), 'a')
    await execGit(w1.worktreePath, ['add', '.'])
    await execGit(w1.worktreePath, ['commit', '-m', 'a'])
    await pool.mergeWorkerIntoPrimary(w1)
    pool.release(w1)
    // w2 makes a fix touching b.txt, merges (primary has moved)
    writeFileSync(path.join(w2.worktreePath, 'b.txt'), 'b')
    await execGit(w2.worktreePath, ['add', '.'])
    await execGit(w2.worktreePath, ['commit', '-m', 'b'])
    const result = await pool.mergeWorkerIntoPrimary(w2)
    expect(result.ok).toBe(true)
    pool.release(w2)
    await pool.close()
  })

  test('mergeWorkerIntoPrimary returns conflictFiles on overlapping edit', async () => {
    // Both workers edit the SAME file at the SAME line → rebase conflict.
    const repoRoot = makeTempDir('pool-')
    const config = createReviewLoopConfigFixture(repoRoot, { poolSize: 2 })
    const runState = await createRunState(config, path.join(repoRoot, 'plan.md'))
    await setupPrimary(repoRoot, runState.runId, runState.worktreePath)

    // Add same.txt to primary worktree so workers inherit a common baseline.
    mkdirSync(path.join(runState.worktreePath, 'src'), { recursive: true })
    writeFileSync(path.join(runState.worktreePath, 'src/same.txt'), 'baseline\n')
    await execGit(runState.worktreePath, ['add', '.'])
    await execGit(runState.worktreePath, ['commit', '-m', 'add same.txt'])

    const pool = await createWorkerPool(config, runState)
    const w1 = await pool.acquire('src/same.txt')
    // worker-2 while worker-1 is busy with same file
    const w2 = await pool.acquire('src/same.txt')
    writeFileSync(path.join(w1.worktreePath, 'src/same.txt'), 'w1 edit\n')
    await execGit(w1.worktreePath, ['add', '.'])
    await execGit(w1.worktreePath, ['commit', '-m', 'w1'])
    await pool.mergeWorkerIntoPrimary(w1)
    pool.release(w1)
    writeFileSync(path.join(w2.worktreePath, 'src/same.txt'), 'w2 conflicting edit\n')
    await execGit(w2.worktreePath, ['add', '.'])
    await execGit(w2.worktreePath, ['commit', '-m', 'w2'])
    const result = await pool.mergeWorkerIntoPrimary(w2)
    expect(result.ok).toBe(false)
    expect(getConflictFiles(result)).toEqual(['src/same.txt'])
    pool.release(w2)
    await pool.close()
  })
})
