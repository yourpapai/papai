// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { commitAll, salvageAll } from './git-commit.js'
import type { GitFn } from './git-commit.js'
import { assertManifestsInSync } from './git-drift.js'
import { abortMerge, completeMerge, mergeBase } from './git-merge.js'
import { reconcile } from './git-reconcile.js'
import { revertPaths } from './git-revert.js'
import { GitError } from './git-types.js'
import type { Git, GitCredential, GitOptions } from './git-types.js'

// The vocabulary every caller reaches git through, re-exported so `git.js`
// stays the one module anybody names — the arrangement `types.ts` set with
// `phase-names.ts`. Declared in `git-types.ts`, the split this file's own
// growth forced beside the four operation modules below.
export type { Git, GitCredential, GitOptions, EnsureBranchOptions, PushOptions } from './git-types.js'
export { GitError } from './git-types.js'
export type { MergeOutcome } from './git-merge.js'
export type { Salvage } from './git-commit.js'

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
  // Both identity halves ride the environment because it outranks every config
  // source: `-c user.name` loses to an ambient `GIT_COMMITTER_NAME` (a runner
  // harness exporting one would silently restamp the service identity), and a
  // hosted runner has no `user.name` anywhere to fall back to.
  const identityEnv = {
    GIT_AUTHOR_NAME: options.authorName,
    GIT_AUTHOR_EMAIL: options.authorEmail,
    GIT_COMMITTER_NAME: options.committerName ?? options.authorName,
    GIT_COMMITTER_EMAIL: options.committerEmail ?? options.authorEmail,
  }
  const env = credential === undefined ? identityEnv : { ...credential, ...identityEnv }
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
 *
 * Then refuses the checkout the job cannot serve: a branch whose dependency
 * manifests differ from `origin/<base>`, because the workflow installed
 * dependencies from base before this process ever switched trees. `/sync`
 * lifts that refusal via `allowDependencyDrift` — it is the remedy, and the
 * guard must never block its own way out. See `git-drift.ts`.
 */
const ensureBranch = async (
  git: GitFn,
  gitOrThrow: GitFn,
  branch: string,
  base: string,
  options?: import('./git-types.js').EnsureBranchOptions,
): Promise<void> => {
  await gitOrThrow('fetch', 'origin', base)

  const remote = await git('rev-parse', '--verify', `refs/remotes/origin/${branch}`)
  if (remote.exitCode === 0) {
    await gitOrThrow('fetch', 'origin', branch)
    await gitOrThrow('checkout', '-B', branch, `origin/${branch}`)
  } else {
    await gitOrThrow('checkout', '-B', branch, `origin/${base}`)
  }

  if (options?.allowDependencyDrift === true) return
  await assertManifestsInSync(gitOrThrow, branch, base)
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
    ensureBranch: (branch, base, branchOptions) => ensureBranch(git, gitOrThrow, branch, base, branchOptions),
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
    reconcile: (branch) => reconcile(git, gitOrThrow, branch),
    push: async (branch, pushOptions) => {
      // The reconcile is what makes this push able to succeed at all after a
      // human moved the branch mid-phase; on a quiet remote it costs one fetch
      // and an ancestor check.
      await reconcile(git, gitOrThrow, branch)
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
    diffSince: (sha, paths) => gitOrThrow('diff', sha, '--', ...paths).then((result) => result.stdout),
    revertPaths: (sha, paths) => revertPaths(gitOrThrow, options, sha, paths),
    mergeBase: (base) => mergeBase(git, gitOrThrow, base),
    completeMerge: (message) => completeMerge(gitOrThrow, message),
    abortMerge: () => abortMerge(gitOrThrow),
  }
}
