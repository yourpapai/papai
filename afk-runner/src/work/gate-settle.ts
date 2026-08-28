// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { GateOutcome, StageId } from '../events.js'
import { renderGateAnswers } from './gate-answers.js'
import type { GateAnswers } from './gate-answers.js'
import { gatherAssumptions } from './gate-digest-extract.js'
import type { GateDeps } from './gate-files.js'
import { verifyGateIntegrity } from './gate-files.js'
import type { ExpectedGateContent, GateResponse } from './gate-model.js'
import { parseGateResponse } from './gate-model.js'
import { ResolverOutputSchema } from './review-loop.js'
import type { ReviewLoopResult } from './review-loop.js'

export type SettleOutcome = GateOutcome

export interface SettleInput {
  readonly gate: GateDeps
  readonly version: number
  readonly gateMode: 'early' | 'final' | 'escalation'
  /** The still-active failed stage at an escalation gate — the retry mover's target (C6 D4). */
  readonly failedStage?: StageId
  readonly expected: ExpectedGateContent
  /** The folded round status — the extend mover opens round n+1 at cap+1. */
  readonly round: { readonly current: number; readonly cap: number } | null
}

export interface SettleResult {
  readonly outcome: SettleOutcome
  readonly vetoes: readonly { readonly id: string; readonly redirect?: string }[]
  /** The mode the answered event carries (legacy-faithful: extend keeps the gate's mode, the rest say final; escalation gates always say escalation). */
  readonly answeredMode: 'early' | 'final' | 'escalation'
}

/** The escalation gate's expected content: the trajectory ack, nothing else — no assumptions, no blockers, no veto (C6 D4). */
export function escalationExpectedContent(): ExpectedGateContent {
  return { assumptions: [], blockers: [], requiredAck: 'T1', gateMode: 'escalation' }
}

export function outcomeOfResponse(response: GateResponse): SettleOutcome {
  if (response.abort) return 'abort'
  if (response.extend) return 'extend'
  if (response.approved) return 'approve'
  return 'veto'
}

/**
 * Settle from an answers object (TUI-shape producer, ladder, steer): render
 * the answers into the gate file, then run the file through the seam — the
 * rendered text must parse back as the same decision (design D5).
 */
export async function settleGateWithAnswers(input: SettleInput, answers: GateAnswers): Promise<SettleResult> {
  const md = renderGateAnswers(answers)
  await writeFile(path.join(input.gate.runDir, `gate-${input.version}.md`), md)
  return settleGateFile(input)
}

/**
 * The one settle seam every producer funnels into (design D5): parse the
 * gate file's response against the expected content, verify artifact
 * integrity for the approve/veto paths, then append the `gate answered`
 * event with its explicit outcome and the outcome's mover event through the
 * boundary — extend re-opens the review round (n+1, cap+1), approve on an
 * early gate enters decompose, veto re-enters draft, abort appends nothing.
 *
 * C5 outcome ordering (D3) at a FINAL gate, where the presentation entered
 * the gate stage in the map: approve appends the gate stage exit BEFORE the
 * answered event so the completed edge fires on the answer (corpus-identical
 * — a uniform exit-first ordering would wrongly complete extend/veto runs);
 * extend and veto append the answered event first (the guard correctly
 * blocks completion while the gate stage is still active), then the exit for
 * map hygiene, then the mover; abort appends the answered event alone (the
 * aborted edge ignores the map). Early gates never entered the gate stage,
 * so no exit is appended there.
 */
export async function settleGateFile(input: SettleInput): Promise<SettleResult> {
  const gateMdPath = path.join(input.gate.runDir, `gate-${input.version}.md`)
  const md = await readFile(gateMdPath, 'utf8')
  const response = parseGateResponse(md, input.expected)
  const outcome = outcomeOfResponse(response)
  // Escalation gates present no artifact-hashes sidecar (their content is the
  // failure ledger, not the digest) — integrity verification is final/early only.
  if ((outcome === 'approve' || outcome === 'veto') && input.gateMode !== 'escalation') {
    await verifyGateIntegrity(input.gate, input.version)
  }
  const answeredMode = input.gateMode === 'escalation' ? 'escalation' : outcome === 'extend' ? input.gateMode : 'final'
  const emitAnswered = (): void => {
    input.gate.emit({
      altitude: 'L2',
      type: 'gate',
      action: 'answered',
      mode: answeredMode,
      version: input.version,
      outcome,
    })
  }
  const emitGateStageExit = (): void => {
    input.gate.emit({ altitude: 'L2', type: 'stage_exit', stage: 'gate' })
  }
  const owesExit = input.gateMode === 'final' && outcome !== 'abort'
  if (owesExit && outcome === 'approve') {
    emitGateStageExit()
    emitAnswered()
    return { outcome, vetoes: response.vetoes, answeredMode }
  }
  emitAnswered()
  if (owesExit) emitGateStageExit()
  appendMover(input, outcome)
  return { outcome, vetoes: response.vetoes, answeredMode }
}

