// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Octokit } from '@octokit/rest'

/**
 * The reaction half of the GitHub surface.
 *
 * Split out of `github.ts` the day the delete half arrived and pushed that file
 * past `max-lines`, along the seam `github-labels.ts` already found: reactions
 * are one endpoint family with semantics none of the other calls have. Each of
 * them exists in two forms addressed by different paths, the create is
 * idempotent while the delete is not, and — unlike a comment or a pull request
 * body — none of them carries free text, so the redaction `github.ts` applies at
 * its boundary has nothing to do here.
 *
 * That last point is the exemption stated rather than implied: a content is a
 * member of {@link ReactionContent}, a four-value union this pipeline picks
 * from, and a reaction id is a number it read back off GitHub. Neither has
 * anywhere for a credential to hide.
 *
 * Nothing here is best-effort. A rejection is reported to the caller like any
 * other, because "a failed reaction must never fail a run" is a decision about
 * the pipeline and lives in `feedback.ts`, at the one door to this API.
 */

/**
 * The reactions this pipeline places, as a closed union rather than free text.
 *
 * That closure is what exempts it from `clean`. Outbound redaction exists
 * because a comment body is assembled from check output, git stderr, review
 * summaries and model prose, and any of those can carry a credential; a value
 * drawn from four literals the pipeline picks itself has nowhere for one to
 * hide. It is the same exemption the `head`/`base` branch names take in
 * `PullRequestInput` — computed by the pipeline, so passed through untouched —
 * and it is stated rather than implied, because "a new `GitHubApi` method that
 * sends free text must redact it" is a rule a silent exception erodes.
 */
export type ReactionContent = 'eyes' | '+1' | 'confused' | 'rocket'

/**
 * What a reaction lands on.
 *
 * One discriminated shape rather than an `addIssueReaction` and an
 * `addCommentReaction`: the two REST endpoints differ only in the path segment
 * they address — `issues/{n}/reactions` against `issues/comments/{id}/reactions`
 * — and the callers all hold one id or the other without caring which endpoint
 * that makes it. Two methods would put that mapping in every call site.
 */
export type ReactionTarget = { kind: 'issue'; number: number } | { kind: 'comment'; id: number }

/**
 * A reaction that exists on GitHub, by the id needed to take it off again.
 *
 * {@link ReactionApi.addReaction} returns this rather than `void` because the
 * delete endpoints are addressed by reaction id and nothing else — there is no
 * "remove my 👀 from this comment" call. The acknowledgement 👀 is placed at the
 * top of a run and removed at the bottom, so the id has to survive the whole
 * pipeline, and the only place it can come from is the response that created it.
 */
export interface ReactionRef {
  id: number
}

export interface ReactionApi {
  /**
   * Places one reaction and returns it. Rejects like any other call —
   * `feedback.ts` owns the rule that a rejection here can never fail a run,
   * because that is a decision about the pipeline, not about the transport.
   *
   * Idempotent server-side: a repeated reaction returns the existing one, so no
   * caller has to record what it has already placed — and the id that comes back
   * is the same one, so removing it removes the reaction either call created.
   */
  addReaction(target: ReactionTarget, content: ReactionContent): Promise<ReactionRef>
  /**
   * Takes one reaction back off, by the id {@link ReactionApi.addReaction}
   * returned.
   *
   * Deletes are **not** idempotent the way the create is: a second call answers
   * 404. That is not this layer's problem — like every other rejection here it
   * goes up to `feedback.ts`, which degrades it to a `warn` — but it is why no
   * caller should treat a rejection as evidence the reaction is still there.
   */
  removeReaction(target: ReactionTarget, reaction: ReactionRef): Promise<void>
}

interface RepoRef {
  owner: string
  repo: string
}

/** Routes to whichever of the two create endpoints the target names. */
const addReaction = async (
  octokit: Octokit,
  repo: RepoRef,
  target: ReactionTarget,
  content: ReactionContent,
): Promise<ReactionRef> => {
  if (target.kind === 'comment') {
    const { data } = await octokit.rest.reactions.createForIssueComment({ ...repo, comment_id: target.id, content })
    return { id: data.id }
  }
  const { data } = await octokit.rest.reactions.createForIssue({ ...repo, issue_number: target.number, content })
  return { id: data.id }
}

/**
 * The delete half, routed by the same discriminant and wrong in the same way if
 * it is not: issue 42 and comment 42 are two different things, so a delete aimed
 * at the wrong endpoint takes an emoji off a stranger's comment in some other
 * issue entirely.
 */
const removeReaction = async (
  octokit: Octokit,
  repo: RepoRef,
  target: ReactionTarget,
  reaction: ReactionRef,
): Promise<void> => {
  if (target.kind === 'comment') {
    await octokit.rest.reactions.deleteForIssueComment({ ...repo, comment_id: target.id, reaction_id: reaction.id })
    return
  }
  await octokit.rest.reactions.deleteForIssue({ ...repo, issue_number: target.number, reaction_id: reaction.id })
}

/** Builds the reaction endpoints against an already-authenticated Octokit. */
export const createReactionEndpoints = (octokit: Octokit, repo: RepoRef): ReactionApi => ({
  addReaction: (target, content): Promise<ReactionRef> => addReaction(octokit, repo, target, content),
  removeReaction: (target, reaction): Promise<void> => removeReaction(octokit, repo, target, reaction),
})
