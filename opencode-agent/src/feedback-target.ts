// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AgentState } from './types.js'

/**
 * Where a run talks to a maintainer, and where a maintainer talks back.
 *
 * The issue is the conversation until there is a diff to look at. After that the
 * pull request is: it carries the branch, the checks, the review threads and the
 * merge button, and an issue whose work is all in a pull request is a page nobody
 * has a reason to open. So the moment `prNumber` exists, the **live** channels
 * move — the status comment and the labels — and the commands that drive the
 * agent are accepted there and refused here.
 *
 * What does **not** move is the record. `AGENT_STATE` and `AGENT_REPORT` live in
 * hidden blocks on the **issue**, `findLatestState` restores by scanning that one
 * thread, and a block posted on a pull request would be a second source of truth
 * the scan cannot see — so every report, every failure notice and every state
 * block still goes to the issue, whichever surface the command arrived on. The
 * split is deliberate and is the reason this is a two-function module rather than
 * one `target()` everything reads: "where does this run *speak*" and "where does
 * this run *remember*" are different questions, and the day they are answered by
 * one function is the day a state block lands on a pull request.
 */

/**
 * The number every live feedback channel writes against — the pull request once
 * one exists, the issue before that.
 *
 * One number for both, because GitHub's issue endpoints serve pull requests
 * too: labels, comments and reactions on a pull request are the same API as on
 * an issue, which is what makes moving the channel a matter of the number alone.
 */
export const feedbackTarget = (state: AgentState): number => state.prNumber ?? state.issueId

/** The two human surfaces a command can be typed on. */
export type CommandOrigin = 'issue' | 'pull-request'

/**
 * Whether a command typed here is this run's to act on.
 *
 * `elsewhere` is not a refusal of the *command* — it is a statement about the
 * surface, and the reply says where to type it again. That distinction matters
 * to the reader: `/retry` on a delivered issue is a perfectly good command in the
 * wrong place, and telling somebody their command "does not apply right now"
 * when it does is how a maintainer concludes the agent is broken.
 */
export const commandSurface = (state: AgentState, origin: CommandOrigin): 'accepted' | 'elsewhere' => {
  if (state.prNumber === null) return 'accepted'
  return origin === 'pull-request' ? 'accepted' : 'elsewhere'
}
