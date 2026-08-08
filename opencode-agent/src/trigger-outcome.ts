// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { PhaseDeps } from './phase-context.js'
import type { RunResult } from './run-result.js'
import { transition } from './transitions.js'
import { errorMessage } from './types.js'
import type { AgentState, TransitionSignal } from './types.js'

/**
 * What the trigger layer concluded, shared by `triggers.ts`, `ci-trigger.ts` and
 * `comment-intent.ts`.
 *
 * In its own module for the reason `MachineInput` is: three modules now decide
 * trigger outcomes, and a shape owned by the file one of them lives in is how an
 * import cycle starts.
 */
export interface TriggerOutcome {
  state: AgentState
  halt: RunResult | null
  /** Set when the trigger should be handled as a question rather than a phase. */
  answer: boolean
}

/**
 * A trigger that moved nothing.
 *
 * `reported` defaults to false because nearly every skip in the trigger layer is
 * deliberately silent — a red run on a settled pull request, a red run in a
 * phase with no branch to fix, an empty comment, a classification of `none`, an
 * already-reported CI budget. `refuseCommand` in `triggers.ts` is the one that
 * answers on the issue first, and passes `true`.
 *
 * That distinction is worth carrying even though a skipped run exits 0 and so
 * never reaches the workflow's fallback step. The flag means "this run posted",
 * full stop; a path where a comment exists and the flag says otherwise is
 * exactly the shape of the bug it was added to fix, and the next reader of the
 * flag will not know to check whether the status happened to make it moot.
 */
export const skip = (state: AgentState, reason: string, reported = false): RunResult => ({
  status: 'skipped',
  reason,
  state,
  reported,
})

/**
 * Applies a signal, or turns the refusal into a skip the caller can report on.
 *
 * Here rather than in `triggers.ts` because both halves of the trigger layer
 * need it: the command half calls it for a slash command, and the plain-comment
 * half in `comment-intent.ts` calls it for a classified approve or change
 * request. Importing it from one of those into the other is the cycle this
 * module exists to prevent.
 *
 * `ci-trigger.ts` deliberately does *not* use it, and says why at length: it
 * asks `canTransition` first, so a throw there would mean the gate and the table
 * disagree, and swallowing that into a silent skip is what hid a missing row.
 */
export const moveOrSkip = (
  state: AgentState,
  signal: TransitionSignal,
  deps: PhaseDeps,
  source: string,
): TriggerOutcome => {
  try {
    const next = transition(state, signal)
    deps.log.info({ source, signal, from: state.phase, to: next.phase }, 'Applied trigger')
    return { state: next, halt: null, answer: false }
  } catch (error) {
    return {
      state,
      halt: skip(state, `${source} is not valid in ${state.phase}: ${errorMessage(error)}`),
      answer: false,
    }
  }
}
