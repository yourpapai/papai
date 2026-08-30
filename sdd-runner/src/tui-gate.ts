// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Box, Text } from 'ink'
import { createElement } from 'react'

import type { GateAnswers, GateAnswerItem } from './gate-answers.js'
import type { GateSessionView } from './gate-session.js'
import { consequenceLines } from './gate-session.js'
import { frameBodyLine, frameBottom, frameTop, joinOrStack } from './tui-panels.js'
import { severityToken } from './tui-tokens.js'
import type { ColorMode } from './tui-tokens.js'

/**
 * TUI gate screen (D4): every assumption, open finding, and blocker as an
 * item with its evidence; checkbox toggles and text redirects collected
 * in-view; approve/extend/abort with consequences rendered beside them.
 * Approve stays unavailable until the trajectory ack is affirmed and every
 * blocker is answered — the constraint lives here in pure view logic the
 * component renders, not in the component's own state.
 *
 * Presentation (fancy-ui 6.1): framed panels in the one shared style —
 * items beside their evidence at wide width, evidence stacked under the
 * item below the join threshold — and the blocker severity token colors
 * blocker rows (decoration only; the text carries the meaning).
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
  readonly colorMode?: ColorMode
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

type GateRow = { readonly key: string; readonly text: string; readonly tone?: 'blocker' }

interface GatePanel {
  readonly title: string
  readonly rows: readonly GateRow[]
}

interface RowCursor {
  row: number
}

function mark(cursor: RowCursor, target: number): string {
  const current = cursor.row
  cursor.row += 1
  return current === target ? '❯ ' : '  '
}

function ackRow(view: GateSessionView, state: GateToggles, cursor: RowCursor, target: number): GateRow {
  return {
    key: 'ack',
    text: `${mark(cursor, target)}[${state.ackAffirmed ? 'x' : ' '}] ${view.requiredAck?.id ?? ''} ${view.requiredAck?.text ?? ''} (toggle to affirm)`,
  }
}

function gateItemRows(
  view: GateSessionView,
  state: GateToggles,
  cursor: RowCursor,
  target: number,
  wide: boolean,
): readonly GateRow[] {
  const rows: GateRow[] = []
  for (const line of view.concernHistory ?? []) rows.push({ key: `ch-${line}`, text: line })
  for (const item of view.items) {
    const accepted = state.toggles[item.id] !== false
    const readOnly = item.decidedBy !== undefined
    const check = readOnly || accepted ? '[x]' : '[ ]'
    const suffix = readOnly ? ` · decided-by: ${item.decidedBy} (read-only)` : ''
    const evidence = `evidence: ${item.evidence === '' ? '(none)' : item.evidence}`
    const besideEvidence = wide && !readOnly ? ` · ${evidence}` : ''
    rows.push({
      key: item.id,
      text: `${mark(cursor, target)}${check} ${item.id} ${item.text}${suffix}${besideEvidence}`,
    })
    if (!accepted && state.redirects[item.id] !== undefined) {
      rows.push({ key: `${item.id}-r`, text: `→ ${state.redirects[item.id]}` })
    }
    if (!wide && !readOnly) {
      rows.push({ key: `${item.id}-e`, text: `    ${evidence}` })
    }
  }
  return rows
}

function gateBlockerRows(
  view: GateSessionView,
  state: GateToggles,
  cursor: RowCursor,
  target: number,
): readonly GateRow[] {
  const rows: GateRow[] = []
  for (const blocker of view.blockers) {
    rows.push({ key: blocker.id, text: `${mark(cursor, target)}${blocker.id} ${blocker.gap}`, tone: 'blocker' })
    const answer = state.blockerAnswers[blocker.id]
    rows.push({ key: `${blocker.id}-a`, text: answer === undefined ? '→ (unanswered)' : `→ ${answer}` })
  }
  if (view.requiredAck !== null) rows.push(ackRow(view, state, cursor, target))
  return rows
}

function gateDecisionRows(view: GateSessionView, state: GateToggles): readonly GateRow[] {
  const rows: GateRow[] = []
  for (const line of consequenceLines(view)) {
    if (line === 'Decision:') continue
    if (line.startsWith('  approve')) rows.push({ key: 'c-a', text: line.replace('  approve —', '(a)pprove —') })
    else if (line.startsWith('  extend')) rows.push({ key: 'c-e', text: line.replace('  extend —', '(e)xtend —') })
    else if (line.startsWith('  abort')) rows.push({ key: 'c-x', text: line.replace('  abort —', '(x)abort —') })
    else rows.push({ key: `c-${line}`, text: line })
  }
  const blocked = approveBlockers(view, state)
  if (blocked !== null) rows.push({ key: 'blocked', text: blocked })
  return rows
}

function gatePanels(view: GateSessionView, state: GateToggles, cursor: number, width: number): readonly GatePanel[] {
  const wide = joinOrStack(width) === 'join'
  const counter: RowCursor = { row: 0 }
  const gateRows: GateRow[] = [...gateItemRows(view, state, counter, cursor, wide)]
  if (view.requiredAck !== null && view.blockers.length === 0) gateRows.push(ackRow(view, state, counter, cursor))
  const panels: GatePanel[] = [{ title: `Gate · ${view.gateMode}`, rows: gateRows }]
  if (view.blockers.length > 0) panels.push({ title: 'Blockers', rows: gateBlockerRows(view, state, counter, cursor) })
  panels.push({ title: 'Decision', rows: gateDecisionRows(view, state) })
  return panels
}

export function createGateScreen(): (props: GateScreenProps) => ReturnType<typeof createElement> {
  return function GateScreen(props: GateScreenProps): ReturnType<typeof createElement> {
    const { view } = props
    const mode = props.colorMode ?? 'color'
    const panels = gatePanels(view, props, props.cursor ?? 0, props.width)
    const elements = panels.flatMap((panel) => [
      createElement(Text, { key: `${panel.title}-top` }, frameTop(props.width, panel.title)),
      ...panel.rows.map((row) =>
        createElement(
          Text,
          { key: row.key, ...(row.tone === 'blocker' ? severityToken(mode, 'blocker') : {}) },
          frameBodyLine(row.text, props.width),
        ),
      ),
      createElement(Text, { key: `${panel.title}-bottom` }, frameBottom(props.width)),
    ])
    return createElement(Box, { flexDirection: 'column' }, ...elements)
  }
}
