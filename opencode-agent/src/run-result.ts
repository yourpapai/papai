// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AgentState } from './types.js'

/**
 * What one call to the pipeline concluded.
 *
 * Split out of `types.ts`, which is the state machine's vocabulary and its
 * persisted shape — a different subject from what a *run* did with them, and one
 * whose readers barely overlap: the trigger layer, the cascade, the two failure
 * paths, `step-output.ts` and the reaction channel all speak in this shape and
 * most of them never name a phase. The file reached `max-lines` when a phase
 * rename and two new state fields landed in it at once, and this was the seam
 * already drawn through the middle of it.
 */

export type RunStatus = 'skipped' | 'waiting' | 'completed' | 'failed'

/** What one call to the pipeline concluded. `state` is null when nothing ran. */
export interface RunResult {
  status: RunStatus
  reason: string
  state: AgentState | null
  /**
   * Whether this run has already said what happened on the issue itself.
   *
   * Not diagnostic — the workflow reads it. Its last step posts an "Agent job
   * failed" comment under `if: failure()`, and `failure()` selects *every* red
   * job, including the six paths that exit 1 only after posting their own
   * report: `failRun`, `failAnswer`, both over-budget stops in
   * `token-budget.ts`, `refuseExhausted` and the CI-budget notice in
   * `triggers.ts`. So every genuine failure drew a second, contradicting
   * comment — "The issue state is unchanged" beside a block that had just been
   * moved to `FAILED` or parked with a resume point, and "reply `/retry`"
   * beside a notice that had just explained why `/retry` is refused. Only the
   * CI path escaped, by accident: `github.event.issue.number` is empty on a
   * `workflow_run` event. `runCli` turns this flag into a `$GITHUB_OUTPUT`
   * marker the fallback step is gated on, so it covers what its own wording
   * claims and nothing else: a job that died with nothing on the issue at all.
   *
   * A field rather than something derived from `status` and `state`, because
   * neither says it. `failed` covers both a reported failure and a crash;
   * `skipped` covers both a silent guardrail rejection and a refused command
   * that answered on the issue.
   *
   * **Decided in one place.** Every terminal path still sets it, and inside
   * `runAccepted` every one of those values is then replaced: a run makes one
   * comment now, at the end, so whether the issue carries an account of it is a
   * fact about that single write and about nothing a phase can know. `runCli`'s
   * guardrail exit is the one that keeps its own answer, because it returns
   * before the reply buffer is ever begun. Leave the per-path values as they
   * are — they document what each path *intends* to have said, and the day a
   * second write is added they are what it would be decided from.
   */
  reported: boolean
  /**
   * The comment the run posted, when it posted one.
   *
   * `step-output.ts` publishes it so the workflow's transcript and
   * infrastructure-failure steps can edit that comment rather than adding
   * comments of their own — which is the difference between one reply per
   * command and three.
   *
   * Optional, unlike `reported`, and deliberately so: it is not a decision a
   * terminal path makes but an observation only the flush can make, so a path
   * that omits it is stating the truth rather than forgetting something.
   */
  replyCommentId?: number
}
