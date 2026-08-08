// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { inspectStaged, measure, parseNumstat } from './diff-guard.js'
import type { DiffLimits, StagedTotals } from './diff-guard.js'
import { diffGuardError } from './errors.js'
import type { CommandResult, CommandRunner } from './shell.js'

export interface GitOptions {
  run: CommandRunner
  cwd: string
  /** Identity stamped on agent commits. */
  authorName: string
  authorEmail: string
  /** Ceilings a staged change set must stay under before it is committed. */
  limits: DiffLimits
  /** Credential values that must never reach a commit, whatever file holds them. */
  secrets: readonly string[]
  /**
   * How git authenticates to the remote, or `null` for an anonymous checkout.
   *
   * Supplied per invocation instead of persisted, so the token is in no file the
   * model can read. See {@link credentialEnv}.
   */
  credential: GitCredential | null
}

export interface GitCredential {
  /** Remote base the header applies to, e.g. `https://github.com/`. */
  remote: string
  token: string
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
  /**
   * Commits every change; resolves `null` when the tree was already clean.
   *
   * That return is the only "did anything change?" answer the pipeline needs —
   * a separate probe would just be a second `git status` reading the same tree.
   * It carries **how much** changed for the same reason: the guard measures the
   * index between `git add --all` and the commit, so the one figure that says
   * whether a diff is worth reviewing is already computed here, and returning it
   * costs nothing where re-deriving it later would cost a second checkout.
   */
  commitAll(message: string): Promise<StagedTotals | null>
  push(branch: string): Promise<void>
  /** The remote's default branch, or `null` when the checkout cannot tell. */
  defaultBranch(): Promise<string | null>
}

type GitFn = (...argv: readonly string[]) => Promise<CommandResult>

/**
 * Hands git its credential through the environment of each invocation.
 *
 * Three places a token must not be, and this is the only form that avoids all
 * three. **`.git/config`**: `persist-credentials: true` writes the token there
 * as an `http.<remote>.extraheader`, and the `build` profile can `read` any file
 * in the checkout — scrubbing the process environment does nothing about a file.
 * **argv**: a credential in `https://x-access-token:…@host/` or in `git -c …`
 * shows up in `/proc` and in the `GitError` message, which is published to the
 * issue. **The OpenCode server's environment**: it inherits this process's, so
 * the variables are set on the git child only, never on `process.env`.
 *
 * `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_0` / `GIT_CONFIG_VALUE_0` is git's own
 * mechanism for exactly this (git ≥ 2.31); verified against git 2.43 that the
 * value is honoured, is never written to `.git/config`, and is invisible to a
 * later `git config --get` without the environment.
 */
export const credentialEnv = (credential: GitCredential | null): Record<string, string> | undefined => {
  if (credential === null) return undefined

  const basic = Buffer.from(`x-access-token:${credential.token}`).toString('base64')
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: `http.${credential.remote}.extraheader`,
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
  }
}

const makeRunners = (options: GitOptions): { git: GitFn; gitOrThrow: GitFn } => {
  const env = credentialEnv(options.credential)
  const git: GitFn = (...argv) => options.run(['git', ...argv], { cwd: options.cwd, env })

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

/**
 * Checks what `git add --all` actually staged, unstages it if the answer is
 * unacceptable, and reports the size of what it let through.
 *
 * Measured after staging rather than before: `--numstat` on the index lists
 * every file individually, including the untracked ones that
 * `status --porcelain` collapses into a single directory entry — which is
 * precisely how a whole `node_modules` reads as one line.
 *
 * The totals come from a second `measure` over the same array `inspectStaged`
 * judged, rather than from widening `DiffVerdict` to carry them: `measure` is a
 * fold over an array already in hand, so the two calls cannot disagree, and a
 * verdict that answered "yes, and here are the numbers" would make every caller
 * that only wants the yes narrow past them.
 */
const guardStaged = async (gitOrThrow: GitFn, options: GitOptions): Promise<StagedTotals> => {
  const staged = parseNumstat((await gitOrThrow('diff', '--cached', '--numstat')).stdout)
  const diff = (await gitOrThrow('diff', '--cached')).stdout

  const verdict = inspectStaged(staged, diff, options.limits, options.secrets)
  if (!verdict.ok) {
    // Leave the tree as it was found. A retry lands on a fresh runner in the
    // normal case, but a half-staged index is a poor thing to hand anyone.
    await gitOrThrow('reset')
    throw diffGuardError(verdict.reason)
  }

  const { files, lines } = measure(staged)
  return { files, lines }
}

const commitAll = async (gitOrThrow: GitFn, options: GitOptions, message: string): Promise<StagedTotals | null> => {
  const status = await gitOrThrow('status', '--porcelain')
  if (status.stdout.trim().length === 0) return null

  await gitOrThrow('add', '--all')
  const totals = await guardStaged(gitOrThrow, options)
  await gitOrThrow(
    '-c',
    `user.name=${options.authorName}`,
    '-c',
    `user.email=${options.authorEmail}`,
    'commit',
    '-m',
    message,
  )
  return totals
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
    push: async (branch) => {
      await gitOrThrow('push', '-u', 'origin', branch)
    },
    defaultBranch: () => defaultBranch(git),
  }
}
