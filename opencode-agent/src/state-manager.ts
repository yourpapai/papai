// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { agentStateSchema, InvalidTransitionError } from './types.js'
import type { AgentState, Phase, TransitionSignal } from './types.js'

/** Marker opening every persisted state block. Also the grep handle for humans. */
export const STATE_MARKER = 'AGENT_STATE'

/**
 * Matches `<!-- AGENT_STATE: {...} -->`. Non-greedy so several blocks in one
 * body are found separately; the `u` flag keeps it consistent with repo lint.
 */
const STATE_BLOCK_PATTERN = /<!--\s*AGENT_STATE:\s*([\S\s]*?)-->/gu

/** Anything the state machine may branch on when picking the next phase. */
const TRANSITIONS: Record<Phase, Partial<Record<TransitionSignal, Phase>>> = {
  INIT_OR_CLARIFY: { NEEDS_CLARIFICATION: 'INIT_OR_CLARIFY', SPEC_POSTED: 'DESIGN_SPEC' },
  DESIGN_SPEC: { NEEDS_CLARIFICATION: 'INIT_OR_CLARIFY', APPROVED: 'EXECUTION_PLAN' },
  EXECUTION_PLAN: { PLAN_POSTED: 'REVIEW_AND_MUTATE' },
  REVIEW_AND_MUTATE: { CHANGES_COMMITTED: 'PR_DELIVERY' },
  PR_DELIVERY: { PR_OPENED: 'COMPLETE' },
  COMPLETE: {},
  FAILED: {},
}

/** A comment as the state manager needs to see it, independent of the API shape. */
export interface IssueComment {
  id: number
  body: string
  authorLogin: string
}

/** Fresh state for an issue the agent has not seen before. */
export const initialState = (issueId: number): AgentState =>
  agentStateSchema.parse({ phase: 'INIT_OR_CLARIFY', issueId })

/** Renders the hidden HTML block that carries state across ephemeral CI jobs. */
export const serializeState = (state: AgentState): string =>
  `<!-- ${STATE_MARKER}:\n${JSON.stringify(state, null, 2)}\n-->`

/** Appends the hidden state block to a human-readable comment body. */
export const renderStateComment = (body: string, state: AgentState): string =>
  `${body.trimEnd()}\n\n${serializeState(state)}`

/**
 * Reads the state block out of a single comment body. When a body somehow
 * carries several blocks the last one wins — that is the most recent write.
 * Malformed JSON and schema-invalid payloads yield `null` rather than throwing,
 * so one corrupt comment cannot wedge the pipeline.
 */
export const extractState = (commentBody: string): AgentState | null => {
  let found: AgentState | null = null

  for (const match of commentBody.matchAll(STATE_BLOCK_PATTERN)) {
    const raw = match[1]
    if (raw === undefined) continue

    const parsed = parseStateJson(raw)
    if (parsed !== null) found = parsed
  }

  return found
}

const parseStateJson = (raw: string): AgentState | null => {
  try {
    const result = agentStateSchema.safeParse(JSON.parse(raw))
    return result.success ? result.data : null
  } catch {
    return null
  }
}

/**
 * Restores state from an issue thread: the newest comment authored by the agent
 * that carries a parsable state block. Comments are expected in GitHub's
 * chronological order; the scan walks backwards so the newest block wins even
 * when older agent comments still carry stale blocks.
 */
export const findLatestState = (comments: readonly IssueComment[], agentLogin: string): AgentState | null => {
  const normalizedAgent = agentLogin.toLowerCase()

  for (let index = comments.length - 1; index >= 0; index -= 1) {
    const comment = comments[index]
    if (comment === undefined) continue
    if (comment.authorLogin.toLowerCase() !== normalizedAgent) continue

    const state = extractState(comment.body)
    if (state !== null) return state
  }

  return null
}

/** Whether `signal` is accepted in `phase`. FAILED/RETRY are always accepted. */
export const canTransition = (phase: Phase, signal: TransitionSignal): boolean => {
  if (signal === 'FAILED' || signal === 'CANCELLED') return phase !== 'COMPLETE'
  if (signal === 'RETRY') return phase === 'FAILED'
  return TRANSITIONS[phase][signal] !== undefined
}

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

  if (signal === 'FAILED') {
    return applyPatch(state, {
      phase: 'FAILED',
      resumeFrom: state.phase === 'FAILED' ? state.resumeFrom : state.phase,
      attempts: state.attempts + 1,
      ...patch,
    })
  }

  if (signal === 'CANCELLED') {
    return applyPatch(state, { phase: 'COMPLETE', resumeFrom: null, ...patch })
  }

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

  const approved = signal === 'APPROVED' ? true : state.approved
  return applyPatch(state, { phase: next, approved, lastError: null, ...patch })
}

const applyPatch = (state: AgentState, patch: Partial<AgentState>): AgentState =>
  agentStateSchema.parse({ ...state, ...patch })
