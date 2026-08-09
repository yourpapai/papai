// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { withDeadline } from './deadline.js'
import { isTurnDeadline, serverGoneError, turnDeadlineError } from './errors.js'
import type { Logger } from './logger.js'
import { withHeartbeat } from './progress.js'
import type { ProgressSnapshot, ProgressTracker } from './progress.js'
import type { SdkPromptBody } from './sdk-contract.js'
import { errorMessage } from './types.js'

/**
 * Running **one** model turn: bounding it, reporting on it while it is
 * outstanding, and saying how it ended.
 *
 * Split from `opencode-adapter.ts` when the failure classification would not fit
 * beside the session wiring, along a seam that file already had. The adapter owns
 * a *session* — a server, a session id, a lifetime, a teardown — and this owns a
 * *turn*, which is the thing that has a clock, a heartbeat and three ways to end.
 * They change for different reasons: the adapter on a lifecycle question, this one
 * when the pipeline learns something new about how a turn dies.
 *
 * The two interfaces below are narrow on purpose. `OpenCodeAgentOptions` and
 * `OpenCodeConnection` extend them, so this module never imports back from the one
 * it was split out of, and each states exactly what running a turn requires —
 * which is a much smaller claim than "an agent".
 */

/**
 * How often a turn says it is still alive.
 *
 * A minute is short enough that a stalled job is obvious within one screen of
 * log, and long enough that a twenty-minute implement phase adds twenty lines
 * rather than swamping the tool calls that carry the real information.
 */
const DEFAULT_HEARTBEAT_MS = 60_000

/** What a turn needs to know about its own clock and where it reports. */
export interface TurnBounds {
  /**
   * Upper bound on one model turn, from `AGENT_TIMEOUT_MS` shrunk to fit the job.
   * Omitted means unbounded, which only a caller with nothing to bound should want —
   * config range-checks that variable to at least a second.
   *
   * Every subprocess this pipeline drives already had one — the check runner and
   * the review loop both pass it to `runCommand` — and the in-process session,
   * the one turn that can run for twenty minutes, was the only path without.
   *
   * A **function** is the form that matters, and a number is kept only for callers
   * with a fixed bound. The session is memoized for the whole job and the bound is
   * derived from the job's remaining clock, so a number is read once — when the
   * server first boots — and every later turn in that job carries a bound sized for a
   * clock that has since moved. That was survivable while a job ran one turn per
   * phase; with one turn per plan step it is the silence this bound exists to
   * prevent, because a step starting six minutes before the runner's own
   * `timeout-minutes` would be handed the thirty-minute cap and killed with the job.
   * Resolved per turn in {@link bounded}, so the bound tracks the resource it protects.
   */
  timeoutMs?: number | (() => number)
  /** Where progress goes. The adapter is the only thing that can see it. */
  log: Logger
  /** Heartbeat period while a turn is outstanding. `0` disables it. */
  heartbeatMs?: number
  /**
   * Where each heartbeat goes besides the log.
   *
   * The adapter is the only layer that can see a turn in flight, and the live
   * status comment on the issue is the only surface a maintainer has a link to
   * — so the snapshot has to be handed out from here or the two never meet.
   * Optional because most runs have nowhere to send it: a local `--event-path`
   * run has no status comment at all.
   */
  onTick?: (snapshot: ProgressSnapshot) => void
}

/**
 * The two calls one turn makes: the turn itself, and the question its failure
 * raises.
 */
export interface TurnConnection {
  sendPrompt(sessionId: string, body: SdkPromptBody): Promise<unknown>
  /**
   * Whether the server is still there at all, asked of the transport.
   *
   * The same endpoint `usage` calls, deliberately, and a different question —
   * which is why it is a second method rather than a reading of the first. `usage`
   * asks *what the server says* and answers `null` for a payload it does not
   * recognise; this asks *whether anything answered*, and only a rejection is a
   * `false`. Collapsing them loses exactly the distinction issue #239 needed: a
   * `null` usage was the evidence the server had died, and it is indistinguishable
   * from a shape the decoder has not been taught.
   *
   * Required rather than optional, for the reason `events` and `abort` are on the
   * connection this one is a slice of.
   */
  alive(sessionId: string): Promise<boolean>
}

/** This turn's bound: asked afresh when the caller supplied a way to ask. */
const turnBound = (bounds: TurnBounds): number => {
  const timeout = bounds.timeoutMs ?? 0
  return typeof timeout === 'function' ? timeout() : timeout
}

/**
 * The bound and the heartbeat, in the one order that works.
 *
 * Heartbeat outside the deadline, never inside it: a deadline that fires leaves
 * the underlying call pending, so an inner heartbeat's cleanup would never run
 * and its interval would hold the process open past the end of the job.
 */
const bounded = (work: Promise<unknown>, bounds: TurnBounds, tracker: ProgressTracker): Promise<unknown> =>
  withHeartbeat(
    // The snapshot is read *at the rejection*, not when the bound was armed: what
    // the phase needs to report is what the turn had managed by the time it was
    // stopped, and this is the last frame that can still see the tracker.
    //
    // The bound itself is read here, per turn, for the reason `timeoutMs` may be a
    // function: a job now runs a turn per plan step, and a bound derived from the
    // job's remaining clock has to be asked again each time or it stops tracking it.
    withDeadline(work, turnBound(bounds), (elapsed) => turnDeadlineError(elapsed, tracker.snapshot())),
    {
      everyMs: bounds.heartbeatMs ?? DEFAULT_HEARTBEAT_MS,
      log: bounds.log,
      snapshot: tracker.snapshot,
      onTick: bounds.onTick,
    },
  )

/**
 * Runs one turn and, when it breaks, says whether the server it was talking to is
 * still there.
 *
 * The probe runs **only on the failure path**, so a healthy run pays nothing for
 * it, and it asks a question that stops being answerable seconds later: this
 * pipeline closes the server in `runCli`'s `finally`, so by the time a failure has
 * been rendered into a comment there is nothing left to ask.
 *
 * Three orderings here are each load-bearing. A turn deadline leaves before the
 * probe, because it is the one rejection a phase branches on and a ceiling
 * relabelled as a crash throws away finished steps. A probe that **rejects** is
 * read as `false` rather than propagated — a refused connection is the strongest
 * evidence there is that the server is gone, and letting it escape would replace
 * the failure it was asked about with a footnote. And an ordinary failure over a
 * server that still answers is returned untouched, because a rate limit reported
 * as a dead server is a worse lie than the bare socket message this replaces.
 *
 * Not a retry, and it must not become one: the one layer that may retry is
 * `provider-proxy.ts`, which is the only one that still has an HTTP status.
 */
export const runTurn = async (
  connection: TurnConnection,
  sessionId: string,
  body: SdkPromptBody,
  bounds: TurnBounds,
  tracker: ProgressTracker,
): Promise<unknown> => {
  try {
    return await bounded(connection.sendPrompt(sessionId, body), bounds, tracker)
  } catch (error) {
    if (isTurnDeadline(error)) throw error

    const alive = await connection.alive(sessionId).catch(() => false)
    if (alive) throw error

    bounds.log.error({ sessionId }, 'The OpenCode server stopped answering; the turn died with it')
    throw serverGoneError(errorMessage(error))
  }
}
