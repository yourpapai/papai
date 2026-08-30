// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createElement } from 'react'

import type { KeyFlags } from './gate-session-state.js'
import { initialCreateForm, reduceCreateForm } from './session-create-form.js'
import type { CreateFormState } from './session-create-form.js'
import type { SessionRow } from './session-list.js'
import { keyHints } from './tui-chrome.js'
import type { HintsInput } from './tui-chrome.js'
import { ScreenChrome } from './tui-chrome.js'
import type { OverlayState } from './tui-chrome.js'
import { displayWidth, FramedPanel, padDisplay, panelRow, truncateDisplay } from './tui-panels.js'
import type { PanelRow } from './tui-panels.js'
import { costToken } from './tui-tokens.js'
import type { ColorMode } from './tui-tokens.js'
import { useTerminalWidth } from './tui-width.js'

/**
 * Session screen (D2): every run as one selectable row with derived progress;
 * a pure reducer owns cursor + decisions so live stdin and scripted keys
 * drive identical logic. A screen dimension (D-manager) hosts the inline
 * creation form behind the same key pipeline.
 */

export type SessionScreenState =
  | { readonly screen: 'list'; readonly cursor: number }
  | { readonly screen: 'create'; readonly cursor: number; readonly form: CreateFormState }
  | { readonly screen: 'confirmDelete'; readonly cursor: number; readonly runId: string; readonly changeName: string }

export type SessionScreenAction =
  | { readonly kind: 'state'; readonly state: SessionScreenState }
  | { readonly kind: 'none' }
  | { readonly kind: 'route'; readonly runId: string }
  | { readonly kind: 'stop'; readonly runId: string }
  | { readonly kind: 'reopen'; readonly runId: string }
  | { readonly kind: 'delete'; readonly runId: string }
  | { readonly kind: 'refuseDelete'; readonly runId: string }
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

/**
 * Delete confirmation sub-state: `y` executes, any other key cancels back to
 * the list with the cursor preserved — the confirmation is the undo.
 */
function reduceConfirmDeleteScreen(
  state: Extract<SessionScreenState, { screen: 'confirmDelete' }>,
  input: string,
): SessionScreenAction {
  if (input === 'y') return { kind: 'delete', runId: state.runId }
  return { kind: 'state', state: { screen: 'list', cursor: state.cursor } }
}

