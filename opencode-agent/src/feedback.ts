// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ReactionContent, ReactionRef, ReactionTarget } from './github-reactions.js'
import type { GitHubApi } from './github.js'
import type { TriggerEvent } from './guardrails.js'
import type { Logger } from './logger.js'
import { errorMessage } from './types.js'
import type { RunStatus } from './types.js'

/**
 * The reaction channel — the pipeline's only instant acknowledgement.
 *
 * A maintainer types `/approve` and the next thing that appears on the issue is
 * the finished artefact, up to `AGENT_TIMEOUT_MS` later; for that whole window
 * the issue is indistinguishable from one where the workflow never fired, which
 * is also a real outcome because a guardrail can drop the event. A reaction
 * costs one API call, lands on the comment the maintainer just wrote, and adds
 * nothing to the thread — so it can be placed on paths where a comment would be
 * noise, which is exactly the set of paths that were silent.
 *
 * A reaction placed here has a *lifetime*, not just a moment: the 👀 means "this
 * arrived and something is running", so a run that ends without clearing it
 * leaves a claim that outlived its truth — and since a run is one CI job, the
 * claim is left on a comment nobody will touch again. {@link settleReaction} is
 * the other end of that, and every accepted run reaches it.
 *
 * One rule governs everything here: **feedback must never fail a run.** Every
 * write in this module is decoration on work that matters, and every one of them
 * is a new way to break a pipeline that used to work — a token without
 * `issues: write`, a fork run, an org policy on reactions. So a rejection
 * degrades to a `warn` and the caller carries on to the same result and the same
 * persisted state it would have reached with no reaction channel at all.
 *
 * Placing one is deliberately *not* reporting. `RunResult.reported` means "the
 * issue carries this run's account of what happened", and the workflow's
 * fallback comment is gated on it; an emoji is not an account of anything, so no
 * caller here touches the flag.
 */

/**
 * What reacting needs.
 *
 * Narrower than `PhaseDeps` on purpose: the guardrail denial is reacted to
 * before any phase input exists, and a structural type lets that path use the
 * same function as the trigger layer without assembling one.
 */
export interface ReactionDeps {
  github: GitHubApi
  log: Logger
}

/**
 * Where a reaction for this trigger belongs, or `null` when nothing should be
 * reacted to at all.
 *
 * A CI event is the `null` case, and it is the design rather than an oversight:
 * a `workflow_run` payload names no comment, nobody typed it, and nobody is
 * waiting on an answer to it — the existing log line is the right amount of
 * record. `issues.opened` has no comment either but very much has someone
 * waiting, so it falls back to the issue itself.
 */
export const reactionTarget = (trigger: TriggerEvent): ReactionTarget | null => {
  if (trigger.kind !== 'issue') return null

  return trigger.commentId === null
    ? { kind: 'issue', number: trigger.issueNumber }
    : { kind: 'comment', id: trigger.commentId }
}

/**
 * A reaction this run placed and is therefore responsible for taking back off.
 *
 * Carries its own target rather than being re-derived from the trigger at
 * removal time: the two are the same value today, and "the thing I put it on"
 * is what a delete needs — deriving it twice is how a run removes a reaction
 * from somewhere it never placed one.
 */
export interface ReactionHandle {
  target: ReactionTarget
  reaction: ReactionRef
}

/**
 * Places a reaction, and swallows every way that can fail.
 *
 * The `catch` is the whole point of the function, not defensive padding: it is
 * what makes the rule above true at the only place it can be enforced, and it is
 * why no caller is allowed to reach for `deps.github.addReaction` directly.
 *
 * Returns a handle on success and `null` on every other outcome — nothing to
 * react to, or a write that failed — so a caller that wants to undo it later has
 * one value to hold and one thing to check, and a failed acknowledgement cannot
 * turn into a delete of somebody else's reaction.
 */
export const react = async (
  deps: ReactionDeps,
  trigger: TriggerEvent,
  content: ReactionContent,
): Promise<ReactionHandle | null> => {
  const target = reactionTarget(trigger)
  if (target === null) return null

  try {
    const reaction = await deps.github.addReaction(target, content)
    deps.log.debug({ target, content }, 'Reacted to the trigger')
    return { target, reaction }
  } catch (error) {
    deps.log.warn({ target, content, error: errorMessage(error) }, 'Could not react to the trigger')
    return null
  }
}

/**
 * What a finished run leaves on the comment that started it, by how it ended.
 *
 * The 👀 says "this arrived"; it is not an outcome, and leaving it as the only
 * mark on the comment made every finished run indistinguishable from one still
 * thinking — the acknowledgement outliving the thing it acknowledged. So the run
 * ends by replacing it.
 *
 * `completed` is deliberately `null`, and it is the one row worth arguing about.
 * A completed run is either a delivery — where `handleDeliver` has already placed
 * 🚀, the one mark in this pipeline that means a pull request came out of the
 * work — or it is a `/cancel`, or a stand-down on a branch whose pull request had
 * already merged or been closed. Nothing was delivered in those last two, and
 * marking them would either claim a delivery that did not happen or sit as a
 * second reaction beside the 🚀 of one that did. Both of them post a comment
 * saying what happened, which is the account; the reaction is not.
 *
 * `skipped` is `null` for the neighbouring reason: the skips that are a *reply*
 * to somebody — a refused command — have already reacted 😕 from `triggers.ts`,
 * and every other skip is a deliberate silence (a CI event with nobody behind
 * it, a comment the classifier read as chatter). A mark there would be the
 * pipeline talking to nobody.
 */
const OUTCOME_REACTIONS: Record<RunStatus, ReactionContent | null> = {
  completed: null,
  waiting: '+1',
  failed: 'confused',
  skipped: null,
}

/**
 * Closes the acknowledgement out: the outcome goes on, then the 👀 comes off.
 *
 * That order is deliberate. Removing first would leave the comment bare for the
 * width of an API call, and — because both writes are best-effort — a removal
 * that succeeds beside an add that fails would leave it bare for good, which is
 * worse than the 👀 this exists to clear. The other way round, the failure modes
 * degrade: at worst the comment carries both marks, and the outcome is the one a
 * reader takes their meaning from.
 *
 * Every path out of an accepted run comes through here, including the ones that
 * do nothing else, because the 👀 was placed before the run knew which path it
 * would take.
 */
export const settleReaction = async (
  deps: ReactionDeps,
  trigger: TriggerEvent,
  acknowledgement: ReactionHandle | null,
  status: RunStatus,
): Promise<void> => {
  const outcome = OUTCOME_REACTIONS[status]
  if (outcome !== null) await react(deps, trigger, outcome)

  await unreact(deps, acknowledgement)
}

/**
 * Removes a reaction this run placed, and swallows every way that can fail.
 *
 * The same door as {@link react}, for the same reason and with the same rule: a
 * 404 from a comment somebody deleted mid-run, a token that lost `issues: write`
 * between the two calls, a secondary rate limit. None of those is a reason for a
 * finished run to report failure.
 */
const unreact = async (deps: ReactionDeps, handle: ReactionHandle | null): Promise<void> => {
  if (handle === null) return

  try {
    await deps.github.removeReaction(handle.target, handle.reaction)
    deps.log.debug({ target: handle.target }, 'Removed the acknowledgement reaction')
  } catch (error) {
    deps.log.warn({ target: handle.target, error: errorMessage(error) }, 'Could not remove the acknowledgement')
  }
}
