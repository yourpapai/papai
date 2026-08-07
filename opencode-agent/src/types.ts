// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

/**
 * Phases of the issue-driven agent state machine.
 *
 * `DESIGN_SPEC` and `PLAN_REVIEW` are deliberate stops: each artefact the agent
 * produces is parked in front of a human who can question it, refine it, or
 * approve it before the pipeline spends anything on the next step.
 *
 * `CI_FIX` is entered from outside the issue conversation — a red check run on
 * the agent's own pull request — and returns to `COMPLETE` once the branch is
 * green again.
 */
export const PHASES = [
  'INIT_OR_CLARIFY',
  'DESIGN_SPEC',
  'EXECUTION_PLAN',
  'PLAN_REVIEW',
  'REVIEW_AND_MUTATE',
  'PR_DELIVERY',
  'CI_FIX',
  'COMPLETE',
  'FAILED',
] as const

export type Phase = (typeof PHASES)[number]

/** Phases that wait on a human and run no handler of their own. */
export const WAITING_PHASES: ReadonlySet<Phase> = new Set<Phase>(['DESIGN_SPEC', 'PLAN_REVIEW'])

/**
 * Outcomes a phase handler reports back to the state machine. The machine — not
 * the handler — decides which phase follows, so handlers stay dumb about order.
 */
export const TRANSITION_SIGNALS = [
  'NEEDS_CLARIFICATION',
  'SPEC_POSTED',
  'CHANGES_REQUESTED',
  'ANSWERED',
  'APPROVED',
  'PLAN_POSTED',
  'CHANGES_COMMITTED',
  'PR_OPENED',
  'CI_FAILED',
  'CI_FIXED',
  'CANCELLED',
  'FAILED',
  'RETRY',
] as const

export type TransitionSignal = (typeof TRANSITION_SIGNALS)[number]

/** Bumped when the persisted shape changes in a way old blocks cannot satisfy. */
export const STATE_VERSION = 2

/**
 * The durable state carried between ephemeral CI jobs. Serialized verbatim into
 * a hidden `<!-- AGENT_STATE: ... -->` block on the agent's own issue comment;
 * every field must survive a JSON round trip.
 *
 * Bulky artefacts (spec, plan, report) deliberately live in their own blocks
 * rather than here — this object is rewritten on every comment, and duplicating
 * a multi-kilobyte spec each time would bloat the thread.
 */
export const agentStateSchema = z.object({
  /** Absent on v1 blocks written before versioning; those are treated as v1. */
  v: z.number().int().min(1).default(1),
  phase: z.enum(PHASES),
  issueId: z.number().int().positive(),
  branch: z.string().min(1).nullable().default(null),
  approved: z.boolean().default(false),
  /** Phase to resume from when a FAILED run is retried. */
  resumeFrom: z.enum(PHASES).nullable().default(null),
  /** Consecutive failures. Cleared by any forward move; preserved across `/retry`. */
  attempts: z.number().int().min(0).default(0),
  /** CI-fix rounds spent on the delivered pull request. Never reset. */
  ciAttempts: z.number().int().min(0).default(0),
  /**
   * Whether the "I have stopped fixing CI" notice has been posted. CI events
   * arrive on every push and re-run, so without this the notice repeats forever.
   */
  ciBudgetReported: z.boolean().default(false),
  /** Bumped each time the spec or plan is revised, for the artefact blocks. */
  revision: z.number().int().min(0).default(0),
  lastError: z.string().nullable().default(null),
  prUrl: z.url().nullable().default(null),
  prNumber: z.number().int().positive().nullable().default(null),
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

export type RunStatus = 'skipped' | 'waiting' | 'completed' | 'failed'

/** What one call to the pipeline concluded. `state` is null when nothing ran. */
export interface RunResult {
  status: RunStatus
  reason: string
  state: AgentState | null
}
