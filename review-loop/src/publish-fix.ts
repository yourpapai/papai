// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ReviewLoopConfig } from './config.js'
import type { ProgressReporter } from './progress-log.js'
import type { WorkerPoolHooks } from './worker-pool.js'
import { mergeWorktree, type MergeResult } from './worktree.js'

/**
 * Making one fix visible outside the loop, the moment it lands.
 *
 * The loop's ordinary shape is atomic: every fix accumulates on
 * `review-loop/<runId>`, and `finalizeRun` merges that branch into the checkout
 * once, at the very end, behind the build gate. On a laptop that is exactly
 * right — an interrupted run leaves the user's branch untouched and the loop's
 * own branch is still there to merge by hand.
 *
 * In CI neither half of that holds. The checkout is deleted when the job ends,
 * so a branch nobody pushed is a branch nobody will ever see again; and the job
 * ends for reasons the loop does not get a say in — a runner taken away, a
 * cancelled build, a wall clock. A red build gate has the same effect for a
 * different reason: `finalizeRun` throws before the merge, and an hour of
 * accepted, individually build-checked fixes goes with it.
 *
 * So `mergeEachFix` moves the merge forward to each fix, and this is what it
 * does with one: fast-forward the checkout onto the loop's branch and say so on
 * stdout. Saying so is half the point — the pipeline driving this loop reads the
 * marker and pushes, because the credential that can reach the remote belongs to
 * it and must never be visible to a subprocess whose children the model controls.
 *
 * Nothing here throws. Every failure it can meet is one `finalizeRun` will meet
 * again at the end with the whole picture in view, and a fix that could not be
 * published early is not a fix that failed.
 */

/**
 * The line the caller matches on. Kept in step with `FIX_MERGED_MARKER` in
 * `opencode-agent/src/review-runner.ts` — two spellings of one contract, each
 * with a test standing on its own side of the pipe.
 */
export const FIX_PUBLISHED_MARKER = '[review-loop] published'

export interface PublishFixDeps {
  repoRoot: string
  /** The loop's own branch, which the checkout is fast-forwarded onto. */
  branch: string
  merge: (repoRoot: string, branch: string) => Promise<MergeResult>
  /** The progress channel. `event` prints in non-TTY mode, which CI always is. */
  log: { event: (message: string) => void }
}

/**
 * Everything the pool reports back to a run: the merge diff, its warnings, and
 * — only when the config asks for it — publishing each fix.
 *
 * Assembled here rather than at the `createWorkerPool` call site because that is
 * where the decision lives: the default is the atomic merge at the end, which is
 * what a run somebody is watching should do to their working branch.
 */
export function poolHooks(config: ReviewLoopConfig, log: ProgressReporter): WorkerPoolHooks {
  return {
    onMergeDiff: (workerId, diff) => {
      log.diff?.(`worker-${workerId}`, diff)
    },
    warn: (message) => {
      log.event(message)
    },
    onPrimaryAdvanced: config.mergeEachFix
      ? (branch): Promise<void> => publishFix({ repoRoot: config.repoRoot, branch, merge: mergeWorktree, log })
      : undefined,
  }
}

export async function publishFix(deps: PublishFixDeps): Promise<void> {
  try {
    const result = await deps.merge(deps.repoRoot, deps.branch)
    if (!result.ok) {
      deps.log.event(
        `[review-loop] could not publish the fix: ${deps.branch} conflicts with the checkout (${result.conflictFiles.join(', ')})`,
      )
      return
    }
    deps.log.event(`${FIX_PUBLISHED_MARKER} fix to the working branch from ${deps.branch}`)
  } catch (error) {
    deps.log.event(`[review-loop] could not publish the fix: ${error instanceof Error ? error.message : String(error)}`)
  }
}
