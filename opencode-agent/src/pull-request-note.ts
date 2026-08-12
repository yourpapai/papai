// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { unreachable } from './errors.js'
import type { GitHubApi } from './github.js'
import type { Logger } from './logger.js'
import type { TriggerEvent } from './trigger-events.js'
import { errorMessage } from './types.js'

/**
 * The note back onto the pull request — the one thing this pipeline says where
 * a `/review` was typed rather than where it answers.
 *
 * The asymmetry it closes is deliberate and stays: state lives in hidden blocks
 * on the **issue** and the restore scan reads the issue thread, so the report
 * and the state block go there whichever door the command came through. What
 * the maintainer sees on the pull request is a 👀 on their comment and,
 * eventually, new commits — and neither of those says whether the loop found
 * anything, or whether it exited red. This channel is the pointer that closes
 * that loop, and nothing more: it is deliberately not a second copy of the
 * report, because two accounts of one run are two things that can disagree.
 *
 * The same three rules the reaction, label and status channels are built on.
 *
 * **Feedback must never fail a run.** {@link noteReview} is the only function
 * here that talks to GitHub and it swallows everything, so a caller reaches the
 * same `RunResult` and the same persisted state it would have reached with this
 * channel absent. The accepted cost is the one `labels.ts` states: a bug in here
 * degrades to exactly the same `warn` as a 403, so the test that asserts the
 * write is what stands in for the crash that no longer happens.
 *
 * **A note is not a report.** `RunResult.reported` means the issue carries this
 * run's account of what happened, and the workflow's fallback comment is gated
 * on it. This comment is on the *pull request*, which the fallback comment
 * neither reads nor could reach — so marking a run reported from here would
 * suppress the one comment that explains a silence on the issue. Like
 * `StatusReporter.finish`, {@link noteReview} takes no result and returns
 * nothing: the flag is unreachable from this module rather than merely left
 * alone by habit.
 *
 * **It needs no new endpoint.** `createComment` addresses an issue and a pull
 * request alike — GitHub's `issues/{n}/comments` serves both — which is also why
 * the body goes out through the same door as every other comment and is redacted
 * in `github.ts` at the boundary, with nothing here to remember.
 */

export interface PullRequestNoteDeps {
  /** Narrower than `PhaseDeps`, the way `ReactionDeps` and `LabelDeps` are. */
  github: Pick<GitHubApi, 'createComment'>
  log: Logger
}

/** The short account a note carries. */
export interface ReviewNote {
  /** The issue the full report and the state block went to. */
  issueNumber: number
  /**
   * The report's own one-line verdict on the loop, handed over rather than
   * re-derived.
   *
   * `REVIEW_LINE` in `phases/review.ts` is the single table over `ReviewOutcome`
   * and stays there with the report that owns it; a second mapping here would be
   * the defect this workspace keeps closing — one table read twice cannot
   * disagree with itself, two tables eventually do.
   */
  verdict: string
  /** Whether the loop's findings became commits. */
  applied: boolean
}

/**
 * Which pull request a note for this trigger belongs on, or `null` for none.
 *
 * Decided from the **trigger kind**, not from the phase, and that is the whole
 * of when this channel fires: a `/review` typed on the issue must draw no note,
 * because the report is already where that person is reading and a pointer to
 * the page they are on is noise. The phase cannot answer that — `CODE_REVIEW` is
 * reached identically through both doors — so asking it would put a note on
 * every review.
 *
 * A `switch` rather than an `=== 'pull-request'` test, for the reason
 * `reactionTarget` is one: a fourth kind added later has to decide here rather
 * than inherit whichever answer the shorter spelling happened to give it.
 */
export const noteTarget = (trigger: TriggerEvent): number | null => {
  switch (trigger.kind) {
    case 'ci':
    case 'issue':
      return null
    case 'pull-request':
      // The pull request the comment was typed on, not `state.prNumber`. They
      // are the same in every ordinary run, and where they are not — a second
      // pull request opened over the agent's branch — this one is the thread the
      // person waiting is reading, which is the only thing a pointer is for. It
      // is also non-null by construction on this kind, so there is no
      // unreachable branch here to keep honest.
      return trigger.prNumber
    case 'pr-merged':
      // The archive door reports on the issue, not the pull request that
      // triggered it — the PR is closed, and the issue is where state lives.
      return null
    default:
      return unreachable(trigger)
  }
}

/**
 * Two lines: what happened, and where the rest of it is.
 *
 * The **issue**, `#n`, and never the report comment. Two reasons, and the first
 * is the load-bearing one: `handleReview` places this note before it returns,
 * and the orchestrator's `postAndAppend` posts the report after — so a link to
 * that comment would be a link to something that does not exist yet, while a
 * link to the issue is true the moment it is written. The second is that `#n` is
 * all this layer can build anyway: no repository name reaches here, and inside
 * the repository the run belongs to GitHub renders the shorthand as a link and
 * records the cross-reference on the issue for free.
 *
 * `applied` is phrased here rather than handed over rendered, unlike
 * {@link ReviewNote.verdict}: a boolean has two readings and both are written
 * out in full at the one place each is read, so there is no table to drift.
 */
const renderNote = (note: ReviewNote): string => {
  const findings = note.applied ? 'findings pushed as further commits on this branch' : 'nothing to apply'
  return [
    `🔬 Review loop: ${note.verdict} — ${findings}.`,
    '',
    `The full report is on #${note.issueNumber}, where this run keeps its state.`,
  ].join('\n')
}

/**
 * Posts the note, and swallows every way that can fail.
 *
 * The `catch` is the point of the function rather than defensive padding — it is
 * where the rule above is made true, and it is why no caller may reach for
 * `github.createComment` on a pull request itself.
 */
export const noteReview = async (deps: PullRequestNoteDeps, trigger: TriggerEvent, note: ReviewNote): Promise<void> => {
  const prNumber = noteTarget(trigger)
  if (prNumber === null) return

  try {
    await deps.github.createComment(prNumber, renderNote(note))
    deps.log.debug({ issue: note.issueNumber, pr: prNumber }, 'Noted the review on the pull request')
  } catch (error) {
    deps.log.warn(
      { issue: note.issueNumber, pr: prNumber, error: errorMessage(error) },
      'Could not note the review on the pull request; its report is on the issue either way',
    )
  }
}
