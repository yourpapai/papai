// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { commit, stdoutLines } from './git-commit.js'
import type { GitFn } from './git-commit.js'
import { GitError } from './git.js'

/**
 * Merging the base branch into the agent branch — the git half of `/sync`.
 *
 * A separate module rather than more rows in `git-commit.ts`, along the seam
 * `git-revert.ts` already drew: that file decides what a commit the pipeline
 * *authored* may contain, and enforces it by unstaging. A `/sync` merge is not
 * an authored change set — it is base's own already-reviewed content arriving
 * by merge — so `stageAllowed`, the diff-guard caps and protected-path dropping
 * are not "skipped" here; they answer a question this path never asked.
 * Dropping base's `.github/workflows/` edits at staging would silently
 * un-merge them, which is the one outcome `/sync` exists to prevent.
 */

/**
 * What merging `origin/<base>` into the current branch came to.
 *
 * Values rather than a throw for the conflict, because a conflict is an
 * *outcome* the sync handler plans around — bounded repair rounds, an abort on
 * exhaustion — and not an error it catches. `commits` on the clean branch is
 * how many commits base was ahead, which is the figure the reply reports.
 */
export type MergeOutcome =
  | { kind: 'clean'; commits: number }
  | { kind: 'up-to-date' }
  | { kind: 'conflicted'; paths: string[] }

/**
 * Merges `origin/<base>` into the current branch.
 *
 * A clean merge (fast-forward included) is committed here with this pipeline's
 * own identity — a runner configures no git user, so a bare `git merge` would
 * die on *committer identity unknown*. Both identity halves ride the
 * environment `makeRunners` sets on every git child (`git.ts`), which outranks
 * any config a runner could carry. A conflicted merge is left mid-merge
 * on purpose — the conflicted paths go back to the handler, which drives
 * repair rounds against the marked files and finishes through
 * {@link completeMerge} or unwinds through {@link abortMerge}.
 *
 * A non-zero merge that staged no conflicts is **not** a conflicted outcome —
 * it is a merge git refused for another reason (untracked files it would
 * overwrite, a missing object), and it is thrown so the sync handler reports a
 * broken run rather than repairing a conflict that does not exist.
 */
export const mergeBase = async (git: GitFn, gitOrThrow: GitFn, base: string): Promise<MergeOutcome> => {
  await gitOrThrow('fetch', 'origin', base)
  const ref = `origin/${base}`

  const ahead = Number.parseInt((await gitOrThrow('rev-list', '--count', `HEAD..${ref}`)).stdout.trim(), 10)
  if (ahead === 0) return { kind: 'up-to-date' }

  const merged = await git('merge', '--no-edit', ref)
  if (merged.exitCode === 0) return { kind: 'clean', commits: ahead }

  const paths = stdoutLines((await git('diff', '--name-only', '--diff-filter=U')).stdout)
  if (paths.length === 0) throw new GitError(merged)
  return { kind: 'conflicted', paths }
}

/**
 * Completes a conflicted merge the repair rounds resolved.
 *
 * `--no-verify` for the reason `revertPaths` carries it: the tree being
 * committed is base's own reviewed content plus a marker resolution, not new
 * work seeking admission to the branch — a repository hook that refused it
 * would leave the merge half-done on a runner about to die, and the push itself
 * is what CI judges. Identity rides the environment `makeRunners` sets on every
 * git child (`git.ts`), as on every commit.
 */
export const completeMerge = async (gitOrThrow: GitFn, message: string): Promise<void> => {
  // The repair turn edited the marked files in the working tree and is
  // forbidden git, so the resolution is still unstaged. Staging here is the
  // pipeline's half of the doctrine: the model edits, the pipeline commits.
  await gitOrThrow('add', '--all')
  await commit(gitOrThrow, message, ['--no-verify'])
}

/** Abandons a conflicted merge, leaving the tree exactly as it entered it. */
export const abortMerge = (gitOrThrow: GitFn): Promise<void> => gitOrThrow('merge', '--abort').then(() => undefined)
