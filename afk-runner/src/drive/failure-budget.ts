// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { AgentValidationError } from '../agent-layer.js'
import { SpawnError } from '../agent-seam.js'
import type { FailureKind } from '../events.js'
import type { KernelContext } from '../kernel/machine.js'
import { StageHaltError } from '../work/stage-halt.js'

/**
 * Per-stage consecutive-failure budget (C6 D3): a compiled constant in the
 * `PLAN_REPLAN_PASSES` tradition — the number of declared failures a stage
 * may burn through its immediate bracket re-runs before a human sees the
 * escalation gate.
 */
export const STAGE_FAILURE_BUDGET = 1

/** A declared failure as run facts (C6 D1): only typed errors carry one. */
export interface DeclaredFailure {
  readonly kind: FailureKind
  readonly reason: string
  readonly resumeHint?: string
}

/**
 * The typed-error classifier: `StageHaltError` (work modules),
 * `AgentValidationError` (agent layer), `SpawnError` (spawn seam) declare
 * failures; everything else returns null — untyped errors rethrow and keep
 * refusal-alarm crash semantics.
 */
export function declaredFailureOf(error: unknown): DeclaredFailure | null {
  if (error instanceof StageHaltError) {
    return {
      kind: error.kind,
      reason: error.message,
      ...(error.resumeHint === undefined ? {} : { resumeHint: error.resumeHint }),
    }
  }
  if (error instanceof AgentValidationError) return { kind: 'exhausted', reason: error.message }
  if (error instanceof SpawnError) return { kind: 'infra', reason: error.message }
  return null
}

/**
 * The one pure budget check (C6 D3), consulted symmetrically by the live loop
 * catch and by resume derivation: a stage owes an escalation gate when its
 * consecutive declared failures passed the budget (precondition always
 * escalates immediately) and no unanswered gate already parks the run.
 */
export function escalationOwed(context: KernelContext, stage: string): boolean {
  if (context.gate !== null && !context.gate.answered) return false
  const count = context.failures[stage] ?? 0
  if (count === 0) return false
  if (context.failureKinds[stage] === 'precondition') return true
  return count > STAGE_FAILURE_BUDGET
}
