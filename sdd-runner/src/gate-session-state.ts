// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { GateAnswers } from './gate-answers.js'
import type { GateSessionView } from './gate-session.js'
import { approveBlockers, gateAnswersFromToggles } from './tui-gate.js'
import type { GateToggles } from './tui-gate.js'

/**
 * Pure state machine for the TUI gate session: key events (live or
 * scripted) reduce a `SessionState` — cursor, toggles, redirects, blocker
 * answers, ack — toward a settle/abandon decision. No React, no Ink.
 */

export interface KeyFlags {
  readonly upArrow: boolean
  readonly downArrow: boolean
  readonly return: boolean
  readonly escape: boolean
  readonly backspace: boolean
  readonly delete: boolean
}

type InputTarget =
  | { readonly kind: 'redirect'; readonly id: string }
  | { readonly kind: 'blocker'; readonly id: string }

export interface SessionState extends GateToggles {
  readonly cursor: number
  readonly input: InputTarget | null
  readonly inputText: string
}

export type Decision = 'approve' | 'extend' | 'abort'

type SessionAction =
  | { readonly kind: 'none' }
  | { readonly kind: 'state'; readonly state: SessionState }
  | { readonly kind: 'settle'; readonly decision: Decision }
  | { readonly kind: 'abandon' }

interface Row {
  readonly kind: 'item' | 'blocker' | 'ack'
  readonly id: string
}

function rowsOf(view: GateSessionView): Row[] {
  const rows: Row[] = [
    ...view.items.map((item): Row => ({ kind: 'item', id: item.id })),
    ...view.blockers.map((blocker): Row => ({ kind: 'blocker', id: blocker.id })),
  ]
  if (view.requiredAck !== null) rows.push({ kind: 'ack', id: view.requiredAck.id })
  return rows
}

function clampCursor(state: SessionState, view: GateSessionView): SessionState {
  const max = rowsOf(view).length - 1
  return { ...state, cursor: Math.min(Math.max(state.cursor, 0), max) }
}

export function decisionAnswers(state: SessionState, view: GateSessionView, decision: Decision): GateAnswers {
  if (decision === 'approve') return gateAnswersFromToggles(view, state)
  return { items: [], blockerAnswers: [], acks: [], decision }
}

function reduceTextInput(
  state: SessionState,
  input: string,
  key: { return: boolean; escape: boolean; backspace: boolean; delete: boolean },
): SessionAction {
  if (key.return) {
    const target = state.input
    if (target === null) return { kind: 'none' }
    const patch =
      target.kind === 'redirect'
        ? { redirects: { ...state.redirects, [target.id]: state.inputText } }
        : { blockerAnswers: { ...state.blockerAnswers, [target.id]: state.inputText } }
    return { kind: 'state', state: { ...state, input: null, inputText: '', ...patch } }
  }
  if (key.escape) return { kind: 'state', state: { ...state, input: null, inputText: '' } }
  if (key.backspace || key.delete) {
    return { kind: 'state', state: { ...state, inputText: state.inputText.slice(0, -1) } }
  }
  if (input.length > 0) return { kind: 'state', state: { ...state, inputText: state.inputText + input } }
  return { kind: 'none' }
}

function reduceRowKey(
  state: SessionState,
  view: GateSessionView,
  input: string,
  key: { return: boolean },
): SessionAction {
  const row = rowsOf(view)[state.cursor]
  if (row === undefined) return { kind: 'none' }
  if (row.kind === 'blocker') {
    if (key.return) return { kind: 'state', state: { ...state, input: { kind: 'blocker', id: row.id }, inputText: '' } }
    return { kind: 'none' }
  }
  if (row.kind === 'ack') {
    if (input === ' ' || key.return) return { kind: 'state', state: { ...state, ackAffirmed: !state.ackAffirmed } }
    return { kind: 'none' }
  }
  const item = view.items.find((candidate) => candidate.id === row.id)
  if (item !== undefined && item.decidedBy !== undefined) return { kind: 'none' }
  const accepted = state.toggles[row.id] !== false
  if (input === ' ') return { kind: 'state', state: { ...state, toggles: { ...state.toggles, [row.id]: !accepted } } }
  if (key.return && !accepted) {
    return {
      kind: 'state',
      state: { ...state, input: { kind: 'redirect', id: row.id }, inputText: state.redirects[row.id] ?? '' },
    }
  }
  return { kind: 'none' }
}

export function reduceSession(state: SessionState, view: GateSessionView, input: string, key: KeyFlags): SessionAction {
  if (state.input !== null) return reduceTextInput(state, input, key)
  if (key.upArrow) return { kind: 'state', state: clampCursor({ ...state, cursor: state.cursor - 1 }, view) }
  if (key.downArrow) return { kind: 'state', state: clampCursor({ ...state, cursor: state.cursor + 1 }, view) }
  if (input === 'a') {
    if (approveBlockers(view, state) === null) return { kind: 'settle', decision: 'approve' }
    return { kind: 'none' }
  }
  if (input === 'e') {
    if (view.gateMode === 'early') return { kind: 'settle', decision: 'extend' }
    return { kind: 'none' }
  }
  if (input === 'x') return { kind: 'settle', decision: 'abort' }
  if (input === 'q') return { kind: 'abandon' }
  if (input === ' ' || key.return) return reduceRowKey(state, view, input, key)
  return { kind: 'none' }
}
