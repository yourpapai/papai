// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

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
 * Nothing here talks to GitHub or reads a comment: a value in and a value out, which
 * is what lets the whole audit below be asserted as arithmetic.
 */

/**
 * Where each signal leads. Signals absent from a phase's row are rejected, so a
 * command arriving in the wrong phase is a loud no-op rather than a silent
 * corruption of the persisted state.
 *
 * `ANSWERED` is deliberately not in this table at all — see {@link transition}.
 * Every entry here names a phase the machine *moves to*; a signal that leaves
 * the phase alone has no business being expressed as a row per phase.
 *
 * `CI_FAILED` appears in exactly two rows, and the four absences are the
 * decision rather than an oversight. A red run is worth acting on only where
 * the branch is already pushed *and* no job of this pipeline is working it:
 * `COMPLETE` is the ordinary case, and `PR_DELIVERY` is the genuine race.
 * Phase 3 pushes the branch and posts a state block naming `PR_DELIVERY`
 * before phase 4 opens the pull request, and a delivery that dies after the
 * pull request exists leaves exactly that block behind — so the branch is live,
 * the checks are red, and the row that used to be missing had `applyCiTrigger`
 * refuse the run, post nothing and spend nothing. Silence is the failure mode
 * the whole CI path is built around, so it was the wrong row to leave out.
 *
 * The four phases before the branch exists — `INIT_OR_CLARIFY`, `DESIGN_SPEC`,
 * `PLANNING`, `PLAN_REVIEW` — have nothing pushed to repair, and
 * `handleCiFix` would happily run the configured checks against a branch cut
 * fresh from the base and commit the base's own failures onto the issue.
 *
 * `REVIEW_AND_MUTATE` and `CI_FIX` are out because the machine never persists
 * them: a state block is written only when a handler posts, and both of those
 * handlers post the phase they moved *to* (`PR_DELIVERY`, `COMPLETE`). A red
 * run appearing to find one is reading a hand-edited block, and honouring it
 * would put a second agent job on a branch another job is mid-commit on. The
 * workflow's concurrency group (`opencode-agent-<branch>`,
 * `cancel-in-progress: false`) does queue those two runs rather than overlap
 * them — but it keys a CI run off `workflow_run.head_branch` and an issue run
 * off `agent/issue-<n>`, so it holds only while those two strings agree, which
 * is a narrow coincidence to hang a push race on rather than a proof.
 *
 * `FAILED` is deliberately absent and is the close call, because there the
 * branch *is* pushed, a pull request may well be open, and its checks do go red
 * with nobody acting. It stays out because `FAILED`'s entire content is a
 * recorded pipeline failure plus the `resumeFrom` that undoes it, and
 * `CI_FAILED` is a forward move: it would reset `attempts`, and it would leave
 * `FAILED` for a phase where `/retry` is refused — `resumeFrom` survives the
 * move but nothing can ever act on it again — so a fix that went green would
 * land the issue in `COMPLETE`, announcing success for a pipeline that never
 * finished delivering. Nor is this the silence the `PR_DELIVERY` row is about:
 * a failed run has already posted "this failed, reply `/retry`", and that
 * `/retry` resumes the phase that broke, delivers, and reaches `COMPLETE`,
 * where the next red run is picked up as usual. The red checks are deferred
 * behind a maintainer, not abandoned.
 *
 * `REVIEW_REQUESTED` names exactly one row, and its absences are the same audit
 * with one answer changed. The four phases before the branch exists have nothing
 * to review; `REVIEW_AND_MUTATE`, `CODE_REVIEW` and `CI_FIX` are never
 * persisted, so a `/review` appearing to find one is reading a hand-edited block
 * and honouring it would put a second job on a branch another is mid-commit on;
 * and `FAILED` is parked under a comment asking for `/retry`, where reviewing a
 * delivery that did not finish reviews a branch nobody has claimed is complete.
 *
 * `PR_DELIVERY` is the one that differs from `CI_FAILED`, deliberately. That row
 * exists because a refused red run is **silent** — nothing posted, nothing
 * spent, and a maintainer with no way to learn the run was dropped. A refused
 * `/review` answers on the issue through `refuseCommand`, naming what the phase
 * does accept, so there is no silence to fix; and in `PR_DELIVERY` the pull
 * request may not exist yet, which is precisely what the review reports against.
 *
 * `INCOMPLETE` carries an empty row for the reason `FAILED` does: both signals that
 * reach it — `OUT_OF_TIME` in, `CONTINUE` out — are explicit branches in
 * {@link transition}, neither being a plain forward move. Its two absences are that
 * same audit again: `CI_FAILED` and `REVIEW_REQUESTED` stay out even though the
 * branch *is* pushed there, the one condition those rows normally want, because the
 * work is by definition unfinished and CI-fixing or reviewing a half-done increment
 * is worse than waiting for the `/continue` that finishes it.
 */
const TRANSITIONS: Record<Phase, Partial<Record<TransitionSignal, Phase>>> = {
  INIT_OR_CLARIFY: { NEEDS_CLARIFICATION: 'INIT_OR_CLARIFY', CAPTURED: 'DESIGN_SPEC' },
  DESIGN_SPEC: { CHANGES_REQUESTED: 'INIT_OR_CLARIFY', APPROVED: 'PLANNING' },
  PLANNING: { PLAN_POSTED: 'PLAN_REVIEW' },
  PLAN_REVIEW: { CHANGES_REQUESTED: 'PLANNING', APPROVED: 'REVIEW_AND_MUTATE' },
  // Design D6 — steering-drift: a scope-affecting comment during implementation
  // routes back to PLANNING for an artifact-update turn before implementation
  // continues, so the folder cannot rot relative to the conversation.
  REVIEW_AND_MUTATE: { CHANGES_REQUESTED: 'PLANNING', CHANGES_COMMITTED: 'PR_DELIVERY' },
  PR_DELIVERY: { PR_OPENED: 'COMPLETE', CI_FAILED: 'CI_FIX' },
  CODE_REVIEW: { REVIEW_DONE: 'COMPLETE' },
  CI_FIX: { CI_FIXED: 'COMPLETE' },
  COMPLETE: { CI_FAILED: 'CI_FIX', REVIEW_REQUESTED: 'CODE_REVIEW' },
  FAILED: {},
  INCOMPLETE: {},
}

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
  // were not finished", a claim only the phase a wall-clock stop parks in can
  // make. Anywhere else it is refused before the signal is applied, through the
  // door that names what the phase does accept.
  if (signal === 'CONTINUE') return phase === 'INCOMPLETE'
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
