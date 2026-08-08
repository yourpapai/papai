// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { replaceBlock } from './blocks.js'
import type { IssueComment } from './blocks.js'
import type { GitHubApi } from './github.js'
import type { Logger } from './logger.js'
import { findLatestStateComment, STATE_MARKER } from './state-manager.js'
import { errorMessage } from './types.js'
import type { AgentState } from './types.js'

/**
 * Writing the state block down **without posting a comment**.
 *
 * This pipeline persists state only by posting, which leaves exactly one hole:
 * classifying a plain comment is a model turn, and the `none` branch of that
 * classification deliberately posts nothing — answering "I have decided to do
 * nothing" to every "thanks!" is the noise the whole feedback plan is sized to
 * avoid. So a run that spent a few thousand tokens deciding a comment needed no
 * action handed the next runner a clean slate. `comment-intent.ts` recorded that
 * leak and named this as the fix, declining it as a larger design change than
 * the tokens justified; the live status comment needed `updateComment` anyway,
 * so what was once the whole cost of the fix is now already paid for.
 *
 * Two things this has to respect, both already load-bearing:
 *
 * - **The target is the comment `findLatestState` selected**, not the newest
 *   comment in the thread. Rewriting in place keeps that comment the
 *   newest-with-a-block, so the restore scan is unaffected; rewriting any other
 *   one leaves the reader looking at the figure this call was trying to replace.
 *   Both come off {@link findLatestStateComment}, so they cannot pick differently.
 * - **The block is re-serialised through `renderBlock`**, which escapes every
 *   `<` and `>` so a payload cannot forge its own terminator. `lastError` carries
 *   compiler output verbatim and `-->` is ordinary in it, so an in-place rewrite
 *   that assembled the block itself would reintroduce that bug on a surface the
 *   original fix never touched. `replaceBlock` is the one door to that.
 *
 * And one rule borrowed from the feedback channels next door: **this must never
 * fail a run.** Failing a phase because a few thousand tokens could not be
 * written down would be a worse outcome than the leak it closes, so every way
 * this can fail degrades to a `warn` — enforced in {@link persistState}, which
 * is the only function here that talks to GitHub.
 */

export interface StatePersistDeps {
  /** Narrower than `PhaseDeps`, the way `ReactionDeps` and `LabelDeps` are. */
  github: Pick<GitHubApi, 'updateComment'>
  log: Logger
  /** The author filter the state block is read back through. */
  selfLogin: () => Promise<string>
}

/**
 * Rewrites the newest state block in place, returning the state that is now on
 * the issue — or `null` when it could not be written, so a caller reports the
 * figure the thread actually carries rather than the one it hoped for.
 */
export const persistState = async (
  deps: StatePersistDeps,
  thread: readonly IssueComment[],
  state: AgentState,
): Promise<AgentState | null> => {
  const target = findLatestStateComment(thread, await deps.selfLogin(), state.issueId)
  if (target === null) {
    // A first event on a fresh issue has no agent comment to rewrite. Nothing is
    // lost that was not already lost: there is no earlier figure to carry, and
    // the first comment this issue posts will record the total from scratch.
    deps.log.debug({ issue: state.issueId }, 'No state block to rewrite; nothing to persist')
    return null
  }

  const body = replaceBlock(target.comment.body, STATE_MARKER, state)
  if (body === null) {
    deps.log.warn({ issue: state.issueId, comment: target.comment.id }, 'The selected comment carries no state block')
    return null
  }

  try {
    await deps.github.updateComment(target.comment.id, body)
    deps.log.debug({ issue: state.issueId, comment: target.comment.id }, 'Rewrote the state block in place')
    return state
  } catch (error) {
    deps.log.warn(
      { issue: state.issueId, comment: target.comment.id, error: errorMessage(error) },
      'Could not rewrite the state block; this run’s spend is not recorded',
    )
    return null
  }
}
