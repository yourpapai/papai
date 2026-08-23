// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { render } from 'ink-testing-library'
import { createElement } from 'react'

import type { KeyFlags } from '../../sdd-runner/src/gate-session-state.js'
import type { SessionRow } from '../../sdd-runner/src/session-list.js'
import { SessionScreen, reduceSessionScreen } from '../../sdd-runner/src/tui-session-screen.js'
import type { SessionScreenState } from '../../sdd-runner/src/tui-session-screen.js'

const NOW = new Date('2026-01-03T12:00:00.000Z')

function row(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    runId: 'fix-flaky-auth-test',
    changeName: 'fix-flaky-auth-test',
    status: 'running',
    stage: 'review',
    depth: 'M',
    round: 2,
    roundCap: 3,
    tokensIn: 84_000,
    tokensOut: 12_000,
    costUsd: 0.31,
    costKnown: true,
    updatedAt: '2026-01-03T11:48:00.000Z',
    pendingDecision: null,
    ...overrides,
  }
}

const ROWS = [
  row(),
  row({
    runId: 'papai-settings-cleanup',
    changeName: 'papai-settings-cleanup',
    status: 'running',
    stage: 'gate',
    round: 3,
    roundCap: 3,
    pendingDecision: { kind: 'gate', mode: 'early', version: 2 },
    updatedAt: '2026-01-03T09:00:00.000Z',
    costKnown: false,
  }),
  row({
    runId: 'usage-failure-queries',
    changeName: 'usage-failure-queries',
    status: 'completed',
    stage: 'gate',
    round: 2,
    roundCap: 2,
    updatedAt: '2026-01-01T00:00:00.000Z',
  }),
]

function baseState(cursor = 0): SessionScreenState {
  return { cursor }
}

describe('SessionScreen rendering', () => {
  it('lists every run with name, progress, tokens, cost, activity, and pending decision', () => {
    const frame = render(createElement(SessionScreen, { rows: ROWS, state: baseState(), now: NOW })).lastFrame()
    expect(frame).toContain('❯ ▶ fix-flaky-auth-test')
    expect(frame).toContain('review r2/3')
    expect(frame).toContain('96k tok')
    expect(frame).toContain('$0.31')
    expect(frame).toContain('12m ago')
    expect(frame).not.toContain('❯ papai-settings-cleanup')
    expect(frame).toContain('papai-settings-cleanup')
    expect(frame).toContain('gate v2 awaiting input')
    expect(frame).toContain('usage-failure-queries')
    expect(frame).toContain('completed · report available')
    expect(frame).toContain('cost ?')
  })

  it('shows stop and reopen hints for eligible rows and the key legend', () => {
    const frame = render(createElement(SessionScreen, { rows: ROWS, state: baseState(), now: NOW })).lastFrame()
    expect(frame).toContain('(Enter) continue')
    expect(frame).toContain('(s)top')
    expect(frame).toContain('(r)eopen gate')
    expect(frame).toContain('(n)ew session')
    expect(frame).toContain('(q)uit')
  })
})

describe('reduceSessionScreen', () => {
  function stateOf(action: ReturnType<typeof reduceSessionScreen>): SessionScreenState {
    if (action.kind === 'state') return action.state
    throw new Error(`expected a cursor move, got '${action.kind}'`)
  }

  const keys = (over: Partial<{ up: boolean; down: boolean; ret: boolean; esc: boolean }> = {}): KeyFlags => ({
    upArrow: over.up === true,
    downArrow: over.down === true,
    return: over.ret === true,
    escape: over.esc === true,
    backspace: false,
    delete: false,
  })

  it('moves the cursor within bounds', () => {
    expect(stateOf(reduceSessionScreen(baseState(0), ROWS, '', keys({ down: true })))).toEqual({ cursor: 1 })
    expect(stateOf(reduceSessionScreen(baseState(5), ROWS, '', keys({ down: true })))).toEqual({ cursor: 2 })
    expect(stateOf(reduceSessionScreen(baseState(0), ROWS, '', keys({ up: true })))).toEqual({ cursor: 0 })
  })

  it('selects the hovered row on Enter', () => {
    const action = reduceSessionScreen(baseState(2), ROWS, '', keys({ ret: true }))
    expect(action).toEqual({ kind: 'route', runId: 'usage-failure-queries' })
  })

  it('requests actions for the hovered row', () => {
    expect(reduceSessionScreen(baseState(0), ROWS, 's', keys())).toEqual({
      kind: 'stop',
      runId: 'fix-flaky-auth-test',
    })
    expect(reduceSessionScreen(baseState(2), ROWS, 'r', keys())).toEqual({
      kind: 'reopen',
      runId: 'usage-failure-queries',
    })
    expect(reduceSessionScreen(baseState(2), ROWS, 's', keys())).toEqual({ kind: 'none' })
    expect(reduceSessionScreen(baseState(0), ROWS, 'r', keys())).toEqual({ kind: 'none' })
  })

  it('opens creation with n and abandons with q or escape', () => {
    expect(reduceSessionScreen(baseState(), ROWS, 'n', keys())).toEqual({ kind: 'create' })
    expect(reduceSessionScreen(baseState(), ROWS, 'q', keys())).toEqual({ kind: 'abandon' })
    expect(reduceSessionScreen(baseState(), ROWS, '', keys({ esc: true }))).toEqual({ kind: 'abandon' })
  })
})
