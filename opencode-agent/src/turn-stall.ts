// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Activity } from './activity.js'

/**
 * What the model provider is currently getting wrong, folded from the event
 * stream so that a turn's *end* can be judged.
 *
 * Its own module rather than three more fields in `progress.ts`, which had
 * reached `max-lines` and would have been carrying two subjects: that one
 * renders a running turn for a reader, this one accumulates the single fact
 * nobody was in a position to state — whether the model ever answered at all.
 * They change for different reasons, and only this one has a caller that acts
 * on it.
 *
 * The failure it exists for is issue #239's delivered-nothing run. The implement
 * turn was refused by the provider twenty-five times over twelve minutes, went
 * idle without ever finishing another step, and the prompt call returned an
 * ordinary reply envelope with no text in it. Nothing downstream could tell that
 * from a turn that had done its work — `decodeReply` checks the transport's own
 * `error` field, and this failure is not in it — so the phase committed the
 * working tree, which held one stray pid file, and reported a delivery.
 */
export interface TurnStall {
  /** Retries the provider made after the last model step finished. */
  retries: number
  /**
   * The `session.error` the server publishes when it gives up, if it published
   * one. A name and a status code only — the containment rule `activity.ts`
   * enforces — which is enough to tell a 429 that will pass from a 401 that
   * will not.
   */
  failure: { name: string; statusCode: number | null } | null
  /**
   * When the turn last made progress, in ms on the tracker's clock.
   *
   * Progress is a finished model step or a **newly started** tool call — a
   * tool starting is as much proof the model answered as a step finishing —
   * stamped at those instants and at creation. This is the half the record
   * gained when the 2026-08-21 incident showed the evidence alone could only
   * be judged at a turn's *end*: a gateway that answers HTTP 200 and streams
   * nothing keeps a turn outstanding for the whole-turn deadline, and the
   * clock is what lets a watcher ask the question while the turn is still
   * running.
   *
   * Stamped by the tracker in `progress.ts`, never by the pure fold below: a
   * fold has no clock, and on a step it keeps the old stamp for the tracker to
   * move.
   */
  lastProgressAt: number
}

/** A turn with nothing wrong yet: what every turn starts from, and returns to. */
export const noStall = (lastProgressAt: number): TurnStall => ({ retries: 0, failure: null, lastProgressAt })

/**
 * One activity folded into the record, as a fresh value.
 *
 * **A finished step clears it**, and that is the decision the whole guard rests
 * on: from here, recovery *is* the next `step-finish`. A turn that hit a rate
 * limit, retried, recovered and went on to finish four more steps has a stall of
 * zero — measuring since the last step is what makes this a statement about how
 * the turn ended rather than about everything that happened inside it.
 *
 * Pure, so the caller decides when to fold. `progress.ts` folds **in front of**
 * its collapse gate, which suppresses a repeated status line: a retry whose line
 * is dropped as a duplicate is still a retry that happened, and folding behind
 * the gate would report a provider that failed twenty-five times in a row as
 * having failed once.
 *
 * On a **step** it clears the evidence and keeps the old `lastProgressAt`: the
 * fold has no clock, and the tracker re-stamps the instant right after this
 * returns. Every other kind leaves the stamp untouched — only a finished step
 * or a newly started tool call is progress, and neither of those reaches this
 * fold as evidence.
 */
export const foldStall = (stall: TurnStall, activity: Activity): TurnStall => {
  if (activity.kind === 'step') return noStall(stall.lastProgressAt)

  if (activity.kind === 'failure') {
    const statusCode = activity.meta['statusCode']
    return {
      ...stall,
      failure: { name: String(activity.meta['error']), statusCode: typeof statusCode === 'number' ? statusCode : null },
    }
  }

  if (activity.kind === 'status' && activity.meta['status'] === 'retry') {
    return { ...stall, retries: stall.retries + 1 }
  }

  return stall
}

/** The record as an answer: `null` unless something is actually wrong now. */
export const reportStall = (stall: TurnStall): TurnStall | null =>
  stall.retries === 0 && stall.failure === null ? null : { ...stall }
