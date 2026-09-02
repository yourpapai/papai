// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'

import type { AutonomyConfig } from '../config.js'
import type { EventInput, StageId } from '../events.js'
import { readEvents } from '../events.js'
import { foldLogOrInitial } from '../kernel/fold.js'
import type { KernelMachine } from '../kernel/machine.js'
import type { PolicyDecision } from './auto-policy.js'
import { claimGateSettle, releaseGateSettle } from './gate-claims.js'
import type { GateAssumption } from './gate-model.js'
import { evaluateLadder, renderAutoApproveAnswers } from './gate-prelude.js'
import { expectedContentFor, readReviewResultFromSidecars, settleGateWithAnswers } from './gate-settle.js'
import type { GateWaiterResult } from './gate-waiter.js'

/** The expiry-facing slice of the waiter ports (structurally compatible with GateWaiterPorts). */
export interface ExpiryPorts {
  readonly runDir: string
  readonly logPath: string
  readonly sidecarDir: string
  readonly changeDir: string
  readonly machine: KernelMachine
  readonly emit: (event: EventInput) => void
  readonly stdout?: (line: string) => void
  readonly repoRoot?: string
  readonly autonomy?: AutonomyConfig
  readonly now?: () => Date
}

/**
 * Deadline expiry (design D4, attempt-scoped): claim the gate under the same
 * pid-carried `settle-claim` every producer uses, re-run the ladder with
 * expiry semantics (conservative branches only — approve/extend, never
 * abort), settle through the seam when one applies, release the claim at
 * the attempt's end, re-arm at most once via one additive `gate rearmed`
 * event, and otherwise leave the gate pending indefinitely. Returns null to
 * keep waiting.
 *
 * Every claimed outcome appends the standard `auto_decision` L2 event after
 * its write — settle names the deciding rule, re-arm and stay-pending
 * record `none`/`pending` — so replay alone distinguishes waiter-settled
 * gates from human-settled ones (which emit nothing). A lost claim appends
 * nothing: another producer owns the gate.
 */
export async function processExpiry(
  ports: ExpiryPorts,
  version: number,
  gateMode: 'early' | 'final' | 'escalation',
  round: { readonly current: number; readonly cap: number } | null,
  deadlineAt: string | null,
  reArmed: boolean,
  failedStage: StageId | null,
): Promise<GateWaiterResult | null> {
  if (deadlineAt === null || ports.now === undefined || ports.repoRoot === undefined || ports.autonomy === undefined) {
    return null
  }
  if (ports.now().getTime() < new Date(deadlineAt).getTime()) return null
  const claimant = `waiter-${process.pid}`
  const claim = claimGateSettle(ports.runDir, version, claimant)
  if (!claim.claimed) {
    ports.stdout?.(`gate ${version} expiry already claimed by another process`)
    return { kind: 'external' }
  }
  try {
    const currentRound = round?.current ?? 1
    const { decision, assumptions } = await evaluateExpiryLadder(
      ports,
      version,
      gateMode,
      currentRound,
      ports.repoRoot,
      ports.autonomy,
    )
    if (decision.action === 'approve' || decision.action === 'extend') {
      return await settleExpiryDecision(
        ports,
        version,
        gateMode,
        round,
        failedStage,
        currentRound,
        decision,
        assumptions,
      )
    }
    return reArmOrPark(ports, version, gateMode, reArmed)
  } finally {
    releaseGateSettle(ports.runDir, version, claimant)
  }
}

