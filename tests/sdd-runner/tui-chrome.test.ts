// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { Text } from 'ink'
import { render } from 'ink-testing-library'
import { createElement } from 'react'
import type { ReactElement } from 'react'

import type { KeyFlags } from '../../sdd-runner/src/gate-session-state.js'
import { Footer, HelpOverlay, keyHints, reduceHelpOverlay, ScreenChrome } from '../../sdd-runner/src/tui-chrome.js'
import type { HintsInput, OverlayState } from '../../sdd-runner/src/tui-chrome.js'

/**
 * tui-chrome (fancy-ui 5.x): `keyHints` lists only currently-active
 * bindings; `reduceHelpOverlay` routes keys with a fixed order — text entry
 * consumes `?` as literal input first, an open overlay swallows everything
 * except its dismiss keys, otherwise `?` opens; the overlay is an inset
 * panel with the footer still visible beneath it; dismissal restores the
 * frame exactly and overlay state never feeds a settle path. Any-key
 * surfaces (ack shell, delete confirmation) get footers but are never
 * composed with the overlay.
 */

const KEY: KeyFlags = {
  upArrow: false,
  downArrow: false,
  return: false,
  escape: false,
  backspace: false,
  delete: false,
}

const CLOSED: OverlayState = { open: false }
const OPEN: OverlayState = { open: true }

function frameText(frame: string | undefined): string {
  return frame ?? ''
}

describe('keyHints (exact values, only currently-active bindings)', () => {
  it('early gate lists extend; final gate does not', () => {
    const early = keyHints({ screen: 'gate', gateMode: 'early', inputOpen: false })
    const final = keyHints({ screen: 'gate', gateMode: 'final', inputOpen: false })
    expect(early.map((hint) => hint.key)).toContain('(e)xtend')
    expect(final.map((hint) => hint.key)).not.toContain('(e)xtend')
    expect(final.map((hint) => hint.key)).toEqual([
      '(↑/↓)',
      '(space)',
      '(Enter)',
      '(a)pprove',
      '(x)abort',
      '(q)uit',
      '(?) help',
    ])
    expect(early.map((hint) => hint.key)).toEqual([
      '(↑/↓)',
      '(space)',
      '(Enter)',
      '(a)pprove',
      '(e)xtend',
      '(x)abort',
      '(q)uit',
      '(?) help',
    ])
  })

  it('an open gate input swaps the footer to the text-entry hints', () => {
    const hints = keyHints({ screen: 'gate', gateMode: 'early', inputOpen: true })
    expect(hints.map((hint) => hint.key)).toEqual(['(chars)', '(Backspace)', '(Enter)', '(Esc)'])
  })

  it('the running screen lists stop keys plus help', () => {
    expect(keyHints({ screen: 'running' }).map((hint) => hint.key)).toEqual(['(q)', '(Ctrl-C ×2)', '(?) help'])
  })

  it('the session list lists (d)elete only on a deletable hover, and stop/reopen likewise', () => {
    const plain = keyHints({
      screen: 'session-list',
      stoppableHover: false,
      reopenableHover: false,
      deletableHover: false,
    })
    expect(plain.map((hint) => hint.key)).toEqual(['(↑/↓)', '(Enter)', '(n)ew', '(q)uit', '(?) help'])
    const hover = keyHints({
      screen: 'session-list',
      stoppableHover: true,
      reopenableHover: true,
      deletableHover: true,
    })
    expect(hover.map((hint) => hint.key)).toEqual([
      '(↑/↓)',
      '(Enter)',
      '(s)top active',
      '(r)eopen gate',
      '(d)elete',
      '(n)ew',
      '(q)uit',
      '(?) help',
    ])
    const deleteOnly = keyHints({
      screen: 'session-list',
      stoppableHover: false,
      reopenableHover: false,
      deletableHover: true,
    })
    expect(deleteOnly.map((hint) => hint.key)).toContain('(d)elete')
    expect(deleteOnly.map((hint) => hint.key)).not.toContain('(s)top active')
  })

  it('the creation form lists its bindings with no (?) binding — ? is literal there', () => {
    expect(keyHints({ screen: 'session-create' }).map((hint) => hint.key)).toEqual(['(Tab)', '(Enter)', '(Esc)'])
  })

  it('any-key surfaces list exactly their any-key affordance', () => {
    expect(keyHints({ screen: 'ack' })).toEqual([{ key: '(any key)', meaning: 'back to sessions' }])
    expect(keyHints({ screen: 'confirm-delete' }).map((hint) => hint.key)).toEqual(['(y)', '(any other key)'])
  })

  it('every hint carries a meaning', () => {
    const inputs: readonly HintsInput[] = [
      { screen: 'gate', gateMode: 'early', inputOpen: false },
      { screen: 'gate', gateMode: 'early', inputOpen: true },
      { screen: 'gate', gateMode: 'final', inputOpen: false },
      { screen: 'running' },
      { screen: 'session-list', stoppableHover: false, reopenableHover: false, deletableHover: false },
      { screen: 'session-create' },
      { screen: 'ack' },
      { screen: 'confirm-delete' },
    ]
    inputs.forEach((input) => {
      keyHints(input).forEach((hint) => expect(hint.meaning.length).toBeGreaterThan(0))
    })
  })
})

