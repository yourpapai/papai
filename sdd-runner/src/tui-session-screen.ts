// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Box, Text } from 'ink'
import { createElement } from 'react'

import type { KeyFlags } from './gate-session-state.js'
import type { SessionRow } from './session-list.js'

/**
 * Session screen (D2): every run as one selectable row with derived progress;
 * a pure reducer owns cursor + decisions so live stdin and scripted keys
 * drive identical logic.
 */

export interface SessionScreenState {
  readonly cursor: number
}

export type SessionScreenAction =
  | { readonly kind: 'state'; readonly state: SessionScreenState }
  | { readonly kind: 'none' }
  | { readonly kind: 'route'; readonly runId: string }
  | { readonly kind: 'stop'; readonly runId: string }
  | { readonly kind: 'reopen'; readonly runId: string }
  | { readonly kind: 'create' }
  | { readonly kind: 'abandon' }

const REOPENABLE = new Set(['completed', 'aborted', 'failed'])

function clampCursor(cursor: number, rows: readonly SessionRow[]): number {
  const max = Math.max(rows.length - 1, 0)
  return Math.min(Math.max(cursor, 0), max)
}

export function reduceSessionScreen(
  state: SessionScreenState,
  rows: readonly SessionRow[],
  input: string,
  key: KeyFlags,
): SessionScreenAction {
  const hover = (): SessionRow | undefined => rows[clampCursor(state.cursor, rows)]
  if (key.upArrow || key.downArrow) {
    const delta = key.downArrow ? 1 : -1
    return { kind: 'state', state: { cursor: clampCursor(state.cursor + delta, rows) } }
  }
  if (key.escape) return { kind: 'abandon' }
  if (input === 'q') return { kind: 'abandon' }
  if (input === 'n') return { kind: 'create' }
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
