// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { GitHubApi, ReactionContent, ReactionTarget } from './github.js'
import type { TriggerEvent } from './guardrails.js'
import type { Logger } from './logger.js'
import { errorMessage } from './types.js'

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
 * Places a reaction, and swallows every way that can fail.
 *
 * The `catch` is the whole point of the function, not defensive padding: it is
 * what makes the rule above true at the only place it can be enforced, and it is
 * why no caller is allowed to reach for `deps.github.addReaction` directly.
 */
export const react = async (deps: ReactionDeps, trigger: TriggerEvent, content: ReactionContent): Promise<void> => {
  const target = reactionTarget(trigger)
  if (target === null) return

  try {
    await deps.github.addReaction(target, content)
    deps.log.debug({ target, content }, 'Reacted to the trigger')
  } catch (error) {
    deps.log.warn({ target, content, error: errorMessage(error) }, 'Could not react to the trigger')
  }
}
