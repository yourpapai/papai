// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { withDeadline } from './deadline.js'
import {
  isClaudeExit,
  isClaudeResult,
  isTurnDeadline,
  isTurnStall,
  serverGoneError,
  turnDeadlineError,
  turnStallError,
} from './errors.js'
import { withHeartbeat } from './heartbeat.js'
import type { Logger } from './logger.js'
import type { ProgressTracker } from './progress.js'
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
  /**
   * The stall bound: abort a turn that has made no progress — no finished model
   * step, no newly started tool call — for this long while provider retries or
   * session errors accumulate. From `AGENT_STALL_TIMEOUT_MS`; `0` or absent
   * disables it, which is the pre-knob behaviour exactly.
   *
   * A health check beside the clock above, not a second clock: the whole-turn
   * deadline fires on elapsed time whether the provider is serving the turn or
   * not, and the incident that added this bound was four runs that burned 90
   * minutes each inside a healthy-looking deadline because a gateway answered
   * HTTP 200 and streamed nothing. Both conditions are required before it
   * fires — the retry evidence is what separates a provider wave from one very
   * long generation.
   */
  stallTimeoutMs?: number
  /**
   * The clock the stall bound reads, defaulting to the real one.
   *
   * The fourth reader of the run's clock, for the same reason the per-turn
   * bound is one: a stall window measured against `Date.now()` directly is one
   * no test can stand on either side of, and a tracker stamping progress on
   * its own injected clock would be measured against a different instant than
   * the one it was stamped at.
   */
  now?: () => number
  /** Where progress goes. The adapter is the only thing that can see it. */
  log: Logger
  /** Heartbeat period while a turn is outstanding. `0` disables it. */
  heartbeatMs?: number
  /**
   * The heartbeat's scheduler, injected so a test fires the tick on demand
   * rather than after a real minute. The same seam `HeartbeatOptions` carries,
   * handed through because a caller that wired a watcher has to be able to
   * drive the clock it rides on.
   */
  schedule?: (tick: () => void, everyMs: number) => { cancel: () => void }
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

/** The two things a stall watcher needs: a way to lose the race, and the tick. */
interface StallWatcher {
  /**
   * Rejects with the stall when the watcher fires; otherwise forever pending.
   * Typed `unknown` — it never resolves, and the race only ever reads its
   * rejection.
   */
  expiry: Promise<unknown>
  /** Asked on every heartbeat tick while the turn is outstanding. */
  reader: () => void
}

/**
 * The mid-turn stall bound, riding the heartbeat's tick.
 *
 * `withDeadline`-shaped on purpose: the work promise loses a race it cannot
 * cancel — nothing here can stop an in-flight HTTP request, and pretending
 * otherwise is the lie `deadline.ts` refuses to tell either. What the race
 * buys is *which* failure happens: `turnStallError` at the first heartbeat
 * past the window, instead of `turnDeadlineError` at the whole-turn cap an
 * hour later — cheap, before the runner's own clock is at risk, and carrying
 * the provider's retry count as the cause.
 *
 * Two conditions, and the second is the whole guard against false positives:
 * `tracker.stall()` is non-null only while retry evidence has accumulated
 * since the last progress, so a turn that is merely thinking — one very long
 * generation, no events, provider quiet — is the deadline's business and not
 * this one's. The clock half comes from the stamp the tracker keeps beside
 * that evidence, read against the same injected clock that stamped it.
 *
 * `null` when the bound is off (`AGENT_STALL_TIMEOUT_MS=0`, or a caller that
 * never wired one), which wires no reader and races nothing — the pipeline's
 * behaviour from before the knob existed, exactly.
 */
const stallWatcher = (bounds: TurnBounds, tracker: ProgressTracker): StallWatcher | null => {
  const stallMs = bounds.stallTimeoutMs ?? 0
  if (stallMs <= 0) return null

  const now = bounds.now ?? ((): number => Date.now())
  // Never resolves — only the reader's rejection settles it — so racing the
  // work against it is a pure "who fires first", exactly `withDeadline`'s
  // expiry. `withResolvers` rather than a captured `reject` so there is no
  // placeholder for the executor to overwrite.
  const expiry = Promise.withResolvers<unknown>()
  return {
    expiry: expiry.promise,
    reader: (): void => {
      const stall = tracker.stall()
      if (stall === null || now() - stall.lastProgressAt < stallMs) return
      expiry.reject(turnStallError(stallMs, stall, tracker.snapshot()))
    },
  }
}

/**
 * The bound and the heartbeat, in the one order that works.
 *
 * Heartbeat outside the deadline, never inside it: a deadline that fires leaves
 * the underlying call pending, so an inner heartbeat's cleanup would never run
 * and its interval would hold the process open past the end of the job. The
 * stall race sits **inside** the deadline for the same reason the work does —
 * whichever of the two bounds fires first wins, and the loser's cleanup runs
 * in the heartbeat's `finally` with the work's.
 */
const bounded = (work: Promise<unknown>, bounds: TurnBounds, tracker: ProgressTracker): Promise<unknown> => {
  const watcher = stallWatcher(bounds, tracker)
  return withHeartbeat(
    // The snapshot is read *at the rejection*, not when the bound was armed: what
    // the phase needs to report is what the turn had managed by the time it was
    // stopped, and this is the last frame that can still see the tracker.
    //
    // The bound itself is read here, per turn, for the reason `timeoutMs` may be a
    // function: a job now runs a turn per plan step, and a bound derived from the
    // job's remaining clock has to be asked again each time or it stops tracking it.
    withDeadline(watcher === null ? work : Promise.race([work, watcher.expiry]), turnBound(bounds), (elapsed) =>
      turnDeadlineError(elapsed, tracker.snapshot()),
    ),
    {
      everyMs: bounds.heartbeatMs ?? DEFAULT_HEARTBEAT_MS,
      log: bounds.log,
      snapshot: tracker.snapshot,
      reader: watcher?.reader,
      schedule: bounds.schedule,
    },
  )
}

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
    // A stall leaves before the probe like a deadline does, and for the same
    // reason plus one: the server is up and answering — it is the provider
    // that is not — so a probe that relabelled this as `serverGoneError`
    // would send a maintainer to the post-mortem step for an outage that is
    // nowhere in it.
    if (isTurnDeadline(error)) throw error
    if (isTurnStall(error)) throw error

    // The claude turn codes join the bypass list beside them: every claude
    // turn failure is classified *after* its process has exited, where the
    // probe would relabel a verdict as a crash. `CLAUDE_EXIT` carries the
    // code the CLI exited with and `CLAUDE_RESULT` owns the stream's own
    // error shapes — neither is a dead transport.
    if (isClaudeExit(error)) throw error
    if (isClaudeResult(error)) throw error

    const alive = await connection.alive(sessionId).catch(() => false)
    if (alive) throw error

    bounds.log.error({ sessionId }, 'The model backend process stopped answering; the turn died with it')
    throw serverGoneError(errorMessage(error))
  }
}
