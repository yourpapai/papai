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

const BRANCH_PATTERN = /^agent\/issue-(\d+)$/u

/**
 * Recovers the issue number from a branch the pipeline owns; `null` for any
 * other branch. This is the only link from a CI event — which knows a branch
 * but not an issue — back to the conversation that started the work.
 */
export const issueNumberFromBranch = (branch: string): number | null => {
  const match = BRANCH_PATTERN.exec(branch)
  if (match === null) return null

  const raw = match[1]
  if (raw === undefined) return null

  const parsed = Number.parseInt(raw, 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

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
  /** The remote's default branch, or `null` when the checkout cannot tell. */
  defaultBranch(): Promise<string | null>
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

const LOCAL_HEAD = /^origin\/(\S+)$/u
const REMOTE_HEAD = /^ref:\s+refs\/heads\/(\S+)\s+HEAD$/mu

const captured = (pattern: RegExp, text: string): string | null => {
  const match = pattern.exec(text.trim())
  return match?.[1] ?? null
}

/**
 * Asks the checkout which branch the remote considers default.
 *
 * Two probes, because neither alone is enough: `origin/HEAD` is a local ref
 * that `git clone` writes but `actions/checkout` does not, so it is routinely
 * missing on a runner; `ls-remote` always knows but costs a round trip. Try the
 * free one, fall back to the authoritative one, and report `null` rather than a
 * guess when both fail — the caller turns that into an error naming the
 * override.
 */
const defaultBranch = async (git: GitFn): Promise<string | null> => {
  const local = await git('symbolic-ref', '--short', 'refs/remotes/origin/HEAD')
  const fromLocal = local.exitCode === 0 ? captured(LOCAL_HEAD, local.stdout) : null
  if (fromLocal !== null) return fromLocal

  const remote = await git('ls-remote', '--symref', 'origin', 'HEAD')
  return remote.exitCode === 0 ? captured(REMOTE_HEAD, remote.stdout) : null
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
    defaultBranch: () => defaultBranch(git),
  }
}
