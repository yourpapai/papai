// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { react } from './feedback.js'
import { classifyComment } from './intent.js'
import type { PhaseInput } from './phase-context.js'
import { persistState } from './state-persist.js'
import { totalTokens, withinBudget } from './token-budget.js'
import { moveOrSkip, skip } from './trigger-outcome.js'
import type { TriggerOutcome } from './trigger-outcome.js'
import type { AgentState, TransitionSignal } from './types.js'

/**
 * What a plain maintainer comment — one carrying no slash command — means, and
 * what it buys.
 *
 * Split out of `triggers.ts` when acknowledging the third silent skip pushed
 * that file past `max-lines`, and split rather than squeezed because the seam
 * was already there: `triggers.ts` now owns commands and the dispatch that
 * chooses between them, this file owns reading prose. The red-CI half went the
 * same way, into `ci-trigger.ts`, for the same reason.
 *
 * Two phases classify and they want **opposite defaults**, which is why both
 * live here rather than sharing one function — see each of them.
 */

/**
 * Skips a comment the machine has nothing to do with, having said so.
 *
 * The 👍 is the only trace these paths leave anywhere but the log, and a comment
 * would be the wrong instrument: the maintainer said something the pipeline
 * correctly read as needing no action, and answering "I have decided to do
 * nothing" to every "thanks!" is the noise this channel exists to avoid. What
 * the reaction buys is the distinction that was missing — between a comment the
 * agent read and set aside, and a workflow that never fired at all.
 *
 * Used by **every** silent human-facing skip, not by some of them: the two
 * readings of "this comment asked for nothing" below, and the non-waiting-phase
 * skip in `triggers.ts`. Reacting on a subset would be this workspace's
 * recurring defect exactly — the fix that closes the instance and leaves the
 * class open — and the one left out would have been `INIT_OR_CLARIFY`, the phase
 * where a maintainer is most likely to be mid-conversation.
 */
export const readAndSkip = async (input: PhaseInput, reason: string): Promise<TriggerOutcome> => {
  await react(input.deps, input.trigger, '+1')
  const state = await recordSkippedSpend(input)

  return { state, halt: skip(state, reason), answer: false }
}

/**
 * Writes down what a skip cost, without posting.
 *
 * These are the paths that spend a model turn and then say nothing, which used
 * to mean spending it and then *recording* nothing: this pipeline persists state
 * only by posting a comment, so the classification that decided a comment needed
 * no action vanished with the runner. An issue could buy one per comment for as
 * long as anybody kept commenting, against a ceiling that never noticed.
 *
 * Here rather than in the `none` branches that pay for it, because
 * {@link readAndSkip} is where "this comment asked for nothing" is decided for
 * all three of them, and a fix that covered two would be this workspace's
 * recurring defect exactly. The paths that spent nothing cost nothing to include
 * — the total is unchanged, so there is no rewrite to issue.
 *
 * A failed rewrite reports the figure the issue actually carries, not the one
 * this run hoped to write: `persistState` is best-effort, so the alternative is
 * a `RunResult` claiming a total no reader will ever find.
 */
const recordSkippedSpend = async (input: PhaseInput): Promise<AgentState> => {
  const { deps, state, thread } = input

  const spent = await totalTokens(deps, state.tokensSpent)
  if (spent === state.tokensSpent) return state

  return (await persistState(deps, thread, { ...state, tokensSpent: spent })) ?? state
}

/**
 * Reads a plain comment as an intent, and decides first whether that reading is
 * affordable.
 *
 * Classifying costs a model turn, and it is the one turn in the pipeline that
 * posts nothing: state is persisted by posting a comment, and the `none` branch
 * below deliberately posts none — replying to every "thanks!" would be spam. The
 * ceiling is therefore asked *before* the turn rather than after it: over budget
 * there is nothing any classification could buy, since every branch here leads
 * either to a handler or to the answer path and `stopIfOverBudget` refuses both.
 * Handing the comment straight to the answer path lets that one check report it,
 * in the wording it already has, without a second stop in this layer and without
 * paying to learn what to say — otherwise a maxed-out issue keeps buying a
 * classification per comment for as long as anyone keeps commenting on it.
 *
 * A run **under** budget that classifies `none` used to leak that turn outright,
 * and no longer does: {@link readAndSkip} records the spend by rewriting the
 * state block in place instead of posting. That fix waited on an
 * `updateComment` the pipeline had no other use for; the live status comment
 * needed one anyway, so what was once the whole cost of closing this is now
 * already paid for. Every other branch folds the classification in for free,
 * because `deps.tokensUsed()` reports the whole job's session and whatever the
 * run goes on to post writes that total.
 */
