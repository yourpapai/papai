// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Phase } from './phase-names.js'

/**
 * What one run of this pipeline hands the next, and the vocabulary it is written in.
 *
 * The phase **names** live next door in `phase-names.ts` — they were split out when
 * this file and their migration would no longer fit together — and are re-exported
 * here so every caller keeps naming one module for the machine's vocabulary, the same
 * reason `git.ts` re-exports `Salvage`. What is left in this file is the shape: which
 * signals a handler may report, and field by field what survives between two jobs.
 */
export type { Phase } from './phase-names.js'
// The persisted half, split out when this file passed `max-lines` and
// re-exported so every existing import still resolves here.
export { agentStateSchema, STATE_VERSION, TOKEN_SCALE } from './agent-state.js'
export type { AgentState } from './agent-state.js'
export { LEGACY_PHASE_NAMES, PHASES, WAITING_PHASES } from './phase-names.js'

/**
 * Outcomes a phase handler reports back to the state machine. The machine — not
 * the handler — decides which phase follows, so handlers stay dumb about order.
 *
 * Three are reported by nothing in `phases/`: `RETRY` and `CONTINUE` are typed by a
 * human and injected by the trigger layer, and `OUT_OF_TIME` comes from the
 * cascade's own wall-clock stop before any handler runs.
 */
export const TRANSITION_SIGNALS = [
  'NEEDS_CLARIFICATION',
  // Was `SPEC_POSTED` when the design spec travelled in an `AGENT_SPEC` block.
  // Renamed under the OpenSpec rework (design D1): triage no longer posts a
  // spec block, it *captures* the issue as an `openspec/changes/<name>/` folder
  // (scaffolded, branched and pushed as commit #1 — D2), then parks at
  // `DESIGN_SPEC` for a human to review a rendered digest of that folder.
  'CAPTURED',
  'CHANGES_REQUESTED',
  'ANSWERED',
  'APPROVED',
  'PLAN_POSTED',
  'CHANGES_COMMITTED',
  'PR_OPENED',
  'CI_FAILED',
  'CI_FIXED',
  'REVIEW_REQUESTED',
  'REVIEW_DONE',
  // Design D7 — the archive door. A merged pull request on `agent/issue-<n>`
  // moves COMPLETE → ARCHIVE; the handler runs `openspec archive` as a
  // follow-up commit on master and signals ARCHIVED back to COMPLETE.
  'PR_MERGED',
  'ARCHIVED',
  'CANCELLED',
  'FAILED',
  'RETRY',
  'OUT_OF_TIME',
  'CONTINUE',
] as const

export type TransitionSignal = (typeof TRANSITION_SIGNALS)[number]

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
