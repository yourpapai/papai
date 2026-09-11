// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { TRANSITIONS } from './transition-table.js'
import { agentStateSchema, InvalidTransitionError, STATE_VERSION } from './types.js'
import type { AgentState, Phase, TransitionSignal } from './types.js'

/**
 * The state machine itself: which signals a phase accepts, and what each one does
 * to the persisted state.
 *
 * Split from `state-manager.ts`, which is now only the *channel* — rendering the
 * `AGENT_STATE` block and restoring it from an issue thread. Two questions, changing
 * for different reasons: that one is about a hidden block surviving a hostile comment
 * body, this one about which moves are legal. The seam was already there in a file
 * describing its table and its restore scan in two separate voices, and the file
 * reached `max-lines` when a wall-clock park and the command out of it arrived.
 *
 * The table itself has since moved the same way: `transition-table.ts` holds
 * the rows and the audit of every deliberate absence, and this file is what
 * reads them.
 *
 * Nothing here talks to GitHub or reads a comment: a value in and a value out, which
 * is what lets the whole audit be asserted as arithmetic.
 */

/**
 * Phases a wall-clock stop may park, and therefore the phases `OUT_OF_TIME` is
 * accepted in.
 *
 * These are exactly the phases with a handler in `HANDLERS` (`cascade.ts`), and
 * they have to be: the stop sits *before* the handler, so a phase the cascade
 * would run nothing in is a phase no clock can interrupt. Enumerated here rather
 * than imported, because this module must not depend on the cascade — the state
 * machine is what the cascade is written against, and the arrow may only point
 * one way. Two spellings of one list is a coincidence rather than a property, so
 * `state-manager.test.ts` asserts this set against `hasHandler` over every phase.
 */
const TIME_STOPPABLE: ReadonlySet<Phase> = new Set<Phase>([
  'INIT_OR_CLARIFY',
  'PLANNING',
  'REVIEW_AND_MUTATE',
  'PR_DELIVERY',
  'CODE_REVIEW',
  'CI_FIX',
  'ARCHIVE',
])

/**
 * Phases a run is *parked* in, waiting on a human, with `resumeFrom` recording
 * where it stopped.
 *
 * The one thing both readers below need: neither may become its own resume point.
 * `resumeFrom` exists so a command can re-enter the phase that stopped, and a
 * resume point naming a phase with no handler resumes into nothing and re-parks —
 * so a failure that lands on an already-parked issue keeps the point it was
 * carrying rather than overwriting it with the park.
 */
const PARKED_PHASES: ReadonlySet<Phase> = new Set<Phase>(['FAILED', 'INCOMPLETE'])

/** Whether `signal` is accepted in `phase`. */
export const canTransition = (phase: Phase, signal: TransitionSignal): boolean => {
  if (signal === 'ANSWERED') return true
  if (signal === 'FAILED' || signal === 'CANCELLED') return phase !== 'COMPLETE'
  if (signal === 'RETRY') return phase === 'FAILED'
  if (signal === 'OUT_OF_TIME') return TIME_STOPPABLE.has(phase)
  // The mirror image of `RETRY`, and narrower on purpose: `/continue` means "you
  // were not finished" — a claim a wall-clock park makes, and the forward path
  // out of a parked triage (issue #438), where it re-runs the handler where the
  // issue stands rather than resuming anything. Anywhere else it is refused
  // before the signal is applied, through the door that names what the phase
  // does accept.
  if (signal === 'CONTINUE') return phase === 'INCOMPLETE' || phase === 'INIT_OR_CLARIFY'
  return TRANSITIONS[phase][signal] !== undefined
}

const failTransition = (state: AgentState, patch: Partial<AgentState>): Partial<AgentState> => ({
  phase: 'FAILED',
  resumeFrom: PARKED_PHASES.has(state.phase) ? state.resumeFrom : state.phase,
  attempts: state.attempts + 1,
  ...patch,
})

/**
 * The plan-identity token this move bumps, if it rewrites the plan at all.
 *
 * Under the OpenSpec rework (design D1) only `PLAN_POSTED` bumps a counter, and
 * that counter is the plan-identity token `state.planRevision` documents — not
 * an artifact revision. The former `SPEC_POSTED` branch is gone: the proposal
 * lives in the folder and nothing counts spec revisions. A branch per signal
 * rather than a lookup table with a computed key keeps a mistyped field a
 * compile error rather than a counter that silently never moves.
 */
const revisionBump = (state: AgentState, signal: TransitionSignal): Partial<AgentState> => {
  if (signal === 'PLAN_POSTED') return { planRevision: state.planRevision + 1 }
  return {}
}

const forwardTransition = (
  state: AgentState,
  signal: TransitionSignal,
  next: Phase,
  patch: Partial<AgentState>,
): Partial<AgentState> => ({
  phase: next,
  // Every forward move clears the failure budget, because `attempts` counts
  // *consecutive* failures. An allow-list of "real progress" signals looked
  // equivalent and was not: asking a clarifying question and answering a
  // question are handler successes, so a conversation with the odd hiccup
  // accumulated toward the cap across runs that all succeeded. `RETRY` is the
  // deliberate exception and preserves the count in its own branch, so a retry
  // loop stays bounded, and `ANSWERED` clears it from its own branch below for
  // exactly the same reason.
  attempts: 0,
  ...revisionBump(state, signal),
  ciAttempts: signal === 'CI_FAILED' ? state.ciAttempts + 1 : state.ciAttempts,
  reviewAttempts: signal === 'REVIEW_REQUESTED' ? state.reviewAttempts + 1 : state.reviewAttempts,
  lastError: null,
  ...patch,
})

