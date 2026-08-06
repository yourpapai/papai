// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { CommandResult, CommandRunner } from './shell.js'

export interface GitOptions {
  run: CommandRunner
  cwd: string
  /** Identity stamped on agent commits. */
  authorName: string
  authorEmail: string
}

/** Branch name the pipeline owns for a given issue. */
export const branchNameFor = (issueNumber: number): string => `agent/issue-${issueNumber}`

export class GitError extends Error {
  readonly result: CommandResult

  constructor(result: CommandResult) {
    super(`git failed (${result.exitCode}): ${result.command}\n${result.stderr.trim()}`)
    this.name = 'GitError'
    this.result = result
  }
}

/** Git operations the pipeline performs, each returning plain data. */
export interface Git {
  ensureBranch(branch: string, base: string): Promise<void>
  hasChanges(): Promise<boolean>
  /** Commits every change; resolves `false` when the tree was already clean. */
  commitAll(message: string): Promise<boolean>
  push(branch: string): Promise<void>
  currentSha(): Promise<string>
}

type GitFn = (...argv: readonly string[]) => Promise<CommandResult>

const makeRunners = (options: GitOptions): { git: GitFn; gitOrThrow: GitFn } => {
  const git: GitFn = (...argv) => options.run(['git', ...argv], { cwd: options.cwd })

  const gitOrThrow: GitFn = async (...argv) => {
    const result = await git(...argv)
    if (result.exitCode !== 0) throw new GitError(result)
    return result
  }

  return { git, gitOrThrow }
}

/**
 * Checks out `branch`, reusing the remote branch when the pipeline has already
 * pushed one for this issue — a retry must continue the same branch rather than
 * silently discarding the earlier attempt's commits.
 */
const ensureBranch = async (git: GitFn, gitOrThrow: GitFn, branch: string, base: string): Promise<void> => {
  await gitOrThrow('fetch', 'origin', base)

  const remote = await git('rev-parse', '--verify', `refs/remotes/origin/${branch}`)
  if (remote.exitCode === 0) {
    await gitOrThrow('fetch', 'origin', branch)
    await gitOrThrow('checkout', '-B', branch, `origin/${branch}`)
    return
  }

  await gitOrThrow('checkout', '-B', branch, `origin/${base}`)
}

const commitAll = async (gitOrThrow: GitFn, options: GitOptions, message: string): Promise<boolean> => {
  const status = await gitOrThrow('status', '--porcelain')
  if (status.stdout.trim().length === 0) return false

  await gitOrThrow('add', '--all')
  await gitOrThrow(
    '-c',
    `user.name=${options.authorName}`,
    '-c',
    `user.email=${options.authorEmail}`,
    'commit',
    '-m',
    message,
  )
  return true
}

export const createGit = (options: GitOptions): Git => {
  const { git, gitOrThrow } = makeRunners(options)

  return {
    ensureBranch: (branch, base) => ensureBranch(git, gitOrThrow, branch, base),
    commitAll: (message) => commitAll(gitOrThrow, options, message),
    hasChanges: async () => {
      const result = await gitOrThrow('status', '--porcelain')
      return result.stdout.trim().length > 0
    },
    push: async (branch) => {
      await gitOrThrow('push', '-u', 'origin', branch)
    },
    currentSha: async () => {
      const result = await gitOrThrow('rev-parse', 'HEAD')
      return result.stdout.trim()
    },
  }
}
