// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

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
  | {
      readonly kind: 'child'
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
}

const EXTEND_DIRECTIVE = '→ RUN 1 MORE'
const OVERRIDE_TOKEN = 'OVERRIDE'

/**
 * Every free-text field below lands inside a single line of gate grammar, and
 * agent-authored prose reaches them — a finding row carries the reviewer's
 * verbatim gap. A newline in one would open a second physical line the parser
 * reads as a directive (`ABORT`, `→ RUN 1 MORE`, a checkbox row of its own).
 * The renderer is the single writer of gate files, so it flattens here rather
 * than trusting every caller to have sanitized first; `responseFromAnswers`
 * flattens the same fields so the answers denote what the file actually says.
 */
function flatten(text: string): string {
  return text.replace(/\s+/gu, ' ').trim()
}

/** A redirect that flattens to nothing renders no `→` line, so it is no redirect. */
function redirectOf(redirect: string | undefined): string | undefined {
  if (redirect === undefined) return undefined
  const flat = flatten(redirect)
  return flat === '' ? undefined : flat
}

export function responseFromAnswers(answers: GateAnswers): GateResponse {
  if (answers.decision === 'abort') {
    return { approved: false, abort: true, override: false, extend: false, vetoes: [], answers: [] }
  }
  if (answers.decision === 'extend') {
    return { approved: false, abort: false, override: false, extend: true, vetoes: [], answers: [] }
  }
  const vetoes = answers.items
    .filter((item) => !item.accepted)
    .map((item) => {
      const redirect = redirectOf(item.redirect)
      return redirect === undefined ? { id: item.id } : { id: item.id, redirect }
    })
  const overrides = answers.blockerAnswers.filter((blocker) => flatten(blocker.answer) === OVERRIDE_TOKEN)
  const answered = answers.blockerAnswers.filter((blocker) => flatten(blocker.answer) !== OVERRIDE_TOKEN)
  const approved = answers.decision === 'approve' && vetoes.length === 0
  return {
    approved,
    abort: false,
    override: overrides.length > 0,
    extend: false,
    vetoes,
    answers: answered.map((blocker) => ({ id: blocker.id, answer: flatten(blocker.answer) })),
  }
}

export function renderGateAnswers(answers: GateAnswers): string {
  if (answers.decision === 'abort') return 'ABORT\n'
  if (answers.decision === 'extend') return `${EXTEND_DIRECTIVE}\n`
  const lines: string[] = ['## Gate response', '']
  if (answers.decidedBy !== undefined) {
    lines.push(`decided-by: ${flatten(answers.decidedBy)}`, '')
  }
  for (const ack of answers.acks) lines.push(`- [x] ${ack.id} ${flatten(ack.text)}`)
  if (answers.acks.length > 0) lines.push('')
  for (const item of answers.items) {
    const suffix = item.decidedBy === undefined ? '' : ` · decided-by: ${flatten(item.decidedBy)}`
    lines.push(`- [${item.accepted ? 'x' : ' '}] ${item.id} ${flatten(item.text)}${suffix}`)
    const redirect = item.accepted ? undefined : redirectOf(item.redirect)
    if (redirect !== undefined) lines.push(`→ ${redirect}`)
  }
  if (answers.items.length > 0) lines.push('')
  for (const blocker of answers.blockerAnswers) {
    lines.push(`${blocker.id} ${flatten(blocker.gap)}`, `→ ${flatten(blocker.answer)}`)
  }
  if (answers.blockerAnswers.length > 0) lines.push('')
  return `${lines.join('\n')}\n`
}
