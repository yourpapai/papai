// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { render } from 'ink-testing-library'
import { createElement } from 'react'

import type { KeyFlags } from '../../sdd-runner/src/gate-session-state.js'
import { initialCreateForm } from '../../sdd-runner/src/session-create-form.js'
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
  return { screen: 'list', cursor }
}

function createScreenState(cursor = 0, form = initialCreateForm()): SessionScreenState {
  return { screen: 'create', cursor, form }
}

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
  it('moves the cursor within bounds', () => {
    expect(stateOf(reduceSessionScreen(baseState(0), ROWS, '', keys({ down: true })))).toEqual({
      screen: 'list',
      cursor: 1,
    })
    expect(stateOf(reduceSessionScreen(baseState(5), ROWS, '', keys({ down: true })))).toEqual({
      screen: 'list',
      cursor: 2,
    })
    expect(stateOf(reduceSessionScreen(baseState(0), ROWS, '', keys({ up: true })))).toEqual({
      screen: 'list',
      cursor: 0,
    })
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

  it('opens the creation screen with n and abandons the list with q or escape', () => {
    expect(reduceSessionScreen(baseState(2), ROWS, 'n', keys())).toEqual({
      kind: 'state',
      state: { screen: 'create', cursor: 2, form: initialCreateForm() },
    })
    expect(reduceSessionScreen(baseState(), ROWS, 'q', keys())).toEqual({ kind: 'abandon' })
    expect(reduceSessionScreen(baseState(), ROWS, '', keys({ esc: true }))).toEqual({ kind: 'abandon' })
  })
})

describe('reduceSessionScreen (screen switch: list ⇄ create)', () => {
  it('routes form keys to the form and preserves the list cursor while creating', () => {
    let state = stateOf(reduceSessionScreen(baseState(2), ROWS, 'n', keys()))
    for (const char of 'fix flaky auth test') state = stateOf(reduceSessionScreen(state, ROWS, char, keys()))
    expect(state).toEqual({
      screen: 'create',
      cursor: 2,
      form: { ...initialCreateForm(), title: 'fix flaky auth test' },
    })
  })

  it('form cancel returns to the list with the cursor preserved', () => {
    const creating = createScreenState(2)
    expect(reduceSessionScreen(creating, ROWS, '', keys({ esc: true }))).toEqual({
      kind: 'state',
      state: { screen: 'list', cursor: 2 },
    })
  })

  it('a valid form submits through the screen reducer as composed task text', () => {
    let state: SessionScreenState = createScreenState()
    for (const char of 'solo title') state = stateOf(reduceSessionScreen(state, ROWS, char, keys()))
    expect(reduceSessionScreen(state, ROWS, '', keys({ ret: true }))).toEqual({
      kind: 'submitCreate',
      taskText: '# solo title\n',
    })
  })

  it('an empty-title submit stays on the create screen with a validation notice', () => {
    const action = reduceSessionScreen(createScreenState(), ROWS, '', keys({ ret: true }))
    expect(action).toEqual({
      kind: 'state',
      state: {
        screen: 'create',
        cursor: 0,
        form: { field: 'title', title: '', description: '', notice: 'a title is required' },
      },
    })
  })
})

describe('reduceSessionScreen (delete confirmation)', () => {
  it('d on a deletable row enters a confirmation naming the change and run id', () => {
    expect(reduceSessionScreen(baseState(2), ROWS, 'd', keys())).toEqual({
      kind: 'state',
      state: {
        screen: 'confirmDelete',
        cursor: 2,
        runId: 'usage-failure-queries',
        changeName: 'usage-failure-queries',
      },
    })
    expect(reduceSessionScreen(baseState(0), [row({ status: 'stopped' })], 'd', keys())).toEqual({
      kind: 'state',
      state: { screen: 'confirmDelete', cursor: 0, runId: 'fix-flaky-auth-test', changeName: 'fix-flaky-auth-test' },
    })
  })

  it('d on a running row is refused with a notice action, not a confirmation', () => {
    expect(reduceSessionScreen(baseState(0), ROWS, 'd', keys())).toEqual({
      kind: 'refuseDelete',
      runId: 'fix-flaky-auth-test',
    })
    expect(
      reduceSessionScreen(
        baseState(0),
        [row({ pendingDecision: { kind: 'gate', mode: 'final', version: 1 } })],
        'd',
        keys(),
      ),
    ).toEqual({ kind: 'refuseDelete', runId: 'fix-flaky-auth-test' })
    expect(reduceSessionScreen(baseState(0), [], 'd', keys())).toEqual({ kind: 'none' })
  })

  it('y in the confirmation emits the delete action for the named run', () => {
    const confirming: SessionScreenState = {
      screen: 'confirmDelete',
      cursor: 2,
      runId: 'usage-failure-queries',
      changeName: 'usage-failure-queries',
    }
    expect(reduceSessionScreen(confirming, ROWS, 'y', keys())).toEqual({
      kind: 'delete',
      runId: 'usage-failure-queries',
    })
  })

  it('any other key in the confirmation cancels back to the list with the cursor preserved', () => {
    const confirming: SessionScreenState = {
      screen: 'confirmDelete',
      cursor: 2,
      runId: 'usage-failure-queries',
      changeName: 'usage-failure-queries',
    }
    for (const [input, key] of [
      ['n', keys()],
      ['', keys({ esc: true })],
      ['', keys({ up: true })],
      ['q', keys()],
    ] as const) {
      expect(reduceSessionScreen(confirming, ROWS, input, key)).toEqual({
        kind: 'state',
        state: { screen: 'list', cursor: 2 },
      })
    }
  })
})

describe('SessionScreen delete confirmation rendering', () => {
  it('names the session and run id with a hint line', () => {
    const frame = render(
      createElement(SessionScreen, {
        rows: ROWS,
        state: {
          screen: 'confirmDelete',
          cursor: 2,
          runId: 'usage-failure-queries',
          changeName: 'usage-failure-queries',
        },
        now: NOW,
      }),
    ).lastFrame()
    expect(frame).toContain('Delete usage-failure-queries (usage-failure-queries)?')
    expect(frame).toContain('(y) delete')
    expect(frame).toContain('cancel')
  })

  it('the list legend offers the delete key', () => {
    const frame = render(createElement(SessionScreen, { rows: ROWS, state: baseState(), now: NOW })).lastFrame()
    expect(frame).toContain('(d)elete')
  })
})

describe('SessionScreen create rendering', () => {
  it('renders the form fields, focus marker, hints, and validation notice', () => {
    const rejected = { ...initialCreateForm(), notice: 'a title is required' }
    const frame = render(
      createElement(SessionScreen, { rows: ROWS, state: createScreenState(1, rejected), now: NOW }),
    ).lastFrame()
    expect(frame).toContain('New session')
    expect(frame).toContain('Title:')
    expect(frame).toContain('Description:')
    expect(frame).toContain('a title is required')
    expect(frame).toContain('Tab')
    expect(frame).toContain('Esc')
  })

  it('marks the focused field and shows typed text', () => {
    const filled = { ...initialCreateForm(), title: 'typed' }
    const frame = render(
      createElement(SessionScreen, { rows: ROWS, state: createScreenState(0, filled), now: NOW }),
    ).lastFrame()
    expect(frame).toContain('Title: typed')
    const onDescription = { ...filled, field: 'description' as const }
    const switched = render(
      createElement(SessionScreen, { rows: ROWS, state: createScreenState(0, onDescription), now: NOW }),
    ).lastFrame()
    expect(switched).toContain('❯ Description:')
    expect(switched).not.toContain('❯ Title:')
  })
})
