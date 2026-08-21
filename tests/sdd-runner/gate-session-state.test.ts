// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { reduceSession } from '../../sdd-runner/src/gate-session-state.js'
import type { SessionState } from '../../sdd-runner/src/gate-session-state.js'
import type { GateSessionView } from '../../sdd-runner/src/gate-session.js'

const VIEW: GateSessionView = {
  gateMode: 'early',
  items: [
    { kind: 'assumption', id: 'A1', text: 'a', evidence: '', blastRadius: '' },
    { kind: 'finding', id: 'F1', text: 'f', evidence: '', blastRadius: '' },
  ],
  blockers: [{ id: 'B1', gap: 'g', evidence: '' }],
  requiredAck: { id: 'T1', text: 'ack' },
}

function initial(): SessionState {
  return { cursor: 0, toggles: {}, redirects: {}, blockerAnswers: {}, ackAffirmed: false, input: null, inputText: '' }
}

function press(
  state: SessionState,
  input: string,
  key = { upArrow: false, downArrow: false, return: false, escape: false, backspace: false, delete: false },
): SessionState {
  const action = reduceSession(state, VIEW, input, key)
  if (action.kind === 'state') return action.state
  return state
}

describe('reduceSession (TUI gate state machine)', () => {
  it('space toggles the cursor item off and on', () => {
    const off = press(
      press(initial(), '\u001b[B', {
        upArrow: false,
        downArrow: true,
        return: false,
        escape: false,
        backspace: false,
        delete: false,
      }),
      ' ',
    )
    expect(off.toggles['F1']).toBe(false)
    const on = press(off, ' ')
    expect(on.toggles['F1']).toBe(true)
  })

  it('return on a declined item opens the redirect input; typing then return records it', () => {
    const declined = press(initial(), ' ')
    const editing = press(declined, '\r', {
      upArrow: false,
      downArrow: false,
      return: true,
      escape: false,
      backspace: false,
      delete: false,
    })
    expect(editing.input?.kind).toBe('redirect')
    const typed = press(press(editing, 'n'), 'arrow')
    const submitted = press(typed, '\r', {
      upArrow: false,
      downArrow: false,
      return: true,
      escape: false,
      backspace: false,
      delete: false,
    })
    expect(submitted.redirects['A1']).toBe('narrow')
  })

  it('approve settles only when the ack is affirmed and blockers answered', () => {
    const blocked = reduceSession(initial(), VIEW, 'a', {
      upArrow: false,
      downArrow: false,
      return: false,
      escape: false,
      backspace: false,
      delete: false,
    })
    expect(blocked.kind).toBe('none')
    const ready: SessionState = { ...initial(), ackAffirmed: true, blockerAnswers: { B1: 'OVERRIDE' } }
    const settle = reduceSession(ready, VIEW, 'a', {
      upArrow: false,
      downArrow: false,
      return: false,
      escape: false,
      backspace: false,
      delete: false,
    })
    expect(settle.kind).toBe('settle')
  })

  it('q abandons; extend settles only at an early gate', () => {
    expect(
      reduceSession(initial(), VIEW, 'q', {
        upArrow: false,
        downArrow: false,
        return: false,
        escape: false,
        backspace: false,
        delete: false,
      }).kind,
    ).toBe('abandon')
    expect(
      reduceSession(initial(), VIEW, 'e', {
        upArrow: false,
        downArrow: false,
        return: false,
        escape: false,
        backspace: false,
        delete: false,
      }).kind,
    ).toBe('settle')
    expect(
      reduceSession(initial(), { ...VIEW, gateMode: 'final' }, 'e', {
        upArrow: false,
        downArrow: false,
        return: false,
        escape: false,
        backspace: false,
        delete: false,
      }).kind,
    ).toBe('none')
  })
})
