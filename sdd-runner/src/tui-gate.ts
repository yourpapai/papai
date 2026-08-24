// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Box, Text } from 'ink'
import { createElement } from 'react'

import type { GateAnswers, GateAnswerItem } from './gate-answers.js'
import type { GateSessionView } from './gate-session.js'
import { consequenceLines } from './gate-session.js'

/**
 * TUI gate screen (D4): every assumption, open finding, and blocker as an
 * item with its evidence; checkbox toggles and text redirects collected
 * in-view; approve/extend/abort with consequences rendered beside them.
 * Approve stays unavailable until the trajectory ack is affirmed and every
 * blocker is answered — the constraint lives here in pure view logic the
 * component renders, not in the component's own state.
 */
export interface GateToggles {
  readonly toggles: Readonly<Record<string, boolean>>
  readonly redirects: Readonly<Record<string, string>>
  readonly blockerAnswers: Readonly<Record<string, string>>
  readonly ackAffirmed: boolean
}

export interface GateScreenProps extends GateToggles {
  readonly view: GateSessionView
  readonly width: number
  readonly cursor?: number
}

/** Approve is unavailable until the ack is affirmed and every blocker answered. */
export function approveBlockers(view: GateSessionView, state: GateToggles): string | null {
  const missing: string[] = []
  if (!state.ackAffirmed && view.requiredAck !== null) missing.push(`${view.requiredAck.id} not affirmed`)
  for (const blocker of view.blockers) {
    if (state.blockerAnswers[blocker.id] === undefined) missing.push(`blocker ${blocker.id} unanswered`)
  }
  return missing.length === 0 ? null : `approve unavailable: ${missing.join(', ')}`
}

function answerItems(view: GateSessionView, state: GateToggles): readonly GateAnswerItem[] {
  return view.items.map((item) => ({
    kind: item.kind,
    id: item.id,
    text: item.text,
    accepted: state.toggles[item.id] !== false,
    ...(state.redirects[item.id] === undefined ? {} : { redirect: state.redirects[item.id] }),
    ...(item.decidedBy === undefined ? {} : { decidedBy: item.decidedBy }),
  }))
}

/**
 * Build the `GateAnswers` the file-writing seam persists — the same
 * write-then-parse self-check path guards the result as hand edits.
 */
export function gateAnswersFromToggles(view: GateSessionView, state: GateToggles): GateAnswers {
  const items = answerItems(view, state)
  const blockerAnswers = view.blockers
    .filter((blocker) => state.blockerAnswers[blocker.id] !== undefined)
    .map((blocker) => ({ id: blocker.id, gap: blocker.gap, answer: state.blockerAnswers[blocker.id] ?? '' }))
  const acks =
    view.requiredAck !== null && state.ackAffirmed ? [{ id: view.requiredAck.id, text: view.requiredAck.text }] : []
  const anyDeclined = items.some((item) => !item.accepted)
  return { items, blockerAnswers, acks, decision: anyDeclined ? 'veto' : 'approve' }
}

type GateLine = { readonly key: string; readonly text: string }

function gateScreenLines(view: GateSessionView, state: GateToggles, cursor: number): GateLine[] {
  let row = -1
  const mark = (): string => {
    row += 1
    return row === cursor ? '❯ ' : '  '
  }
  const lines: GateLine[] = []
  lines.push({ key: 'mode', text: `## Gate (${view.gateMode})` })
  for (const item of view.items) {
    const accepted = state.toggles[item.id] !== false
    const readOnly = item.decidedBy !== undefined
    const check = readOnly || accepted ? '[x]' : '[ ]'
    const suffix = readOnly ? ` · decided-by: ${item.decidedBy} (read-only)` : ''
    lines.push({ key: item.id, text: `${mark()}${check} ${item.id} ${item.text}${suffix}` })
    if (!accepted && state.redirects[item.id] !== undefined) {
      lines.push({ key: `${item.id}-r`, text: `→ ${state.redirects[item.id]}` })
    }
    if (!readOnly) {
      lines.push({ key: `${item.id}-e`, text: `    evidence: ${item.evidence === '' ? '(none)' : item.evidence}` })
    }
  }
  if (view.blockers.length > 0) {
    lines.push({ key: 'blockers-h', text: '## Blockers' })
    for (const blocker of view.blockers) {
      lines.push({ key: blocker.id, text: `${mark()}${blocker.id} ${blocker.gap}` })
      const answer = state.blockerAnswers[blocker.id]
      lines.push({ key: `${blocker.id}-a`, text: answer === undefined ? '→ (unanswered)' : `→ ${answer}` })
    }
  }
  if (view.requiredAck !== null) {
    lines.push({
      key: 'ack',
      text: `${mark()}[${state.ackAffirmed ? 'x' : ' '}] ${view.requiredAck.id} ${view.requiredAck.text} (toggle to affirm)`,
    })
  }
  const consequences = consequenceLines(view)
  for (const line of consequences) {
    if (line === 'Decision:') continue
    if (line.startsWith('  approve')) lines.push({ key: 'c-a', text: line.replace('  approve —', '(a)pprove —') })
    else if (line.startsWith('  extend')) lines.push({ key: 'c-e', text: line.replace('  extend —', '(e)xtend —') })
    else if (line.startsWith('  abort')) lines.push({ key: 'c-x', text: line.replace('  abort —', '(x)abort —') })
    else lines.push({ key: `c-${line}`, text: line })
  }
  return lines
}

export function createGateScreen(): (props: GateScreenProps) => ReturnType<typeof createElement> {
  return function GateScreen(props: GateScreenProps): ReturnType<typeof createElement> {
    const { view } = props
    const lines = gateScreenLines(view, props, props.cursor ?? 0)
    const blocked = approveBlockers(view, props)
    if (blocked !== null) lines.push({ key: 'blocked', text: blocked })
    return createElement(
      Box,
      { flexDirection: 'column' },
      ...lines.map((line) => createElement(Text, { key: line.key }, line.text)),
    )
  }
}