function appendMover(input: SettleInput, outcome: SettleOutcome): void {
  if (input.gateMode === 'escalation') {
    const failedStage = input.failedStage
    if (outcome === 'approve' && failedStage !== undefined) {
      // approve retries the failed stage — the ledger keeps counting (each
      // approve buys exactly one more attempt; C6 D4).
      input.gate.emit({ altitude: 'L2', type: 'stage_enter', stage: failedStage })
      return
    }
    if (outcome === 'extend' && failedStage !== undefined) {
      // extend grants fresh budget: the failed stage's exit clears its ledger
      // (C6 D2), then the same retry mover re-enters it.
      input.gate.emit({ altitude: 'L2', type: 'stage_exit', stage: failedStage })
      input.gate.emit({ altitude: 'L2', type: 'stage_enter', stage: failedStage })
      return
    }
    return
  }
  if (outcome === 'extend') {
    const round = input.round ?? { current: 0, cap: 1 }
    input.gate.emit({ altitude: 'L2', type: 'round_open', round: round.current + 1, cap: round.cap + 1 })
    return
  }
  if (outcome === 'approve' && input.gateMode === 'early') {
    input.gate.emit({ altitude: 'L2', type: 'stage_enter', stage: 'decompose' as StageId })
    return
  }
  if (outcome === 'veto') {
    input.gate.emit({ altitude: 'L2', type: 'stage_enter', stage: 'draft' as StageId })
  }
}

/** Review result from a round's resolver sidecar (gate-digest copy, fail-empty). */
export async function readReviewResultFromSidecars(
  sidecarDir: string,
  round: number,
  outcome: 'converged' | 'cap-hit',
): Promise<ReviewLoopResult> {
  try {
    const raw = await readFile(path.join(sidecarDir, `resolutions-${round}.json`), 'utf8')
    const parsed = ResolverOutputSchema.parse(JSON.parse(raw))
    return {
      outcome,
      rounds: round,
      openBlockers: parsed.resolutions.filter((entry) => entry.class === 'BLOCKER'),
      openMaterial: parsed.resolutions.filter((entry) => entry.class === 'MATERIAL'),
      openNitpicks: parsed.resolutions.filter((entry) => entry.class === 'NITPICK'),
    }
  } catch {
    return { outcome, rounds: round, openBlockers: [], openMaterial: [], openNitpicks: [] }
  }
}

/** Expected gate content at settle time (prepareResumeInput copy): assumptions, blockers, findings, ack. */
export async function expectedContentFor(
  sidecarDir: string,
  round: number,
  gateMode: 'early' | 'final' | 'escalation',
): Promise<ExpectedGateContent> {
  if (gateMode === 'escalation') return escalationExpectedContent()
  const assumptions = await gatherAssumptions(sidecarDir, round)
  const capHitFired = gateMode === 'early'
  const reviewResult = await readReviewResultFromSidecars(sidecarDir, round, capHitFired ? 'cap-hit' : 'converged')
  const blockerIds = new Set(reviewResult.openBlockers.map((entry) => entry.id))
  return {
    assumptions,
    blockers: [...blockerIds].map((id) => ({ id, gap: id, evidence: '' })),
    ...(reviewResult.openMaterial.length === 0
      ? {}
      : {
          findings: reviewResult.openMaterial.map((entry) => ({
            id: entry.id,
            gap: entry.id,
            evidence: `${entry.resolution} — ${entry.outcome ?? entry.justification ?? ''}`,
          })),
        }),
    ...(capHitFired && blockerIds.size === 0 ? { requiredAck: 'T1' } : {}),
    gateMode,
  }
}
