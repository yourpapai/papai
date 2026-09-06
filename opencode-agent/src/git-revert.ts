// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { commit, stdoutLines } from './git-commit.js'
import type { GitFn } from './git-commit.js'
import type { GitOptions } from './git.js'
import { protectedPathsNotice } from './protected-paths.js'

/**
 * Taking a change back out once it is already a commit.
 *
 * Split from `git-commit.ts` when it would not fit there, along a seam worth
 * having: everything in that file decides what a commit this pipeline is about
 * to make may *contain*, and can enforce it by unstaging, because it runs
 * between `git add --all` and the commit. This is the same rule arriving too
 * late — the review loop commits in a worktree of its own and merges, so by the
 * time the pipeline sees those files they are history, and the only way to take
 * one out is to put its old content back and commit that.
 */
/**
 * Undoes `paths` back to their content at `sha`, as one further commit.
 *
 * The other half of {@link stageAllowed}, for changes that are already commits.
 * That one runs between `git add --all` and the commit and can simply unstage;
 * by the time the review loop's fixes reach this pipeline they are merged
 * history, so the only way to take a file back out is to put its old content
 * back and commit that.
 *
 * The tracked/new split is the same one `stageAllowed` makes and for the same
 * reason: `checkout` restores a file that existed at `sha`, and there is nothing
 * to restore for one the loop created — that one is removed. `ls-tree` lists
 * only what `sha` actually had, so it partitions the two without a failing call.
 *
 * `--no-verify`, deliberately. The repository's pre-commit hook runs its checks
 * over the staged files, and this commit's whole content is a *reversion* — it
 * is not new work and has nothing to prove. A hook that refused it would leave
 * the branch carrying exactly the file the push cannot take, which is the one
 * outcome this exists to prevent.
 */
export const revertPaths = async (
  gitOrThrow: GitFn,
  options: GitOptions,
  sha: string,
  paths: readonly string[],
): Promise<void> => {
  if (paths.length === 0) return

  const tracked = stdoutLines((await gitOrThrow('ls-tree', '--name-only', sha, '--', ...paths)).stdout)
  const added = paths.filter((path) => !tracked.includes(path))

  if (tracked.length > 0) await gitOrThrow('checkout', sha, '--', ...tracked)
  if (added.length > 0) await gitOrThrow('rm', '--force', '--', ...added)

  await commit(gitOrThrow, revertMessage(paths), ['--no-verify'])
  options.log.warn({ reverted: [...paths] }, protectedPathsNotice(paths))
}

const revertMessage = (paths: readonly string[]): string =>
  [
    'chore(agent): revert changes this pipeline cannot push',
    '',
    `A review round changed ${paths.join(', ')}, which a push from this token is refused for.`,
    'Reverted here so the rest of the round can be delivered; apply it by hand if it is wanted.',
  ].join('\n')
