// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import type { ReviewLoopConfig } from './config.js'
import type { RunState } from './run-state.js'
import { execGit, rebaseOnto, mergeFastForward, removeWorktree } from './worktree.js'

export interface Worker {
  readonly id: number
  readonly worktreePath: string
  readonly branch: string
  busy: boolean
  lockedFiles: ReadonlySet<string>
  headSha(): Promise<string>
  resetToBaseline(sha: string): Promise<void>
}

export interface WorkerPool {
  acquire(primaryFile: string): Promise<Worker>
  release(worker: Worker): void
  mergeWorkerIntoPrimary(worker: Worker): Promise<{ ok: true } | { ok: false; conflictFiles: string[] }>
  primaryHead(): Promise<string>
  primaryWorktreePath: string
  primaryBranch: string
  close(): Promise<void>
}

interface PoolInternals {
  workers: Worker[]
  waiters: Array<() => void>
  primaryMutex: Promise<void>
}

function peersTouchFile(internals: PoolInternals, worker: Worker, file: string): boolean {
  for (const w of internals.workers) {
    if (w === worker || !w.busy) continue
    if (w.lockedFiles.has(file)) return true
  }
  return false
}

function selectWorker(internals: PoolInternals, primaryFile: string): Worker | null {
  const free = internals.workers.filter((w) => !w.busy)
  if (free.length === 0) return null
  const safe = free.find((w) => !peersTouchFile(internals, w, primaryFile)) ?? free[0]!
  safe.busy = true
  safe.lockedFiles = new Set([primaryFile])
  return safe
}

async function waitForRelease(internals: PoolInternals): Promise<void> {
  await new Promise<void>((resolve) => {
    internals.waiters.push(resolve)
  })
}

async function tryAcquire(internals: PoolInternals, primaryFile: string): Promise<Worker> {
  const worker = selectWorker(internals, primaryFile)
  if (worker !== null) return worker
  await waitForRelease(internals)
  return tryAcquire(internals, primaryFile)
}

function releaseWorker(internals: PoolInternals, worker: Worker): void {
  worker.busy = false
  worker.lockedFiles = new Set()
  const next = internals.waiters.shift()
  if (next !== undefined) next()
}

function withPrimaryLock<T>(internals: PoolInternals, fn: () => Promise<T>): Promise<T> {
  let release!: () => void
  const next = new Promise<void>((r) => {
    release = r
  })
  const prev = internals.primaryMutex
  internals.primaryMutex = next
  return prev.then(() => fn()).finally(release)
}

function mergeWorkerIntoPrimary(
  internals: PoolInternals,
  primaryWorktreePath: string,
  primaryBranch: string,
  worker: Worker,
): Promise<{ ok: true } | { ok: false; conflictFiles: string[] }> {
  return withPrimaryLock(internals, async () => {
    const rebase = await rebaseOnto(worker.worktreePath, primaryBranch, worker.branch)
    if (!rebase.ok) return { ok: false, conflictFiles: rebase.conflictFiles }
    await mergeFastForward(primaryWorktreePath, worker.branch)
    return { ok: true }
  })
}

function primaryHead(internals: PoolInternals, primaryWorktreePath: string): Promise<string> {
  return withPrimaryLock(internals, () =>
    execGit(primaryWorktreePath, ['rev-parse', 'HEAD']).then((r) => r.stdout.trim()),
  )
}

async function closePool(internals: PoolInternals, primaryWorktreePath: string): Promise<void> {
  await Promise.all(
    internals.workers.map((w) =>
      removeWorktree(primaryWorktreePath, w.worktreePath, w.branch.replace('review-loop/', '')),
    ),
  )
  internals.workers.length = 0
}

function createWorker(id: number, worktreePath: string, branch: string): Worker {
  return {
    id,
    worktreePath,
    branch,
    busy: false,
    lockedFiles: new Set(),
    headSha: () => execGit(worktreePath, ['rev-parse', 'HEAD']).then((r) => r.stdout.trim()),
    resetToBaseline: async (sha: string) => {
      await execGit(worktreePath, ['reset', '--hard', sha])
      await execGit(worktreePath, ['clean', '-fdx', '-e', '.review-loop'])
    },
  }
}

async function buildWorkers(
  config: ReviewLoopConfig,
  runState: RunState,
  primaryWorktreePath: string,
  primaryBranch: string,
  primarySha: string,
): Promise<Worker[]> {
  const workers: Worker[] = []
  const createTasks: Array<() => Promise<void>> = []
  for (let i = 1; i <= config.poolSize; i++) {
    const id = i
    const worktreePath = path.join(config.workDir, 'worktrees', `${runState.runId}-worker-${id}`)
    const branch = `${primaryBranch}-worker-${id}`
    const worker = createWorker(id, worktreePath, branch)
    workers.push(worker)
    createTasks.push(async () => {
      await execGit(primaryWorktreePath, ['worktree', 'add', worktreePath, '-b', branch, primarySha])
    })
  }
  await Promise.all(createTasks.map((task) => task()))
  return workers
}

export async function createWorkerPool(config: ReviewLoopConfig, runState: RunState): Promise<WorkerPool> {
  const primaryBranch = `review-loop/${runState.runId}`
  const primaryWorktreePath = runState.worktreePath
  const primarySha = (await execGit(primaryWorktreePath, ['rev-parse', 'HEAD'])).stdout.trim()

  const internals: PoolInternals = {
    workers: await buildWorkers(config, runState, primaryWorktreePath, primaryBranch, primarySha),
    waiters: [],
    primaryMutex: Promise.resolve(),
  }

  return {
    primaryWorktreePath,
    primaryBranch,

    acquire: (primaryFile: string) => tryAcquire(internals, primaryFile),

    release: (worker: Worker) => {
      releaseWorker(internals, worker)
    },

    mergeWorkerIntoPrimary: (worker: Worker) =>
      mergeWorkerIntoPrimary(internals, primaryWorktreePath, primaryBranch, worker),

    primaryHead: () => primaryHead(internals, primaryWorktreePath),

    close: () => closePool(internals, primaryWorktreePath),
  }
}
