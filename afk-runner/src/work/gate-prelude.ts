// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import type { AutonomyConfig } from '../config.js'
import type { EventInput, SddEvent } from '../events.js'
import type { KernelContext } from '../kernel/machine.js'
import { classifyAssumptions, evaluateCapHit, evaluateEscalationGate, evaluateFinalGate } from './auto-policy.js'
import type { PolicyDecision, PolicySignals } from './auto-policy.js'
import { renderGateAnswers } from './gate-answers.js'
import type { GateAnswers } from './gate-answers.js'
import type { GateAssumption } from './gate-model.js'
import { expectedContentFor } from './gate-settle.js'
import { settleGateWithAnswers } from './gate-settle.js'
import type { ReviewLoopResult } from './review-loop.js'

export interface GatePreludeInput {
  readonly version: number
  readonly mode: 'early' | 'final' | 'escalation'
  readonly reviewResult: ReviewLoopResult
  readonly context: KernelContext
  readonly events: readonly SddEvent[]
  readonly sidecarDir: string
  readonly changeDir: string
  readonly runDir: string
  readonly repoRoot: string
  readonly emit: (event: EventInput) => void
  readonly autonomy: AutonomyConfig
}

export interface GatePreludeResult {
  readonly rule: PolicyDecision['rule']
  readonly action: PolicyDecision['action']
}

/** The auto-extend allowance as folded auto-decision records (C3 D6): prior extend decisions consumed. */
export function autoExtendsUsedOf(context: KernelContext): number {
  return context.autoDecisions.filter((record) => record.decision === 'extend').length
}

function decisionKindOf(action: PolicyDecision['action']): 'approve' | 'extend' | 'accept-items' | 'gate' {
  if (action === 'approve') return 'approve'
  if (action === 'extend') return 'extend'
  if (action === 'accept-items') return 'accept-items'
  return 'gate'
}

/** Auto-approve answers (renderAutoApproveAnswers copy): every box checked, attributed to the rule. */
export function renderAutoApproveAnswers(
  decision: PolicyDecision,
  assumptions: readonly GateAssumption[],
): GateAnswers {
  return {
    items: assumptions.map((assumption) => ({
      kind: 'assumption' as const,
      id: assumption.id,
      text: assumption.text,
      accepted: true,
      decidedBy: `policy ${decision.rule}`,
    })),
    blockerAnswers: [],
    acks: [],
    decision: 'approve',
    decidedBy: `policy ${decision.rule}`,
  }
}

function signalsOf(
  input: GatePreludeInput,
  assumptions: readonly GateAssumption[],
  deadlineExpired: boolean,
): PolicySignals {
  const recordedPaths = input.events
    .filter((event) => event.type === 'artifact')
    .map((event) => (event as { path: string }).path)
  const spent = input.events
    .filter((event) => event.type === 'done')
    .reduce((sum, event) => sum + event.usage.costUsd, 0)
  const costKnown = input.events.every(
    (event) => event.type !== 'done' || event.usage.costUsd > 0 || sumTokens(event.usage) === 0,
  )
  return {
    reviewResult: input.reviewResult,
    trajectory: input.context.perRound,
    assumptions: classifyAssumptions(assumptions, {
      changeDir: path.relative(input.repoRoot, input.changeDir),
      runDir: path.relative(input.repoRoot, input.runDir),
      recordedPaths,
    }),
    spentUsd: spent,
    costKnown,
    autoExtendsUsed: autoExtendsUsedOf(input.context),
    deadlineExpired,
    config: input.autonomy,
  }
}

function sumTokens(usage: {
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cachedReadTokens: number
  cachedWriteTokens: number
}): number {
  return (
    usage.inputTokens + usage.outputTokens + usage.reasoningTokens + usage.cachedReadTokens + usage.cachedWriteTokens
  )
}

/**
 * The presentation-time prelude (design D6): the ladder is evaluated at every
 * presentation and an `auto_decision` event is ALWAYS appended — rule none
 * included — with R1 approving and R2 extending through the settle seam.
 * Everything else hands to the human gate.
 */
export async function runGatePrelude(input: GatePreludeInput): Promise<GatePreludeResult> {
  const round = input.context.round?.current ?? input.reviewResult.rounds
  const assumptions = await expectedAssumptionsOf(input, round)
  const decision = evaluateLadder(input, assumptions, false)
  input.emit({
    altitude: 'L2',
    type: 'auto_decision',
    rule: decision.rule,
    decision: decisionKindOf(decision.action),
    evidenceDigest: decision.evidenceDigest,
    gateVersion: input.version,
  })
  if (decision.action === 'approve' || decision.action === 'extend') {
    await settleGateWithAnswers(
      {
        gate: {
          emit: input.emit,
          runDir: input.runDir,
          changeDir: input.changeDir,
          driftCheck: () => Promise.resolve(),
        },
        version: input.version,
        gateMode: input.mode,
        expected: await expectedContentFor(input.sidecarDir, round, input.mode),
        round: input.context.round,
      },
      decision.action === 'approve'
        ? renderAutoApproveAnswers(decision, assumptions)
        : { items: [], blockerAnswers: [], acks: [], decision: 'extend' },
    )
  }
  return { rule: decision.rule, action: decision.action }
}

/** Assemble the ladder signals and run the mode's ladder (shared with deadline expiry). */
export function evaluateLadder(
  input: GatePreludeInput,
  assumptions: readonly GateAssumption[],
  deadlineExpired: boolean,
): PolicyDecision {
  const signals = signalsOf(input, assumptions, deadlineExpired)
  if (input.mode === 'early') return evaluateCapHit(signals)
  if (input.mode === 'escalation') {
    return evaluateEscalationGate({
      spentUsd: signals.spentUsd,
      costKnown: signals.costKnown,
      config: signals.config,
    })
  }
  return evaluateFinalGate(signals)
}

async function expectedAssumptionsOf(input: GatePreludeInput, round: number): Promise<readonly GateAssumption[]> {
  const expected = await expectedContentFor(input.sidecarDir, round, input.mode)
  return expected.assumptions
}

/** The rendered auto-approve markdown — exposed for the gate file's audit trail. */
export function renderedAutoApproveOf(decision: PolicyDecision, assumptions: readonly GateAssumption[]): string {
  return renderGateAnswers(renderAutoApproveAnswers(decision, assumptions))
}
