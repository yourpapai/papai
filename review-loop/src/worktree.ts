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

export async function mergeWorktree(repoRoot: string, branchName: string): Promise<void> {
  await execGit(repoRoot, ['merge', branchName, '--no-edit'])
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