export const applyIntent = async (input: PhaseInput): Promise<TriggerOutcome> => {
  const { state, trigger, deps } = input
  const body = trigger.kind === 'issue' ? trigger.commentBody : null
  if (body === null || body.trim().length === 0) return readAndSkip(input, 'Empty comment')

  const spent = await totalTokens(deps, state.tokensSpent)
  if (!withinBudget(spent, deps.config)) {
    deps.log.warn(
      { issue: state.issueId, phase: state.phase, spent, limit: deps.config.maxTokens },
      'Over budget: not paying to classify the comment',
    )
    return { state, halt: null, answer: true }
  }

  const intent = await classifyComment({ body, phase: state.phase, deps, state })
  deps.log.info({ intent, phase: state.phase }, 'Classified maintainer comment')

  if (intent === 'none') return readAndSkip(input, 'Comment needs no action')
  if (intent === 'question') return { state, halt: null, answer: true }

  const signal: TransitionSignal = intent === 'approve' ? 'APPROVED' : 'CHANGES_REQUESTED'
  return moveOrSkip(state, signal, deps, `an implied ${intent}`)
}

/**
 * Reads a plain comment that arrived while the agent is waiting for answers to
 * its own clarifying questions, and lets through everything the classifier does
 * not positively call chatter.
 *
 * This phase used to skip classification altogether and hand every comment
 * straight to triage. That is a whole triage turn — the model re-reads the
 * issue, the whole thread and the repository, then writes a fresh design spec or
 * another round of questions — bought by a "thanks", a 👍, or one maintainer's
 * aside to another while the agent waits. Cheap to say, expensive to answer.
 *
 * The fix cannot be to route this phase through {@link applyIntent}, because
 * that function's default points the wrong way here. `classifyComment` resolves
 * every failure and every ambiguity to `question`, chosen for the waiting phases
 * where answering costs one reply while re-planning discards an approved
 * artefact. There is no approved artefact in `INIT_OR_CLARIFY`, and the cost is
 * reversed: a maintainer's answer misread as a question gets *answered* instead
 * of acted on, so the agent replies about its own questions, stays parked, and
 * the maintainer has to say the same thing a second time. So the default is
 * inverted rather than borrowed — `none` is the only verdict that skips, and
 * every other reading, including the one the classifier falls back to when it
 * breaks, re-runs triage exactly as before.
 *
 * `question` is deliberately **not** admitted as a skip-to-answer, even though a
 * maintainer really can ask "why do you need that?" mid-clarification. In this
 * phase it is not a verdict: it is also the bucket a failed model call, an
 * unparsable reply and a genuinely ambiguous comment all land in, so honouring
 * it would route every one of those into an answer turn — precisely the stall
 * above, on exactly the comments least able to survive it. `none` is the one
 * reading the classifier has to actively choose, so `none` is the one that acts.
 * The price of leaving `question` out is a wasted triage turn on a real
 * mid-clarification question; the price of letting it in is a dropped answer,
 * and only the first of those is recoverable without the maintainer noticing.
 *
 * Two comments never reach the classifier at all, and both fall through to
 * triage rather than skipping. An **absent or blank** body is the
 * `issues.opened` event that starts every issue — there is no comment to read,
 * and skipping it would mean the agent never runs at all. **Over budget** is the
 * rule {@link applyIntent} sets out at length: the classifier is the one turn
 * whose spend can never be written down, so the ceiling has to stop it rather
 * than count it. Falling through costs nothing, because the cascade's own stop
 * fires before `handleTriage` and reports the ceiling on the issue — the same
 * notice a maintainer would have got anyway, one model turn cheaper.
 */
export const applyClarifyIntent = async (input: PhaseInput): Promise<TriggerOutcome> => {
  const { state, trigger, deps } = input
  const retriage: TriggerOutcome = { state, halt: null, answer: false }

  const body = trigger.kind === 'issue' ? trigger.commentBody : null
  if (body === null || body.trim().length === 0) return retriage

  const spent = await totalTokens(deps, state.tokensSpent)
  if (!withinBudget(spent, deps.config)) {
    deps.log.warn(
      { issue: state.issueId, phase: state.phase, spent, limit: deps.config.maxTokens },
      'Over budget: not paying to classify a comment while clarifying',
    )
    return retriage
  }

  const intent = await classifyComment({ body, phase: state.phase, deps, state })
  deps.log.info({ intent, phase: state.phase }, 'Classified a maintainer comment while clarifying')

  if (intent !== 'none') return retriage

  // Through {@link readAndSkip}, like the other two readings of "this comment
  // asked for nothing". They are one class, not three call sites: same reason
  // string, same silence, same person waiting — and this is the phase a
  // maintainer is *most* likely to be typing in, since it is where the agent
  // waits for answers to its own questions.
  return readAndSkip(input, 'Comment needs no action')
}