describe('reduceHelpOverlay (fixed routing order)', () => {
  it('text-entry contexts consume ? as literal input first — even while the overlay is open', () => {
    expect(reduceHelpOverlay(OPEN, true, '?', KEY)).toEqual({ kind: 'pass' })
    expect(reduceHelpOverlay(CLOSED, true, '?', KEY)).toEqual({ kind: 'pass' })
    expect(reduceHelpOverlay(OPEN, true, 'a', KEY)).toEqual({ kind: 'pass' })
  })

  it('an open overlay swallows every key except the dismiss keys (? and Esc)', () => {
    expect(reduceHelpOverlay(OPEN, false, 'a', KEY)).toEqual({ kind: 'consume' })
    expect(reduceHelpOverlay(OPEN, false, 'q', KEY)).toEqual({ kind: 'consume' })
    expect(reduceHelpOverlay(OPEN, false, '\u0003', KEY)).toEqual({ kind: 'consume' })
    expect(reduceHelpOverlay(OPEN, false, '', KEY)).toEqual({ kind: 'consume' })
    expect(reduceHelpOverlay(OPEN, false, '?', KEY)).toEqual({ kind: 'state', state: CLOSED })
    expect(reduceHelpOverlay(OPEN, false, '', { ...KEY, escape: true })).toEqual({ kind: 'state', state: CLOSED })
  })

  it('otherwise ? opens the overlay and every other key passes through', () => {
    expect(reduceHelpOverlay(CLOSED, false, '?', KEY)).toEqual({ kind: 'state', state: OPEN })
    expect(reduceHelpOverlay(CLOSED, false, 'a', KEY)).toEqual({ kind: 'pass' })
    expect(reduceHelpOverlay(CLOSED, false, '', { ...KEY, escape: true })).toEqual({ kind: 'pass' })
    expect(reduceHelpOverlay(CLOSED, false, 'q', KEY)).toEqual({ kind: 'pass' })
  })

  it('overlay routing never emits decisions — only pass/consume/state', () => {
    const outcomes = [
      reduceHelpOverlay(CLOSED, false, '?', KEY),
      reduceHelpOverlay(OPEN, false, 'x', KEY),
      reduceHelpOverlay(OPEN, true, '?', KEY),
      reduceHelpOverlay(CLOSED, false, 'a', KEY),
    ]
    outcomes.forEach((outcome) => {
      expect(['pass', 'consume', 'state']).toContain(outcome.kind)
    })
  })
})

describe('Footer and HelpOverlay components', () => {
  const HINTS = keyHints({ screen: 'running' })

  it('the footer renders the hint keys joined, truncated to the width', () => {
    const instance = render(createElement(Footer, { hints: HINTS, width: 80 }))
    expect(instance.lastFrame()).toContain('(q) · (Ctrl-C ×2) · (?) help')
    instance.unmount()
    const narrow = render(createElement(Footer, { hints: HINTS, width: 10 }))
    const frame = frameText(narrow.lastFrame())
    frame.split('\n').forEach((line) => expect(line.length).toBeLessThanOrEqual(10))
    narrow.unmount()
  })

  it('the overlay renders an inset panel listing keys with meanings', () => {
    const instance = render(createElement(HelpOverlay, { screen: 'running', hints: HINTS, width: 60 }))
    const frame = frameText(instance.lastFrame())
    expect(frame).toContain('Keys · running')
    expect(frame).toContain('(q) — ')
    expect(frame).toContain('(?) help — ')
    frame.split('\n').forEach((line) => expect(line.length).toBeLessThanOrEqual(60))
    instance.unmount()
  })

  it('ScreenChrome keeps the footer visible beneath the open overlay and restores the frame exactly on dismissal', () => {
    const content = createElement(Text, null, 'decision surface')
    const chrome = (overlay: OverlayState): ReactElement =>
      createElement(ScreenChrome, {
        overlay,
        screen: 'running',
        hints: HINTS,
        width: 80,
        children: [content],
      })
    const instance = render(chrome(CLOSED))
    const closedFrame = frameText(instance.lastFrame())
    expect(closedFrame).toContain('decision surface')
    expect(closedFrame).toContain('(?) help')
    instance.rerender(chrome(OPEN))
    const openFrame = frameText(instance.lastFrame())
    expect(openFrame).toContain('Keys · running')
    expect(openFrame).toContain('(?) help')
    instance.rerender(chrome(CLOSED))
    expect(frameText(instance.lastFrame())).toBe(closedFrame)
    instance.unmount()
  })
})
