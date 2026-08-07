// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { findLatestBlock, readBlock, renderBlock } from './blocks.js'
import type { IssueComment } from './blocks.js'
import { agentStateSchema, InvalidTransitionError, STATE_VERSION } from './types.js'
import type { AgentState, Phase, TransitionSignal } from './types.js'

export type { IssueComment } from './blocks.js'

/** Marker opening every persisted state block. Also the grep handle for humans. */
export const STATE_MARKER = 'AGENT_STATE'

/**
 * Where each signal leads. Signals absent from a phase's row are rejected, so a
 * command arriving in the wrong phase is a loud no-op rather than a silent
 * corruption of the persisted state.
 */
const TRANSITIONS: Record<Phase, Partial<Record<TransitionSignal, Phase>>> = {
  INIT_OR_CLARIFY: { NEEDS_CLARIFICATION: 'INIT_OR_CLARIFY', ANSWERED: 'INIT_OR_CLARIFY', SPEC_POSTED: 'DESIGN_SPEC' },
  DESIGN_SPEC: { ANSWERED: 'DESIGN_SPEC', CHANGES_REQUESTED: 'INIT_OR_CLARIFY', APPROVED: 'EXECUTION_PLAN' },
  EXECUTION_PLAN: { PLAN_POSTED: 'PLAN_REVIEW' },
  PLAN_REVIEW: { ANSWERED: 'PLAN_REVIEW', CHANGES_REQUESTED: 'EXECUTION_PLAN', APPROVED: 'REVIEW_AND_MUTATE' },
  REVIEW_AND_MUTATE: { CHANGES_COMMITTED: 'PR_DELIVERY' },
  PR_DELIVERY: { PR_OPENED: 'COMPLETE' },
  CI_FIX: { CI_FIXED: 'COMPLETE' },
  COMPLETE: { CI_FAILED: 'CI_FIX' },
  FAILED: {},
}

/** Signals that produce a revised spec or plan, bumping the artefact revision. */
const REVISION_SIGNALS: ReadonlySet<TransitionSignal> = new Set<TransitionSignal>(['SPEC_POSTED', 'PLAN_POSTED'])

/** Fresh state for an issue the agent has not seen before. */
export const initialState = (issueId: number): AgentState =>
  agentStateSchema.parse({ v: STATE_VERSION, phase: 'INIT_OR_CLARIFY', issueId })

/** Renders the hidden block that carries state across ephemeral CI jobs. */
export const serializeState = (state: AgentState): string => renderBlock(STATE_MARKER, state)

/** Appends the hidden state block to a human-readable comment body. */
export const renderStateComment = (body: string, state: AgentState): string =>
  `${body.trimEnd()}\n\n${serializeState(state)}`

const toState = (candidate: unknown): AgentState | null => {
  if (candidate === undefined) return null
  const result = agentStateSchema.safeParse(candidate)
  return result.success ? result.data : null
}

/** Reads the state block out of a single comment body; `null` when absent or invalid. */
export const extractState = (commentBody: string): AgentState | null => toState(readBlock(commentBody, STATE_MARKER))

/**
 * Restores state from an issue thread: the newest comment authored by the agent
 * that carries a schema-valid state block **for this issue**.
 *
 * Two rejections, and the scan genuinely keeps walking back through both — it
 * used to take the newest readable block and validate afterwards, so a single
 * corrupt one reset a conversation that had a perfectly good block behind it.
 *
 * The `issueId` check is the security half. Anyone who can edit the agent's
 * comments can edit this block, and `issueId` is the field the rest of the
 * pipeline treats as authoritative: it names the branch through
 * `branchNameFor`, the commit trailers, and the `Closes #n` the pull request
 * carries. The event already knows which issue this is, so a block claiming a
 * different one is discarded rather than believed.
 *
 * A block from an older, incompatible `STATE_VERSION` is rejected the same way,
 * which does mean a breaking bump strands in-flight issues; see the migration
 * note in the README before bumping.
 */
export const findLatestState = (
  comments: readonly IssueComment[],
  agentLogin: string,
  issueId: number,
): AgentState | null => toState(findLatestBlock(comments, agentLogin, STATE_MARKER, ownedBy(issueId)))

const ownedBy =
  (issueId: number) =>
  (candidate: unknown): boolean => {
    const parsed = agentStateSchema.safeParse(candidate)
    return parsed.success && parsed.data.issueId === issueId
  }

/** Whether `signal` is accepted in `phase`. */
export const canTransition = (phase: Phase, signal: TransitionSignal): boolean => {
  if (signal === 'FAILED' || signal === 'CANCELLED') return phase !== 'COMPLETE'
  if (signal === 'RETRY') return phase === 'FAILED'
  return TRANSITIONS[phase][signal] !== undefined
}

const failTransition = (state: AgentState, patch: Partial<AgentState>): Partial<AgentState> => ({
  phase: 'FAILED',
  resumeFrom: state.phase === 'FAILED' ? state.resumeFrom : state.phase,
  attempts: state.attempts + 1,
  ...patch,
})

const forwardTransition = (
  state: AgentState,
  signal: TransitionSignal,
  next: Phase,
  patch: Partial<AgentState>,
): Partial<AgentState> => ({
  phase: next,
  approved: signal === 'APPROVED' ? true : state.approved,
  // Every forward move clears the failure budget, because `attempts` counts
  // *consecutive* failures. An allow-list of "real progress" signals looked
  // equivalent and was not: asking a clarifying question and answering a
  // question are handler successes, so a conversation with the odd hiccup
  // accumulated toward the cap across runs that all succeeded. `RETRY` is the
  // deliberate exception and preserves the count in its own branch, so a retry
  // loop stays bounded.
  attempts: 0,
  revision: REVISION_SIGNALS.has(signal) ? state.revision + 1 : state.revision,
  ciAttempts: signal === 'CI_FAILED' ? state.ciAttempts + 1 : state.ciAttempts,
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

  if (signal === 'FAILED') return applyPatch(state, failTransition(state, patch))
  if (signal === 'CANCELLED') return applyPatch(state, { phase: 'COMPLETE', resumeFrom: null, ...patch })
  if (signal === 'RETRY') {
    return applyPatch(state, {
      phase: state.resumeFrom ?? 'INIT_OR_CLARIFY',
      resumeFrom: null,
      lastError: null,
      ...patch,
    })
  }

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
