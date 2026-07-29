// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

interface GitOutput {
  stdout: string
  stderr: string
  error: Error | null
}

function runGit(cwd: string, args: string[]): Promise<GitOutput> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ stdout, stderr, error: err })
    })
  })
}

export async function execGit(cwd: string, args: readonly string[]): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr, error } = await runGit(cwd, [...args])
  if (error !== null) {
    throw error
  }
  return { stdout, stderr }
}

export async function detectGitRoot(cwd: string): Promise<string> {
  const { stdout } = await execGit(cwd, ['rev-parse', '--show-toplevel'])
  return stdout.trim()
}

export async function createWorktree(repoRoot: string, worktreePath: string, runId: string): Promise<void> {
  const parentDir = path.dirname(worktreePath)
  if (!existsSync(parentDir)) {
    await mkdir(parentDir, { recursive: true })
  }
  await execGit(repoRoot, ['worktree', 'add', worktreePath, '-b', `review-loop/${runId}`])
}

export function worktreeExists(worktreePath: string): boolean {
  return existsSync(worktreePath)
}

export async function worktreeIsDirty(worktreePath: string): Promise<boolean> {
  const { stdout } = await execGit(worktreePath, ['status', '--porcelain'])
  return stdout.trim().length > 0
}

export async function resetWorktree(worktreePath: string): Promise<void> {
  await execGit(worktreePath, ['reset', '--hard', 'HEAD'])
  await execGit(worktreePath, ['clean', '-fd'])
}

export async function resetWorktreeTo(worktreePath: string, sha: string): Promise<void> {
  await execGit(worktreePath, ['reset', '--hard', sha])
  await execGit(worktreePath, ['clean', '-fd'])
}

export type MergeResult = { ok: true } | { ok: false; conflictFiles: string[] }

/**
 * Merges `branchName` into the current branch of `repoRoot`.
 *
 * On conflict, aborts the merge so the caller's worktree is left clean and
 * returns the list of conflicted paths. Mirrors the contract of `rebaseOnto`.
 * The caller can then surface an actionable error with file names and recovery
 * commands instead of crashing with raw git stderr and leaving the user's repo
 * half-merged.
 */
export async function mergeWorktree(repoRoot: string, branchName: string): Promise<MergeResult> {
  const { stdout, stderr, error } = await runGit(repoRoot, ['merge', branchName, '--no-edit'])
  if (error !== null) {
    const combined = `${stdout}\n${stderr}`
    if (combined.includes('CONFLICT')) {
      // try/finally ensures `merge --abort` runs even if listUnmergedPaths
      // throws (e.g. corrupted index). Without this, a thrown diff leaves the
      // user's repo mid-merge with conflict markers in the working tree.
      try {
        const conflictFiles = await listUnmergedPaths(repoRoot)
        return { ok: false, conflictFiles }
      } finally {
        await runGit(repoRoot, ['merge', '--abort'])
      }
    }
    // Defensive cleanup: git may have started merging before failing for a
    // non-conflict reason (e.g. local dirty index). Mirror the conflict branch
    // so we never leave the worktree mid-merge. runGit never throws, so the
    // original error below still propagates.
    await runGit(repoRoot, ['merge', '--abort'])
    throw error
  }
  return { ok: true }
}

export async function removeWorktree(repoRoot: string, worktreePath: string, runId: string): Promise<void> {
  if (existsSync(worktreePath)) {
    await execGit(repoRoot, ['worktree', 'remove', worktreePath, '--force'])
  }
  try {
    await execGit(repoRoot, ['branch', '-D', `review-loop/${runId}`])
  } catch {
    // Branch may not exist if already merged and deleted
  }
}

export async function rebaseOnto(
  repoRoot: string,
  ontoRef: string,
  branch: string,
): Promise<{ ok: true } | { ok: false; conflictFiles: string[] }> {
  const { stdout, stderr, error } = await runGit(repoRoot, ['rebase', ontoRef, branch])
  // git rebase prints conflicts to stdout, errors to stderr
  const combined = `${stdout}\n${stderr}`
  if (error !== null) {
    if (combined.includes('CONFLICT') || combined.includes('could not apply')) {
      // try/finally ensures `rebase --abort` runs even if listUnmergedPaths
      // throws (e.g. corrupted index). Without this, a thrown diff leaves the
      // worker stuck mid-rebase, poisoning every subsequent issue assignment.
      try {
        const conflictFiles = await listUnmergedPaths(repoRoot)
        return { ok: false, conflictFiles }
      } finally {
        await runGit(repoRoot, ['rebase', '--abort'])
      }
    }
    // Defensive cleanup: git may have started replaying commits before failing
    // for a non-conflict reason (e.g. transient FS error). Mirror the conflict
    // branch so we never leave the worktree mid-rebase. runGit never throws,
    // so the original error below still propagates.
    await runGit(repoRoot, ['rebase', '--abort'])
    throw error
  }
  return { ok: true }
}

async function listUnmergedPaths(repoRoot: string): Promise<string[]> {
  const { stdout } = await execGit(repoRoot, ['diff', '--name-only', '--diff-filter=U'])
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

export async function mergeFastForward(repoRoot: string, branch: string): Promise<string> {
  await execGit(repoRoot, ['merge', '--ff-only', branch])
  // The new HEAD SHA is on the line starting with "Updating" or we re-read it
  const head = await execGit(repoRoot, ['rev-parse', 'HEAD'])
  return head.stdout.trim()
}

export async function cleanWorkerWorktrees(repoRoot: string, runId?: string): Promise<void> {
  // Remove stale worker worktrees (and their branches) left over from prior crashed runs.
  // With a runId (resume), only workers tagged with that run are removed, so concurrent
  // runs sharing a repo are not disturbed. Without a runId (fresh start), every worktree
  // whose basename contains "-worker-" is swept — any such worktree existing before the
  // pool is constructed is stale. The basename check avoids matching a parent directory
  // whose path happens to contain "worker".
  const { stdout } = await execGit(repoRoot, ['worktree', 'list', '--porcelain'])
  const lines = stdout.split('\n')
  const staleWorktrees: string[] = []
  for (const line of lines) {
    if (line.startsWith('worktree ')) {
      const wtPath = line.slice('worktree '.length)
      const isStaleWorker =
        runId === undefined ? path.basename(wtPath).includes('-worker-') : wtPath.includes(`${runId}-worker-`)
      if (isStaleWorker) staleWorktrees.push(wtPath)
    }
  }
  // Remove sequentially via a promise chain: `git worktree remove`/`branch -D` take repo-wide
  // locks, so running them concurrently races and intermittently fails under load (see closePool).
  let chain: Promise<unknown> = Promise.resolve()
  for (const wtPath of staleWorktrees) {
    chain = chain.then(() => removeWorktree(repoRoot, wtPath, path.basename(wtPath)).catch(() => undefined))
  }
  await chain
}
