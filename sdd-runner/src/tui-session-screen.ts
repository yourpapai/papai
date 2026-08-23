// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Box, Text } from 'ink'
import { createElement } from 'react'

import type { KeyFlags } from './gate-session-state.js'
import { initialCreateForm, reduceCreateForm } from './session-create-form.js'
import type { CreateFormState } from './session-create-form.js'
import type { SessionRow } from './session-list.js'

/**
 * Session screen (D2): every run as one selectable row with derived progress;
 * a pure reducer owns cursor + decisions so live stdin and scripted keys
 * drive identical logic. A screen dimension (D-manager) hosts the inline
 * creation form behind the same key pipeline.
 */

export type SessionScreenState =
  | { readonly screen: 'list'; readonly cursor: number }
  | { readonly screen: 'create'; readonly cursor: number; readonly form: CreateFormState }

export type SessionScreenAction =
  | { readonly kind: 'state'; readonly state: SessionScreenState }
  | { readonly kind: 'none' }
  | { readonly kind: 'route'; readonly runId: string }
  | { readonly kind: 'stop'; readonly runId: string }
  | { readonly kind: 'reopen'; readonly runId: string }
  | { readonly kind: 'submitCreate'; readonly taskText: string }
  | { readonly kind: 'abandon' }

const REOPENABLE = new Set(['completed', 'aborted', 'failed'])

function clampCursor(cursor: number, rows: readonly SessionRow[]): number {
  const max = Math.max(rows.length - 1, 0)
  return Math.min(Math.max(cursor, 0), max)
}

/** Entry state for a session-screen mount: the list, or the creation form. */
export function initialSessionScreenState(screen: 'list' | 'create' = 'list'): SessionScreenState {
  if (screen === 'create') return { screen: 'create', cursor: 0, form: initialCreateForm() }
  return { screen: 'list', cursor: 0 }
}

function reduceCreateScreen(
  state: Extract<SessionScreenState, { screen: 'create' }>,
  input: string,
  key: KeyFlags,
): SessionScreenAction {
  const action = reduceCreateForm(state.form, input, key)
  if (action.kind === 'state') return { kind: 'state', state: { ...state, form: action.state } }
  if (action.kind === 'cancel') return { kind: 'state', state: { screen: 'list', cursor: state.cursor } }
  if (action.kind === 'submit') return { kind: 'submitCreate', taskText: action.taskText }
  return { kind: 'none' }
}

export function reduceSessionScreen(
  state: SessionScreenState,
  rows: readonly SessionRow[],
  input: string,
  key: KeyFlags,
): SessionScreenAction {
  if (state.screen === 'create') return reduceCreateScreen(state, input, key)
  const hover = (): SessionRow | undefined => rows[clampCursor(state.cursor, rows)]
  if (key.upArrow || key.downArrow) {
    const delta = key.downArrow ? 1 : -1
    return { kind: 'state', state: { screen: 'list', cursor: clampCursor(state.cursor + delta, rows) } }
  }
  if (key.escape) return { kind: 'abandon' }
  if (input === 'q') return { kind: 'abandon' }
  if (input === 'n')
    return { kind: 'state', state: { screen: 'create', cursor: state.cursor, form: initialCreateForm() } }
  if (key.return) {
    const row = hover()
    return row === undefined ? { kind: 'none' } : { kind: 'route', runId: row.runId }
  }
  if (input === 's') {
    const row = hover()
    return row !== undefined && row.status === 'running' ? { kind: 'stop', runId: row.runId } : { kind: 'none' }
  }
  if (input === 'r') {
    const row = hover()
    return row !== undefined && REOPENABLE.has(row.status) ? { kind: 'reopen', runId: row.runId } : { kind: 'none' }
  }
  return { kind: 'none' }
}

const GLYPHS: Record<SessionRow['status'], string> = {
  running: '▶',
  stopped: '⏸',
  completed: '✓',
  aborted: '✗',
  failed: '✗',
}

function relativeAge(updatedAt: string, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - Date.parse(updatedAt)) / 60_000))
  if (minutes < 60) return `${String(minutes)}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${String(hours)}h ago`
  return `${String(Math.round(hours / 24))}d ago`
}

function tokenLabel(row: SessionRow): string {
  const total = row.tokensIn + row.tokensOut
  return total >= 1000 ? `${String(Math.round(total / 1000))}k tok` : `${String(total)} tok`
}

function costLabel(row: SessionRow): string {
  return row.costKnown ? `$${row.costUsd.toFixed(2)}` : 'cost ?'
}

function decisionLabel(row: SessionRow): string {
  switch (row.pendingDecision?.kind) {
    case 'gate':
      return `gate v${String(row.pendingDecision.version)} awaiting input`
    case 'stop':
      return 'stop requested · resumable'
    case undefined:
      break
  }
  if (row.status === 'completed') return 'completed · report available'
  if (row.status === 'aborted') return 'aborted · reopen possible'
  if (row.status === 'failed') return 'failed · inspect log'
  return ''
}

export function sessionScreenLines(rows: readonly SessionRow[], state: SessionScreenState, now: Date): string[] {
  if (state.screen === 'create') return createScreenLines(state.form)
  const lines: string[] = ['## Sessions']
  if (rows.length === 0) {
    lines.push('(no sessions)')
    return lines
  }
  rows.forEach((row, index) => {
    const mark = index === state.cursor ? '❯ ' : '  '
    const parts = [
      `${GLYPHS[row.status]} ${row.changeName}`,
      `${row.stage} r${String(row.round)}/${String(row.roundCap)}`,
      tokenLabel(row),
      costLabel(row),
      relativeAge(row.updatedAt, now),
    ]
    const decision = decisionLabel(row)
    if (decision !== '') parts.push(decision)
    lines.push(`${mark}${parts.join(' · ')}`)
  })
  lines.push('')
  lines.push('(Enter) continue · (s)top active · (r)eopen gate · (n)ew session · (q)uit')
  return lines
}

function createScreenLines(form: CreateFormState): string[] {
  const lines: string[] = ['## New session']
  lines.push(`${form.field === 'title' ? '❯' : ' '} Title: ${form.title}`)
  lines.push(`${form.field === 'description' ? '❯' : ' '} Description: ${form.description}`)
  if (form.notice !== null) lines.push(`! ${form.notice}`)
  lines.push('')
  lines.push('(Tab) switch field · (Enter) start · (Esc) back')
  return lines
}

export function SessionScreen(props: {
  readonly rows: readonly SessionRow[]
  readonly state: SessionScreenState
  readonly now?: Date
}): ReturnType<typeof createElement> {
  const lines = sessionScreenLines(props.rows, props.state, props.now ?? new Date())
  return createElement(
    Box,
    { flexDirection: 'column' },
    ...lines.map((line, index) => createElement(Text, { key: String(index) }, line)),
  )
}