export function reduceSessionScreen(
  state: SessionScreenState,
  rows: readonly SessionRow[],
  input: string,
  key: KeyFlags,
): SessionScreenAction {
  if (state.screen === 'create') return reduceCreateScreen(state, input, key)
  if (state.screen === 'confirmDelete') return reduceConfirmDeleteScreen(state, input)
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
  if (input === 'd') {
    const row = hover()
    if (row === undefined) return { kind: 'none' }
    if (row.status === 'running') return { kind: 'refuseDelete', runId: row.runId }
    return {
      kind: 'state',
      state: { screen: 'confirmDelete', cursor: state.cursor, runId: row.runId, changeName: row.changeName },
    }
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

/** The footer/overlay hints for the current sub-screen (confirm-delete is an any-key surface: footer only). */
export function sessionHintsInput(state: SessionScreenState, rows: readonly SessionRow[]): HintsInput {
  if (state.screen === 'create') return { screen: 'session-create' }
  if (state.screen === 'confirmDelete') return { screen: 'confirm-delete' }
  const hover = rows[clampCursor(state.cursor, rows)]
  return {
    screen: 'session-list',
    stoppableHover: hover !== undefined && hover.status === 'running',
    reopenableHover: hover !== undefined && REOPENABLE.has(hover.status),
    deletableHover: hover !== undefined,
  }
}

function listRowParts(
  row: SessionRow,
  index: number,
  cursor: number,
  mode: ColorMode,
  now: Date,
  width: number,
): PanelRow {
  const mark = index === cursor ? '❯ ' : '  '
  const head = `${mark}${GLYPHS[row.status]} ${row.changeName} · ${row.stage} r${String(row.round)}/${String(row.roundCap)} · ${tokenLabel(row)}`
  const decision = decisionLabel(row)
  const tail = ` · ${relativeAge(row.updatedAt, now)}${decision === '' ? '' : ` · ${decision}`}`
  const cost = costLabel(row)
  const contentWidth = Math.max(1, width - 4)
  const headBudget = contentWidth - displayWidth(tail) - displayWidth(cost)
  if (headBudget < 4) {
    return panelRow(row.runId, truncateDisplay(`${head} · ${cost}${tail}`, contentWidth))
  }
  const tailBudget = contentWidth - headBudget - displayWidth(cost)
  return {
    key: row.runId,
    parts: [
      { text: padDisplay(truncateDisplay(head, headBudget), headBudget) },
      { text: cost, tone: costToken(mode, row.costKnown ? 'known' : 'unknown') },
      { text: padDisplay(truncateDisplay(tail, tailBudget), tailBudget) },
    ],
  }
}

function listPanelRows(
  rows: readonly SessionRow[],
  state: Extract<SessionScreenState, { screen: 'list' }>,
  mode: ColorMode,
  now: Date,
  width: number,
): readonly PanelRow[] {
  if (rows.length === 0) return [panelRow('empty', '(no sessions)')]
  return rows.map((row, index) => listRowParts(row, index, state.cursor, mode, now, width))
}

function createPanelRows(form: CreateFormState): readonly PanelRow[] {
  const rows: PanelRow[] = [
    panelRow('title', `${form.field === 'title' ? '❯' : ' '} Title: ${form.title}`),
    panelRow('description', `${form.field === 'description' ? '❯' : ' '} Description: ${form.description}`),
  ]
  if (form.notice !== null) rows.push(panelRow('notice', `! ${form.notice}`))
  return rows
}

function confirmDeletePanelRows(state: Extract<SessionScreenState, { screen: 'confirmDelete' }>): readonly PanelRow[] {
  return [
    panelRow('name', `Delete ${state.changeName} (${state.runId})?`),
    panelRow('warn', 'The run directory is removed permanently — state, events, and cost history go with it.'),
    panelRow('afford', '(y) delete · (any other key) cancel'),
  ]
}

export interface SessionScreenProps {
  readonly rows: readonly SessionRow[]
  readonly state: SessionScreenState
  readonly now?: Date
  /** Injectable width override; the terminal width when absent. */
  readonly width?: number
  readonly colorMode?: ColorMode
  /** Overlay state from the owning picker; the confirm-delete sub-screen never composes it. */
  readonly overlay?: OverlayState
}

export function SessionScreen(props: SessionScreenProps): ReturnType<typeof createElement> {
  const terminalWidth = useTerminalWidth()
  const width = props.width ?? terminalWidth
  const mode = props.colorMode ?? 'color'
  const now = props.now ?? new Date()
  const hints = sessionHintsInput(props.state, props.rows)
  const overlay: OverlayState =
    props.state.screen === 'confirmDelete' ? { open: false } : (props.overlay ?? { open: false })
  const panel =
    props.state.screen === 'create'
      ? FramedPanelOf('New session', createPanelRows(props.state.form), width)
      : props.state.screen === 'confirmDelete'
        ? FramedPanelOf('Delete session', confirmDeletePanelRows(props.state), width)
        : FramedPanelOf('Sessions', listPanelRows(props.rows, props.state, mode, now, width), width)
  return createElement(ScreenChrome, {
    overlay,
    screen:
      hints.screen === 'session-create'
        ? 'session-create'
        : hints.screen === 'confirm-delete'
          ? 'confirm-delete'
          : 'session-list',
    hints: keyHints(hints),
    width,
    children: [panel],
  })
}

function FramedPanelOf(title: string, rows: readonly PanelRow[], width: number): ReturnType<typeof createElement> {
  return createElement(FramedPanel, { title, rows, width })
}
