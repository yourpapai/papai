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

/** Signals that count as forward progress and therefore clear the failure budget. */
const PROGRESS_SIGNALS: ReadonlySet<TransitionSignal> = new Set<TransitionSignal>([
  'SPEC_POSTED',
  'APPROVED',
  'PLAN_POSTED',
  'CHANGES_COMMITTED',
  'PR_OPENED',
  'CI_FIXED',
])

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
 * that carries a schema-valid state block.
 *
 * A block written by an older, incompatible state version is rejected the same
 * way a corrupt one is — the scan simply keeps walking back. That is safer than
 * coercing it, but it does mean a breaking `STATE_VERSION` bump strands
 * in-flight issues; see the migration note in the README before bumping.
 */
export const findLatestState = (comments: readonly IssueComment[], agentLogin: string): AgentState | null =>
  toState(findLatestBlock(comments, agentLogin, STATE_MARKER))

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
  attempts: PROGRESS_SIGNALS.has(signal) ? 0 : state.attempts,
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

const applyPatch = (state: AgentState, patch: Partial<AgentState>): AgentState =>
  agentStateSchema.parse({ ...state, ...patch, v: STATE_VERSION })
