// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { stdoutLines } from './git-commit.js'
import type { GitFn } from './git-commit.js'
import { GitError, issueNumberFromBranch } from './git.js'

/**
 * Bringing a local agent branch back in step with a remote that moved while a
 * phase was running.
 *
 * Split from `git.ts` when the reconciling push pushed that file past
 * `max-lines`, along the seam `git-revert.ts` already cut: everything left in
 * `git.ts` is about *addressing* a repository, while this is about what a
 * push must do before it can succeed when the branch is shared. The value
 * imports point back at `git.ts` for `GitError` and `issueNumberFromBranch`,
 * the same back-import `deps.ts` carries from the module it was split from —
 * safe because neither side dereferences the other while either module is
 * still evaluating, only inside function bodies called much later.
 */
/**
 * Brings a local agent branch up to date with a remote that advanced while a
 * phase was running, so the push that follows is a fast-forward again.
 *
 * Run 32374999214 is what this exists for: a maintainer pushed merge
 * `1f7ce71b` to `agent/issue-305` three hours into a review loop, and every
 * later pipeline push was rejected non-fast-forward — the branch had been
 * fetched exactly once, at `ensureBranch`, and nothing between that and the
 * push looked at the remote again. Five review fixes died with the runner and
 * the run parked in `FAILED` inviting a `/retry` that re-runs the whole loop.
 *
 * Three shapes the branch rules out. **Merge, never rebase:** the branch is
 * shared with humans by design (the incident's maintainer commit is itself a
 * merge of an agent fix), a rebase would rewrite commits the review loop's
 * `primary` branch shares history with, and a force-push discards human work.
 * **Fetch-first, every time:** `ensureBranch` fetches once at phase entry and
 * a review loop then runs for hours, so "the remote moved" is not an edge
 * case on this timescale but the ordinary thing that happens. **Nothing to
 * reconcile is not an error:** a fetch that finds no remote branch is a first
 * push, and the plain push that follows reports any genuine failure better
 * than a reconcile invented one.
 *
 * Only agent branches (`agent/issue-<n>`, per {@link issueNumberFromBranch})
 * reconcile — the base branch `ARCHIVE` pushes has sharing rules of its own
 * and keeps the plain push it always had.
 */
export const reconcile = async (git: GitFn, gitOrThrow: GitFn, branch: string): Promise<void> => {
  if (issueNumberFromBranch(branch) === null) return

  const remote = `refs/remotes/origin/${branch}`
  // The explicit refspec, rather than `git fetch origin <branch>`, because the
  // two reads below address `refs/remotes/origin/<branch>` and FETCH_HEAD is
  // not that ref.
  const fetched = await git('fetch', 'origin', `+refs/heads/${branch}:${remote}`)
  if (fetched.exitCode !== 0) return

  // Exit 0 = the remote tip is already contained here; 1 = it is not. Asked
  // without throwing because exit 1 is the answer this reads, not a failure.
  const ancestor = await git('merge-base', '--is-ancestor', remote, 'HEAD')
  if (ancestor.exitCode === 0) return

  // The merge makes a commit, so it needs the committer identity — a hosted
  // runner has no `user.name` anywhere, and an identity-less merge fails on a
  // config file rather than on the branch this is about. It rides the
  // environment `makeRunners` sets on every git child (`git.ts`).
  const merged = await git('merge', '--no-edit', remote)
  if (merged.exitCode === 0) return

  // Every failure path aborts the merge, so the tree is never left mid-merge
  // whatever else went wrong — the same try/finally `mergeWorktree` in
  // `review-loop/` proves out on its own merges.
  try {
    const conflict = `${merged.stdout}\n${merged.stderr}`.includes('CONFLICT')
    if (!conflict) throw new GitError(merged)

    const conflicted = stdoutLines((await gitOrThrow('diff', '--name-only', '--diff-filter=U')).stdout)
    throw new GitError({
      ...merged,
      stderr:
        `cannot reconcile with ${remote}, which advanced mid-run: conflicts in ${conflicted.join(', ')}. ` +
        'Resolve by hand and push again.',
    })
  } finally {
    await git('merge', '--abort')
  }
}
