// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { GateOutcome, StageId } from '../events.js'
import { renderGateAnswers } from './gate-answers.js'
import type { GateAnswers } from './gate-answers.js'
import type { GateDeps } from './gate-files.js'
import { verifyGateIntegrity } from './gate-files.js'
import type { ExpectedGateContent, GateResponse } from './gate-model.js'
import { parseGateResponse } from './gate-model.js'

export type SettleOutcome = GateOutcome

export interface SettleInput {
  readonly gate: GateDeps
  readonly version: number
  readonly gateMode: 'early' | 'final'
  readonly expected: ExpectedGateContent
  /** The folded round status — the extend mover opens round n+1 at cap+1. */
  readonly round: { readonly current: number; readonly cap: number } | null
}

export interface SettleResult {
  readonly outcome: SettleOutcome
  readonly vetoes: readonly { readonly id: string; readonly redirect?: string }[]
  /** The mode the answered event carries (legacy-faithful: extend keeps the gate's mode, the rest say final). */
  readonly answeredMode: 'early' | 'final'
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
 */
export async function settleGateFile(input: SettleInput): Promise<SettleResult> {
  const gateMdPath = path.join(input.gate.runDir, `gate-${input.version}.md`)
  const md = await readFile(gateMdPath, 'utf8')
  const response = parseGateResponse(md, input.expected)
  const outcome = outcomeOfResponse(response)
  if (outcome === 'approve' || outcome === 'veto') {
    await verifyGateIntegrity(input.gate, input.version)
  }
  const answeredMode = outcome === 'extend' ? input.gateMode : 'final'
  input.gate.emit({
    altitude: 'L2',
    type: 'gate',
    action: 'answered',
    mode: answeredMode,
    version: input.version,
    outcome,
  })
  appendMover(input, outcome)
  return { outcome, vetoes: response.vetoes, answeredMode }
}

function appendMover(input: SettleInput, outcome: SettleOutcome): void {
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
