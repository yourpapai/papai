// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

/**
 * Phases of the issue-driven agent state machine.
 *
 * The spike flow is INIT_OR_CLARIFY -> DESIGN_SPEC -> EXECUTION_PLAN ->
 * REVIEW_AND_MUTATE -> PR_DELIVERY -> COMPLETE, with FAILED as a parking phase
 * that remembers where to resume from on retry.
 */
export const PHASES = [
  'INIT_OR_CLARIFY',
  'DESIGN_SPEC',
  'EXECUTION_PLAN',
  'REVIEW_AND_MUTATE',
  'PR_DELIVERY',
  'COMPLETE',
  'FAILED',
] as const

export type Phase = (typeof PHASES)[number]

/**
 * Outcomes a phase handler reports back to the state machine. The machine — not
 * the handler — decides which phase follows, so handlers stay dumb about order.
 */
export const TRANSITION_SIGNALS = [
  'NEEDS_CLARIFICATION',
  'SPEC_POSTED',
  'APPROVED',
  'PLAN_POSTED',
  'CHANGES_COMMITTED',
  'PR_OPENED',
  'CANCELLED',
  'FAILED',
  'RETRY',
] as const

export type TransitionSignal = (typeof TRANSITION_SIGNALS)[number]

/**
 * The durable state carried between ephemeral CI jobs. Serialized verbatim into
 * a hidden `<!-- AGENT_STATE: ... -->` block on the agent's own issue comment;
 * every field must survive a JSON round trip.
 */
export const agentStateSchema = z.object({
  phase: z.enum(PHASES),
  issueId: z.number().int().positive(),
  branch: z.string().min(1).nullable().default(null),
  approved: z.boolean().default(false),
  /** Phase to resume from when a FAILED run is retried. */
  resumeFrom: z.enum(PHASES).nullable().default(null),
  /** How many times this issue has entered FAILED. Caps runaway retry loops. */
  attempts: z.number().int().min(0).default(0),
  lastError: z.string().nullable().default(null),
  prUrl: z.url().nullable().default(null),
  updatedAt: z.string().nullable().default(null),
})

export type AgentState = z.infer<typeof agentStateSchema>

/** Raised when a handler reports a signal the current phase cannot accept. */
export class InvalidTransitionError extends Error {
  readonly phase: Phase
  readonly signal: TransitionSignal

  constructor(phase: Phase, signal: TransitionSignal) {
    super(`Phase ${phase} cannot accept signal ${signal}`)
    this.name = 'InvalidTransitionError'
    this.phase = phase
    this.signal = signal
  }
}

/** Extracts a message from an unknown thrown value. */
export const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))
