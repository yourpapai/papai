// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { renderGateAnswers, responseFromAnswers } from './gate-answers.js'
import type { GateAnswerItem, GateAnswers } from './gate-answers.js'
import { parseGateResponse } from './gate-model.js'
import type { ExpectedGateContent, GateResponse } from './gate-model.js'
import { decisionConsequences } from './gate-render.js'

export interface GateSessionItem {
  readonly kind: 'assumption' | 'finding' | 'child'
  readonly id: string
  readonly text: string
  readonly evidence: string
  readonly blastRadius: string
  /** Policy attribution: a pre-checked item the TUI renders read-only. */
  readonly decidedBy?: string
}

export interface GateSessionBlocker {
  readonly id: string
  readonly gap: string
  readonly evidence: string
}

export interface GateSessionView {
  readonly gateMode: 'early' | 'final' | 'plan'
  readonly items: readonly GateSessionItem[]
  readonly blockers: readonly GateSessionBlocker[]
  readonly requiredAck: { readonly id: string; readonly text: string } | null
}

export type GateSessionResult =
  | { readonly status: 'answered'; readonly decision: GateAnswers['decision']; readonly gateMd: string }
  | { readonly status: 'abandoned' }

/**
 * The decision-menu consequence lines, rendered from the same
 * mode-conditional phrases the gate file's `### Decisions` block uses — one
 * copy source, two front-ends (Decision 6).
 */
export function consequenceLines(view: GateSessionView): string[] {
  const c = decisionConsequences(view.gateMode)
  const lines = ['Decision:', `  approve — ${c.approve}`]
  if (c.extend !== null) lines.push(`  extend — ${c.extend}`)
  lines.push(`  abort — ${c.abort}`)
  return lines
}

function expectedContent(view: GateSessionView): ExpectedGateContent {
  return {
    assumptions: view.items
      .filter((item) => item.kind === 'assumption')
      .map((item) => ({ id: item.id, text: item.text, blast_radius: item.blastRadius })),
    blockers: view.blockers.map((blocker) => ({ id: blocker.id, gap: blocker.gap, evidence: blocker.evidence })),
    findings: view.items
      .filter((item) => item.kind === 'finding')
      .map((item) => ({ id: item.id, gap: item.text, evidence: item.evidence })),
    children: view.items.filter((item) => item.kind === 'child').map((item) => ({ id: item.id, text: item.text })),
    ...(view.requiredAck === null ? {} : { requiredAck: view.requiredAck.id }),
    gateMode: view.gateMode,
  }
}

function sameResponse(a: GateResponse, b: GateResponse): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export interface FlagDecisionInput {
  readonly confirmAll?: boolean
  readonly abort?: boolean
  readonly extend?: boolean
  readonly vetoes?: readonly { readonly id: string; readonly redirect?: string }[]
  /** Optional policy attribution rendered as a decision-level decided-by line. */
  readonly decidedBy?: string
}

/**
 * Desugar decision flags to the same answers the session collects (Decision
 * 5): `--confirm-all` accepts every item, answers every blocker with
 * OVERRIDE, and affirms the ack; each `--veto <id>=<redirect>` then
 * un-accepts its item with the redirect. Unknown veto ids fail before
 * anything is written. No flags at all is not a decision — the hand-edited
 * file path handles that case.
 */
export function desugarFlags(
  flags: FlagDecisionInput,
  view: GateSessionView,
  writeGateMd: (md: string) => Promise<void>,
): Promise<GateSessionResult> {
  if (flags.abort === true) {
    return settleAnswers({ items: [], blockerAnswers: [], acks: [], decision: 'abort' }, view, writeGateMd)
  }
  if (flags.extend === true) {
    return settleAnswers({ items: [], blockerAnswers: [], acks: [], decision: 'extend' }, view, writeGateMd)
  }
  if (flags.confirmAll !== true) {
    return Promise.reject(
      new Error('no decision flags given — pass --confirm-all/--veto/--abort/--extend, or hand-edit the gate file'),
    )
  }
  const known = new Set(view.items.map((item) => item.id))
  for (const veto of flags.vetoes ?? []) {
    if (!known.has(veto.id)) {
      return Promise.reject(new Error(`unknown veto id: ${veto.id} (not in this gate's item set)`))
    }
  }
  const items: GateAnswerItem[] = view.items.map((item) => {
    const veto = (flags.vetoes ?? []).find((candidate) => candidate.id === item.id)
    if (veto === undefined) return { kind: item.kind, id: item.id, text: item.text, accepted: true }
    return {
      kind: item.kind,
      id: item.id,
      text: item.text,
      accepted: false,
      ...(veto.redirect === undefined ? {} : { redirect: veto.redirect }),
    }
  })
  const blockerAnswers = view.blockers.map((blocker) => ({ id: blocker.id, gap: blocker.gap, answer: 'OVERRIDE' }))
  const ack = view.requiredAck
  const acks = ack === null ? [] : [{ id: ack.id, text: ack.text }]
  return settleAnswers(
    {
      items,
      blockerAnswers,
      acks,
      decision: 'approve',
      ...(flags.decidedBy === undefined ? {} : { decidedBy: flags.decidedBy }),
    },
    view,
    writeGateMd,
  )
}

async function settleAnswers(
  answers: GateAnswers,
  view: GateSessionView,
  writeGateMd: (md: string) => Promise<void>,
): Promise<GateSessionResult> {
  const md = renderGateAnswers(answers)
  const parsed = parseGateResponse(md, expectedContent(view))
  if (!sameResponse(parsed, responseFromAnswers(answers))) {
    throw new Error('answer self-check failed: rendered answers parse back as a different outcome')
  }
  await writeGateMd(md)
  return { status: 'answered', decision: answers.decision, gateMd: md }
}
