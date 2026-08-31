// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { Resolution } from '../agent-layer.js'
import type { GateOutcome, StageId } from '../events.js'
import type { FindingCounts } from '../events.js'
import { renderGateAnswers } from './gate-answers.js'
import type { GateAnswers } from './gate-answers.js'
import { responseFromAnswers } from './gate-answers.js'
import { gatherAssumptions } from './gate-digest-extract.js'
import type { GateDeps } from './gate-files.js'
import { verifyGateIntegrity } from './gate-files.js'
import type { ExpectedGateContent, GateResponse } from './gate-model.js'
import { parseGateResponse } from './gate-model.js'
import { readRoundDigests } from './materialize.js'
import { ResolverOutputSchema } from './review-loop.js'
import type { ReviewLoopResult } from './review-loop.js'
import { evaluateConvergence, isOpenResolution } from './review-model.js'

const EMPTY_COUNTS: FindingCounts = { blocker: 0, material: 0, nitpick: 0 }

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

/** A contained settle rejection (D3): operator-input failure as data — the reason reaches the operator, nothing is appended. */
export interface GateSettleRejection {
  readonly kind: 'rejected'
  readonly reason: string
}

export type SettleFileResult = SettleResult | GateSettleRejection

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
 * The render⇄parse roundtrip check (design D2/D5): the rendered text must
 * parse back as exactly the decision the answers encode — compared as the
 * full response shape, so a flipped outcome, a lost redirect, or a dropped
 * veto all fail before anything is written.
 */
function preflightRoundtrip(md: string, answers: GateAnswers, expected: ExpectedGateContent): GateResponse {
  const parsed = parseGateResponse(md, expected)
  const intended = responseFromAnswers(answers)
  if (
    parsed.approved !== intended.approved ||
    parsed.abort !== intended.abort ||
    parsed.extend !== intended.extend ||
    parsed.override !== intended.override ||
    parsed.gateVetoRedirect !== intended.gateVetoRedirect ||
    parsed.vetoes.length !== intended.vetoes.length ||
    parsed.vetoes.some((veto, index) => {
      const want = intended.vetoes[index]
      return want === undefined || veto.id !== want.id || veto.redirect !== want.redirect
    }) ||
    parsed.answers.length !== intended.answers.length ||
    parsed.answers.some((answer, index) => {
      const want = intended.answers[index]
      return want === undefined || answer.id !== want.id || answer.answer !== want.answer
    })
  ) {
    throw new Error(
      `producer settle round-trip failed: rendered ${answers.decision} answers parse as ${parsed.abort ? 'abort' : parsed.extend ? 'extend' : parsed.approved ? 'approve' : 'veto'} — nothing written`,
    )
  }
  return parsed
}

/**
 * Settle from an answers object (TUI-shape producer, ladder, steer): render
 * the answers into the gate file, then run the file through the seam — the
 * rendered text must parse back as the same decision (design D5). The
 * round-trip is pre-flighted in memory: a failed or flipped parse
 * overwrites nothing and appends nothing (D2). Producer-lane failures stay
 * crash-shaped: a rejection after the write rethrows as the refusal alarm.
 */
export async function settleGateWithAnswers(input: SettleInput, answers: GateAnswers): Promise<SettleResult> {
  const md = renderGateAnswers(answers)
  preflightRoundtrip(md, answers, input.expected)
  await writeFile(path.join(input.gate.runDir, `gate-${input.version}.md`), md)
  const result = await settleGateFile(input)
  if ('kind' in result) {
    throw new Error(`producer settle failed after write: ${result.reason}`)
  }
  return result
}

/**
 * The one settle seam every producer funnels into (design D5): parse the
 * gate file's response against the expected content, verify artifact
 * integrity for the approve/veto paths, then append the `gate answered`
 * event with its explicit outcome and the outcome's mover event through the
 * boundary — extend re-opens the review round (n+1, cap+1), approve on an
 * early gate enters decompose, veto re-enters draft, abort appends nothing.
 *
 * Total over operator input (D3): parse, integrity, and sidecar failures
 * return a rejected-shape result carrying the reason instead of throwing —
 * the waiter turns a rejection into feedback and keeps waiting.
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
export async function settleGateFile(input: SettleInput): Promise<SettleFileResult> {
  try {
    return await settleGateFileChecked(input)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { kind: 'rejected', reason: withEmptyExpectedHint(reason, input.expected) }
  }
}

/** The empty-expected hint (D3): an unknown-item rejection at a gate whose expected content is empty suggests a missing sidecar. */
function withEmptyExpectedHint(reason: string, expected: ExpectedGateContent): string {
  const expectedEmpty =
    expected.assumptions.length === 0 && expected.blockers.length === 0 && (expected.findings ?? []).length === 0
  if (!expectedEmpty || !/unknown (assumption|finding|blocker)/u.test(reason)) return reason
  return `${reason} — the gate's expected content is empty; a missing sidecar can cause this`
}

async function settleGateFileChecked(input: SettleInput): Promise<SettleResult> {
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
    if ((outcome === 'approve' || outcome === 'extend') && failedStage !== undefined) {
      // Both retry outcomes re-enter the failed stage through a fresh bracket:
      // the exit clears its failure ledger (C6 D2 — the budget counts the
      // CURRENT bracket's consecutive failures), so the next failure counts
      // from zero and the pure `escalationOwed` check stays sound.
      input.gate.emit({ altitude: 'L2', type: 'stage_exit', stage: failedStage })
      input.gate.emit({ altitude: 'L2', type: 'stage_enter', stage: failedStage })
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

/**
 * Rebuild a round's review result from its sidecars, applying the same openness
 * predicate the live loop used. A resumed run's gate must see the set the run
 * would have seen; recomputing it by class alone would show a resumed operator
 * findings the live one had already settled.
 */
export async function readReviewResultFromSidecars(
  sidecarDir: string,
  round: number,
  outcome: 'converged' | 'cap-hit',
): Promise<ReviewLoopResult> {
  // An unreadable sidecar keeps the pre-change reading — empty buckets, treated
  // as converged — rather than becoming a new gating condition here. The
  // ladder's integrity cross-check is what fails closed on an unparseable
  // sidecar; duplicating that in the reader would change resume routing.
  const empty = { outcome, rounds: round, verdict: 'converged', raised: EMPTY_COUNTS } as const
  try {
    const raw = await readFile(path.join(sidecarDir, `resolutions-${round}.json`), 'utf8')
    const parsed = ResolverOutputSchema.parse(JSON.parse(raw))
    const [current, previous] = await Promise.all([
      readRoundDigests(sidecarDir, round),
      readRoundDigests(sidecarDir, round - 1),
    ])
    const context = { assumptions: parsed.assumptions, digests: { previous, current: current ?? {} } }
    const { verdict, raised } = evaluateConvergence(parsed.resolutions, context)
    const openOf = (cls: Resolution['class']): Resolution[] =>
      parsed.resolutions.filter((r) => r.class === cls && isOpenResolution(r, context.assumptions, context.digests))
    return {
      outcome,
      rounds: round,
      verdict,
      raised,
      openBlockers: openOf('BLOCKER'),
      openMaterial: openOf('MATERIAL'),
      openNitpicks: openOf('NITPICK'),
    }
  } catch {
    return { ...empty, openBlockers: [], openMaterial: [], openNitpicks: [] }
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
