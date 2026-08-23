// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { isDependencyDrift, isRetryFutile } from './errors.js'
import type { MachineInput } from './phase-context.js'
import { postAndAppend, postAnswer } from './run-post.js'
import { renderAnswerFailure, renderFailure } from './run-report.js'
import type { RunResult } from './run-result.js'
import { recordSpend } from './token-budget.js'
import { transition } from './transitions.js'
import { errorMessage } from './types.js'

/**
 * Where the cascade parks a run that broke, and what it says about it.
 *
 * Split from `orchestrator.ts` when that file reached its length limit, along
 * the seam `token-budget.ts` already sits on: the orchestrator decides *which*
 * handler runs next, and a module beside it decides what a state that cannot go
 * on is left looking like. These two are the failure half of that, and they
 * belong together because the whole point of having two is the difference
 * between them — a broken phase parks the issue, a broken answer must not.
 */

/**
 * Records the failure on the issue and parks the state in FAILED with
 * `resumeFrom` set, so `/retry` re-enters the exact phase that broke instead of
 * replaying the whole pipeline.
 *
 * Through `recordSpend`, exactly as the success path is. A failing phase spends
 * what it spent — the model turn is paid for long before the parse that rejects
 * its reply — and this used to write `lastError` and nothing else, so the tokens
 * went unrecorded and the next runner read `0`. That is the one path the ceiling
 * most needs to see: the state it parks in is `FAILED`, and `/retry` out of
 * `FAILED` is how an issue comes back for another expensive round.
 */
export const failRun = async (input: MachineInput, error: unknown): Promise<RunResult> => {
  const { state, deps, thread } = input
  const message = errorMessage(error)
  deps.log.error({ issue: state.issueId, phase: state.phase, error: message }, 'Phase handler failed')

  // A drift refusal is the one failure that starts nothing: the guard fires at
  // the branch switch, before any work, so `attempts` is carried rather than
  // spent — the over-budget stop's doctrine, for the same reason. Spending one
  // would let the retry gate refuse the `/retry` the drift remedy ends in, and
  // every blind `/retry` the old footer invited would burn budget on a
  // condition no retry can change.
  const failed = transition(
    state,
    'FAILED',
    await recordSpend(input, {
      lastError: message,
      ...(isDependencyDrift(error) ? { attempts: state.attempts } : {}),
    }),
  )
  const report = renderFailure(
    state.phase,
    message,
    failed,
    deps.config.maxAttempts,
    deps.config.runUrl,
    isRetryFutile(error),
  )
  await postAndAppend(thread, input, report, failed)

  // The comment above is what the workflow's fallback step would otherwise
  // duplicate, contradicting it: this run has moved the issue to `FAILED`, so
  // "the issue state is unchanged" is false the moment `postAndAppend` returns.
  return { status: 'failed', reason: message, state: failed, reported: true }
}

/**
 * Reports a failed answer without moving the machine, and without spending an
 * attempt.
 *
 * A question is a side conversation about work that lives elsewhere: the phase
 * records where the *work* is, so parking a delivered pull request or an
 * in-flight implementation in FAILED because a model turn about it broke is a
 * lie about what happened. In COMPLETE it was not even reachable — the FAILED
 * guard in `canTransition` refuses that move — so {@link failRun}'s own
 * `transition` threw and took the whole runner with it.
 *
 * The retry budget is left alone for the same reason: `attempts` counts
 * consecutive failures to make progress on the issue, and a question makes
 * none either way. Leaving `resumeFrom` alone is what makes the notice honest.
 * Answering in a waiting phase used to record `resumeFrom: 'DESIGN_SPEC'`, and
 * the `/retry` the failure comment invited then resumed into a phase with no
 * handler and re-parked with "Parked in `DESIGN_SPEC`" — one attempt poorer for
 * a round trip that did nothing.
 *
 * Moving nothing is not the same as recording nothing, which is the distinction
 * this path missed: it posted the restored state verbatim, so a question that
 * reached the model and then failed on a deadline or a rejected request handed
 * the next job a total with that turn missing from it. The spend is the one
 * thing a failed answer really does change, and it is written the way every
 * other state block writes it — see {@link recordSpend}.
 */
export const failAnswer = async (input: MachineInput, error: unknown): Promise<RunResult> => {
  const { state, deps, thread } = input
  const message = errorMessage(error)
  deps.log.error({ issue: state.issueId, phase: state.phase, error: message }, 'Answering a question failed')

  const carried = { ...state, ...(await recordSpend(input)) }
  // Where the question was asked, like the answer itself: a maintainer watching
  // a pull request for a reply must not be left with silence because the apology
  // went to a page they are not reading.
  await postAnswer(thread, input, renderAnswerFailure(state.phase, message), carried)

  return { status: 'failed', reason: message, state: carried, reported: true }
}
