// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { APPROVE_DIRECTIVE, VETO_DIRECTIVE } from './gate-model.js'
import type { GateResponse } from './gate-model.js'

export type GateAnswerItem =
  | {
      readonly kind: 'assumption'
      readonly id: string
      readonly text: string
      readonly accepted: boolean
      readonly redirect?: string
      /** Optional per-item attribution suffix (`· decided-by: policy Rx`). */
      readonly decidedBy?: string
    }
  | {
      readonly kind: 'finding'
      readonly id: string
      readonly text: string
      readonly accepted: boolean
      readonly redirect?: string
      /** Optional per-item attribution suffix (`· decided-by: policy Rx`). */
      readonly decidedBy?: string
    }

export interface GateBlockerAnswer {
  readonly id: string
  readonly gap: string
  readonly answer: string
}

export interface GateAck {
  readonly id: string
  readonly text: string
}

export interface GateAnswers {
  readonly items: readonly GateAnswerItem[]
  readonly blockerAnswers: readonly GateBlockerAnswer[]
  readonly acks: readonly GateAck[]
  readonly decision: 'approve' | 'veto' | 'extend' | 'abort'
  /** Optional decision-level attribution (`decided-by: policy Rx`). */
  readonly decidedBy?: string
  /**
   * Gate-level veto redirect (D1/D6): rides a veto decision that names no
   * item — rendered as the `VETO: <redirect>` directive.
   */
  readonly gateVetoRedirect?: string
}

const EXTEND_DIRECTIVE = '→ RUN 1 MORE'
const OVERRIDE_TOKEN = 'OVERRIDE'

export function responseFromAnswers(answers: GateAnswers): GateResponse {
  if (answers.decision === 'abort') {
    return {
      approved: false,
      abort: true,
      override: false,
      extend: false,
      vetoes: [],
      answers: [],
      gateVetoRedirect: null,
    }
  }
  if (answers.decision === 'extend') {
    return {
      approved: false,
      abort: false,
      override: false,
      extend: true,
      vetoes: [],
      answers: [],
      gateVetoRedirect: null,
    }
  }
  const vetoes = answers.items
    .filter((item) => !item.accepted)
    .map((item) => (item.redirect === undefined ? { id: item.id } : { id: item.id, redirect: item.redirect }))
  const overrides = answers.blockerAnswers.filter((blocker) => blocker.answer === OVERRIDE_TOKEN)
  const answered = answers.blockerAnswers.filter((blocker) => blocker.answer !== OVERRIDE_TOKEN)
  const approved = answers.decision === 'approve' && vetoes.length === 0
  return {
    approved,
    abort: false,
    override: overrides.length > 0,
    extend: false,
    vetoes,
    answers: answered.map((blocker) => ({ id: blocker.id, answer: blocker.answer })),
    gateVetoRedirect: answers.decision === 'veto' && vetoes.length === 0 ? (answers.gateVetoRedirect ?? '') : null,
  }
}

export function renderGateAnswers(answers: GateAnswers): string {
  if (answers.decision === 'abort') return 'ABORT\n'
  if (answers.decision === 'extend') return `${EXTEND_DIRECTIVE}\n`
  const lines: string[] = ['## Gate response', '']
  if (answers.decidedBy !== undefined) {
    lines.push(`decided-by: ${answers.decidedBy}`, '')
  }
  // Decision-level directives (D2): every machine-produced response names its
  // decision on its own line, so an item-less gate can never settle by
  // vacuous all-checked computation.
  if (answers.decision === 'approve') {
    lines.push(APPROVE_DIRECTIVE, '')
  } else if (answers.decision === 'veto' && answers.items.length === 0) {
    lines.push(
      answers.gateVetoRedirect === undefined ? VETO_DIRECTIVE : `${VETO_DIRECTIVE}: ${answers.gateVetoRedirect}`,
      '',
    )
  }
  for (const ack of answers.acks) lines.push(`- [x] ${ack.id} ${ack.text}`)
  if (answers.acks.length > 0) lines.push('')
  for (const item of answers.items) {
    const suffix = item.decidedBy === undefined ? '' : ` · decided-by: ${item.decidedBy}`
    lines.push(`- [${item.accepted ? 'x' : ' '}] ${item.id} ${item.text}${suffix}`)
    if (!item.accepted && item.redirect !== undefined) lines.push(`→ ${item.redirect}`)
  }
  if (answers.items.length > 0) lines.push('')
  for (const blocker of answers.blockerAnswers) {
    lines.push(`${blocker.id} ${blocker.gap}`, `→ ${blocker.answer}`)
  }
  if (answers.blockerAnswers.length > 0) lines.push('')
  return `${lines.join('\n')}\n`
}
