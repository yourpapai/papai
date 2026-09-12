// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { DiffLimits } from './diff-guard.js'
import type { CommitOutcome, Salvage } from './git-commit.js'
import type { MergeOutcome } from './git-merge.js'
import type { Logger } from './logger.js'
import type { CommandResult } from './shell.js'

/**
 * The vocabulary of what git does here: the operations interface and the shapes
 * around it.
 *
 * Split from `git.ts` when the `/sync` merge operations and the reconciling
 * push together pushed that file past `max-lines` — the split that file's own
 * history had already made three times (`git-commit.ts`, `git-revert.ts`,
 * `git-reconcile.ts`, `git-merge.ts`), each along the same seam: `git.ts` is
 * about *addressing* a repository and wiring the runners, and every split-out
 * module is about one thing a commit or a push must do. The interface is the
 * contract all of them are written against, so it stands alone here and
 * `git.ts` re-exports every name — callers keep naming one module, the same
 * arrangement as `phase-names.ts` and `types.ts`.
 */

export interface GitOptions {
  run: import('./shell.js').CommandRunner
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

export class GitError extends Error {
  readonly result: CommandResult

  constructor(result: CommandResult) {
    super(`git failed (${result.exitCode}): ${result.command}\n${result.stderr.trim()}`)
    this.name = 'GitError'
    this.result = result
  }
}

/** Options for {@link Git.ensureBranch}. */
export interface EnsureBranchOptions {
  /**
   * Stand on the branch even when its dependency manifests differ from base.
   *
   * `/sync` passes this: a drifted branch is the condition it exists to repair,
   * so the drift refusal would block the remedy behind the very drift it names.
   * Every other caller takes the refusal — see `git-drift.ts`.
   */
  allowDependencyDrift?: boolean
}

/** Git operations the pipeline performs, each returning plain data. */
export interface Git {
  ensureBranch(branch: string, base: string, options?: EnsureBranchOptions): Promise<void>
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
  /**
   * Merges a remote agent branch that advanced since this checkout last
   * fetched it, so the next push is a fast-forward again. A no-op when the
   * remote has not moved or holds no such branch; a conflict aborts the merge
   * and throws naming the conflicted paths. See `git-reconcile.ts`.
   */
  reconcile(branch: string): Promise<void>
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
   * The patch `sha`..HEAD carries for `paths` — the diff the review push guard
   * is about to revert, captured before the revert destroys it so the phase's
   * report can hand it to a maintainer. Empty when no requested path moved.
   */
  diffSince(sha: string, paths: readonly string[]): Promise<string>
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
