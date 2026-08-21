// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { DiffLimits } from './diff-guard.js'
import { commitAll, salvageAll } from './git-commit.js'
import type { CommitOutcome, GitFn, Salvage } from './git-commit.js'
import { abortMerge, completeMerge, mergeBase } from './git-merge.js'
import type { MergeOutcome } from './git-merge.js'
import { revertPaths } from './git-revert.js'
import type { Logger } from './logger.js'
import type { CommandResult, CommandRunner } from './shell.js'

// Re-exported so callers keep naming one module for "what git does here".
export type { MergeOutcome } from './git-merge.js'

// Re-exported so callers keep naming one module for git's vocabulary.
export type { Salvage } from './git-commit.js'

export interface GitOptions {
  run: CommandRunner
  cwd: string
  authorName: string
  authorEmail: string
  committerName?: string
  committerEmail?: string
  limits: DiffLimits
  secrets: readonly string[]
  log: Logger
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
   * Force-resets `branch` to `base`, discarding any prior commits on it (D12).
   *
   * Used by the capture scaffold: a restarted issue whose `agent/issue-<n>`
   * branch already carries partial legacy work must start from zero, not adopt
   * the old diff. Force-pushes so the remote reflects the reset — then the
   * scaffold's own commit and push are an ordinary fast-forward from base.
   */
  resetBranchToBase(branch: string, base: string): Promise<void>
  /**
   * Deletes the remote branch (D9 cancel cleanup). A mis-capture's branch +
   * change folder are the work being undone; `git push origin --delete` removes
   * them from the remote. The local checkout dies with the job.
   */
  deleteRemoteBranch(branch: string): Promise<void>
  /**
   * Commits every change, as one of the three outcomes in {@link CommitOutcome}.
   *
   * That return is the only "did anything change?" answer the pipeline needs —
   * a separate probe would just be a second `git status` reading the same tree.
   * It carries **how much** changed for the same reason: the guard measures the
   * index between `git add --all` and the commit, so the one figure that says
   * whether a diff is worth reviewing is already computed here, and returning it
   * costs nothing where re-deriving it later would cost a second checkout.
   *
   * It also carries **what it could not carry**. This used to be
   * `StagedTotals | null`, where `null` meant both "the tree was already clean"
   * and "everything the turn wrote is a file the remote refuses" — and a caller
   * with one bit reported the second as the first. That is run 31779566286: two
   * CI-fix rounds whose only edit was `.github/workflows/agent-pipeline.yml`,
   * each announcing "nothing changed", until the pull request's `ciAttempts`
   * budget was spent on a branch nothing had touched.
   */
  commitAll(message: string): Promise<CommitOutcome>
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
  /**
   * The commit the checkout is on.
   *
   * The one question `commitAll` cannot answer: it reports what *this process*
   * staged, and the review loop commits and merges through git of its own — so
   * to the pipeline its findings look like a clean tree with nothing to do. Two
   * reads either side of the loop are what tell "the loop found nothing" from
   * "the loop found plenty and it is all sitting unpushed on a runner about to
   * be deleted".
   */
  headSha(): Promise<string>
  /**
   * Paths the commits between `sha` and `HEAD` touched — the review loop's own
   * question, since nothing this process staged describes what the loop merged.
   */
  changedSince(sha: string): Promise<string[]>
  /**
   * Restores `paths` to their content at `sha` and commits that — the staging
   * guard's move for a change that is already history. See `git-revert.ts`.
   */
  revertPaths(sha: string, paths: readonly string[]): Promise<void>
  /** Merges `origin/<base>` in — the `/sync` operation. See `git-merge.ts`. */
  mergeBase(base: string): Promise<MergeOutcome>
  /** Commits a conflicted merge the repair rounds resolved. */
  completeMerge(message: string): Promise<void>
  /** Abandons a conflicted merge, leaving a clean tree. */
  abortMerge(): Promise<void>
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
  const credential = credentialEnv(options.credential)
  const authorEnv = { GIT_AUTHOR_NAME: options.authorName, GIT_AUTHOR_EMAIL: options.authorEmail }
  const env = credential === undefined ? authorEnv : { ...credential, ...authorEnv }
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
    resetBranchToBase: async (branch, base) => {
      await gitOrThrow('fetch', 'origin', base)
      // `-B` force-resets the local branch to `origin/<base>`, discarding any
      // prior commits on it — restart means from zero (D12).
      await gitOrThrow('checkout', '-B', branch, `origin/${base}`)
      // Force-push so the remote reflects the reset; the scaffold's own push is
      // then an ordinary fast-forward.
      await gitOrThrow('push', '--force', '-u', 'origin', branch)
    },
    deleteRemoteBranch: (branch) =>
      // `--delete` is idempotent against a branch that was never pushed: a
      // pre-capture `/cancel` has no branch to remove, and a missing ref is not
      // an error this pipeline needs to surface.
      gitOrThrow('push', 'origin', '--delete', branch).then(
        () => undefined,
        () => undefined,
      ),
    commitAll: (message) => commitAll(gitOrThrow, options, message),
    salvageAll: (message) => salvageAll(gitOrThrow, options, message),
    push: async (branch, pushOptions) => {
      const verify = pushOptions?.noVerify === true ? ['--no-verify'] : []
      await gitOrThrow('push', ...verify, '-u', 'origin', branch)
    },
    defaultBranch: () => defaultBranch(git),
    headSha: () => gitOrThrow('rev-parse', 'HEAD').then((result) => result.stdout.trim()),
    changedSince: (sha) =>
      gitOrThrow('diff', '--name-only', `${sha}..HEAD`).then((result) =>
        result.stdout
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0),
      ),
    revertPaths: (sha, paths) => revertPaths(gitOrThrow, options, sha, paths),
    mergeBase: (base) => mergeBase(git, gitOrThrow, options, base),
    completeMerge: (message) => completeMerge(gitOrThrow, options, message),
    abortMerge: () => abortMerge(gitOrThrow),
  }
}