/**
 * A wall-clock stop, which is a **ceiling reached** and not a failure: nothing
 * broke, the run was told to stop. So it parks in a waiting phase of its own,
 * records where it stopped, and leaves `lastError` null — there is no error to
 * record. `attempts` is carried by the spread in {@link applyPatch} rather than
 * incremented, for the reason the token stop carries it: running out of a resource
 * is not a failed attempt at anything, and spending one would let the retry gate
 * refuse the very `/continue` the notice invites, citing a ceiling it never
 * mentioned.
 *
 * The invariant this preserves is the workspace's: no path may leave the persisted
 * state in a phase that has a handler but that no trigger can re-enter.
 * `INCOMPLETE` has no handler, and `CONTINUE` re-enters it — plus `/cancel` and
 * `/ask`, which every phase takes — so nothing is stranded.
 */
const timeStopTransition = (state: AgentState, patch: Partial<AgentState>): Partial<AgentState> => ({
  phase: 'INCOMPLETE',
  resumeFrom: state.phase,
  lastError: null,
  ...patch,
})

/**
 * Resuming a park: `RETRY` out of `FAILED` and `CONTINUE` out of `INCOMPLETE`.
 *
 * One function rather than two, because the *move* is identical — take the recorded
 * resume point, clear it, clear the error, and carry `attempts` — and the whole of
 * the difference between the two commands is which phase accepts them, which
 * {@link canTransition} already says. A parallel branch would be a second spelling
 * of one move, free to disagree with the first.
 *
 * The third `CONTINUE` never gets here: out of `INIT_OR_CLARIFY` the command is
 * the ANSWERED shape handled in {@link transition} above — a parked triage has
 * nothing to resume.
 *
 * The `INIT_OR_CLARIFY` fallback is for a hand-edited block that names no resume
 * point: a state block is attacker-editable text, and starting the conversation
 * over is a better answer than throwing out of the pipeline.
 */
const resumeTransition = (state: AgentState, patch: Partial<AgentState>): Partial<AgentState> => ({
  phase: state.resumeFrom ?? 'INIT_OR_CLARIFY',
  resumeFrom: null,
  lastError: null,
  ...patch,
})

/**
 * Applies a handler signal to the state, returning a new state object. Throws
 * `InvalidTransitionError` on an illegal move so a bug surfaces loudly in the
 * job log instead of silently corrupting the persisted phase.
 */
export const transition = (
  state: AgentState,
  signal: TransitionSignal,
  patch: Partial<AgentState> = {},
): AgentState => {
  if (!canTransition(state.phase, signal)) throw new InvalidTransitionError(state.phase, signal)

  // Answering is phase-neutral: it is accepted everywhere and moves nothing.
  //
  // It used to be three self-referencing rows in TRANSITIONS — INIT_OR_CLARIFY,
  // DESIGN_SPEC, PLAN_REVIEW — while `/ask` was accepted in every phase, so the
  // two disagreed and the disagreement was fatal: a question asked in COMPLETE,
  // FAILED, REVIEW_AND_MUTATE, PR_DELIVERY or CI_FIX paid for the model turn and
  // then threw `InvalidTransitionError` out of the pipeline, which the runner
  // printed as a stack trace while the issue heard nothing at all. FAILED was
  // the worst of them, being exactly the state a maintainer asks "why did this
  // fail?" in.
  //
  // Handled here rather than by adding a row to every phase because two sources
  // of truth for "stay put" is what let the table and `/ask`'s reach drift apart
  // in the first place. The patch reproduces what the old rows did: `attempts`
  // cleared, because answering is a handler success; the artefact revisions and
  // `ciAttempts` untouched, because neither the spec nor the plan was rewritten
  // and no CI round was spent.
  if (signal === 'ANSWERED') return applyPatch(state, { attempts: 0, lastError: null, ...patch })

  if (signal === 'FAILED') return applyPatch(state, failTransition(state, patch))
  if (signal === 'CANCELLED') return applyPatch(state, { phase: 'COMPLETE', resumeFrom: null, ...patch })

  if (signal === 'OUT_OF_TIME') return applyPatch(state, timeStopTransition(state, patch))
  // `/continue` out of the clarifying park is not a resume — nothing is parked.
  // It is the ANSWERED shape: the phase does not move (the cascade re-runs the
  // triage handler where the issue stands), `resumeFrom` is untouched, and the
  // failure budget and error clear the way any handler success does.
  if (signal === 'CONTINUE' && state.phase === 'INIT_OR_CLARIFY')
    return applyPatch(state, { attempts: 0, lastError: null, ...patch })
  if (signal === 'RETRY' || signal === 'CONTINUE') return applyPatch(state, resumeTransition(state, patch))

  const next = TRANSITIONS[state.phase][signal]
  if (next === undefined) throw new InvalidTransitionError(state.phase, signal)
  return applyPatch(state, forwardTransition(state, signal, next, patch))
}

/**
 * Records that the CI-fix give-up notice has been delivered.
 *
 * Not a transition: the phase does not move, the agent has simply stopped
 * acting on this pull request's red checks.
 */
export const markCiBudgetReported = (state: AgentState): AgentState => applyPatch(state, { ciBudgetReported: true })

const applyPatch = (state: AgentState, patch: Partial<AgentState>): AgentState =>
  agentStateSchema.parse({ ...state, ...patch, v: STATE_VERSION })