/** Re-run the ladder with expiry semantics (conservative branches only — approve/extend, never abort). */
async function evaluateExpiryLadder(
  ports: ExpiryPorts,
  version: number,
  gateMode: 'early' | 'final' | 'escalation',
  currentRound: number,
  repoRoot: string,
  autonomy: AutonomyConfig,
): Promise<{ readonly decision: PolicyDecision; readonly assumptions: readonly GateAssumption[] }> {
  const reviewResult = await readReviewResultFromSidecars(
    ports.sidecarDir,
    currentRound,
    gateMode === 'early' ? 'cap-hit' : 'converged',
  )
  const assumptions = (await expectedContentFor(ports.sidecarDir, currentRound, gateMode)).assumptions
  const decision = await evaluateLadder(
    {
      version,
      mode: gateMode,
      reviewResult,
      context: foldLogOrInitial(ports.machine, ports.logPath).snapshot.context,
      events: readEvents(ports.logPath),
      sidecarDir: ports.sidecarDir,
      changeDir: ports.changeDir,
      runDir: ports.runDir,
      repoRoot,
      emit: ports.emit,
      autonomy,
    },
    assumptions,
    true,
  )
  return { decision, assumptions }
}

/** Re-arm once via one additive `gate rearmed` event, then leave the gate pending indefinitely. */
function reArmOrPark(
  ports: ExpiryPorts,
  version: number,
  gateMode: 'early' | 'final' | 'escalation',
  reArmed: boolean,
): null {
  if (reArmed) {
    ports.stdout?.('auto-deadline: no safe policy branch — gate stays pending')
    emitPendingExpiryDecision(ports, version)
    return null
  }
  const reArmMinutes = ports.autonomy?.deadlineMinutes ?? 10
  const now = ports.now === undefined ? new Date() : ports.now()
  const nextDeadline = new Date(now.getTime() + reArmMinutes * 60_000).toISOString()
  ports.emit({
    altitude: 'L2',
    type: 'gate',
    action: 'rearmed',
    mode: gateMode,
    version,
    deadlineAt: nextDeadline,
  })
  ports.stdout?.(`auto-deadline: no safe policy branch — re-armed once at ${nextDeadline}`)
  emitPendingExpiryDecision(ports, version)
  return null
}

/** The waiter's pending record: rule none, decision pending, version-keyed digest. */
function emitPendingExpiryDecision(ports: ExpiryPorts, version: number): void {
  ports.emit({
    altitude: 'L2',
    type: 'auto_decision',
    rule: 'none',
    decision: 'pending',
    evidenceDigest: createHash('sha256').update(`expiry-pending:${version}`).digest('hex'),
    gateVersion: version,
  })
}

/** Settle through the seam when the expiry ladder picked a conservative branch (approve/extend, never abort). */
async function settleExpiryDecision(
  ports: ExpiryPorts,
  version: number,
  gateMode: 'early' | 'final' | 'escalation',
  round: { readonly current: number; readonly cap: number } | null,
  failedStage: StageId | null,
  currentRound: number,
  decision: PolicyDecision,
  assumptions: readonly GateAssumption[],
): Promise<GateWaiterResult> {
  const result = await settleGateWithAnswers(
    {
      gate: {
        emit: ports.emit,
        runDir: ports.runDir,
        changeDir: ports.changeDir,
        driftCheck: () => Promise.resolve(),
      },
      version,
      gateMode,
      expected: await expectedContentFor(ports.sidecarDir, currentRound, gateMode),
      round,
      ...(failedStage === null ? {} : { failedStage }),
    },
    decision.action === 'approve'
      ? renderAutoApproveAnswers(decision, assumptions)
      : { items: [], blockerAnswers: [], acks: [], decision: 'extend' },
  )
  // Machine producers rethrow rejections (D1): a settle that cannot land must
  // stay loud instead of silently no-opping the expiry.
  if ('kind' in result) {
    throw new Error(`expiry settle rejected after the ladder decided: ${result.reason}`)
  }
  ports.emit({
    altitude: 'L2',
    type: 'auto_decision',
    rule: decision.rule,
    decision: decision.action === 'extend' ? 'extend' : 'approve',
    evidenceDigest: decision.evidenceDigest,
    gateVersion: version,
  })
  return { kind: 'settled', outcome: result.outcome }
}
