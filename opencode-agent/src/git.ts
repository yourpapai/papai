// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { DiffLimits, StagedTotals } from './diff-guard.js'
import { commitAll, salvageAll } from './git-commit.js'
import type { GitFn, Salvage } from './git-commit.js'
import type { CommandResult, CommandRunner } from './shell.js'

// Re-exported so every caller keeps naming one module for "what git does here";
// it is declared next to the commit that produces it.
export type { Salvage } from './git-commit.js'

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
  /**
   * The same commit for a tree a wall-clock stop is trying to keep: hooks
   * bypassed, size caps demoted to a report, secrets and binaries still refused.
   *
   * A separate operation rather than a flag on {@link commitAll}, and the return
   * type is the argument. A flag would have one function answer three questions at
   * once — did anything change, was it acceptable, and was it merely large — with
   * `StagedTotals | null` and a throw as the only vocabulary, so a caller could not
   * tell "nothing was written yet" from "a credential was staged" without reading
   * an error message. Both of those are ordinary outcomes on this path and each
   * gets a different sentence on the issue, so they are values: see {@link Salvage}.
   * The two also differ in what a failure *means* — `commitAll` throwing is a run
   * that broke, and this refusing is a run that was already out of time.
   */
  salvageAll(message: string): Promise<Salvage>
  push(branch: string, options?: PushOptions): Promise<void>
  /** The remote's default branch, or `null` when the checkout cannot tell. */
  defaultBranch(): Promise<string | null>
}

export interface PushOptions {
  /**
   * Skip the repository's own `pre-push` hook.
   *
   * A flag here where the commit is a whole operation, because a push has nothing
   * else to say: there is no verdict, no measurement and no third outcome — only
   * whether the hooks run. Mandatory on the salvage path for the same reason
   * `--no-verify` is on the commit: this repository's `prepare` script installs a
   * hook that runs lint, typecheck and format over the staged files, and a tree
   * interrupted mid-edit fails all three.
   */
  noVerify?: boolean
}

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
    salvageAll: (message) => salvageAll(gitOrThrow, options, message),
    push: async (branch, pushOptions) => {
      const verify = pushOptions?.noVerify === true ? ['--no-verify'] : []
      await gitOrThrow('push', ...verify, '-u', 'origin', branch)
    },
    defaultBranch: () => defaultBranch(git),
  }
}
