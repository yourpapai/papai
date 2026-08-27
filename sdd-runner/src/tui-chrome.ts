// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Box, Text } from 'ink'
import { createElement } from 'react'
import type { ReactElement } from 'react'

import type { KeyFlags } from './gate-session-state.js'
import { frameLines, truncateDisplay } from './tui-panels.js'

/**
 * tui-chrome (fancy-ui D7): key-hints footer + `?` help overlay, pure
 * chrome composed above the screens' reducers. Routing order in
 * `reduceHelpOverlay` is fixed: text-entry contexts consume `?` as literal
 * input first (the screen reducer owns the buffer); an open overlay
 * swallows every key except its dismiss keys; otherwise `?` opens. The
 * overlay renders as an inset panel above the footer — the footer stays
 * visible while help is open — and dismissal restores the frame exactly;
 * overlay state never feeds a settle path. Any-key surfaces (the ack
 * shell, the session screen's delete confirmation) get footers but are
 * never composed with the overlay: their single any-key binding is their
 * whole contract.
 */

export interface KeyHint {
  readonly key: string
  readonly meaning: string
}

export type HintsInput =
  | { readonly screen: 'gate'; readonly gateMode: 'early' | 'final'; readonly inputOpen: boolean }
  | { readonly screen: 'running' }
  | {
      readonly screen: 'session-list'
      readonly stoppableHover: boolean
      readonly reopenableHover: boolean
      readonly deletableHover: boolean
    }
  | { readonly screen: 'session-create' }
  | { readonly screen: 'ack' }
  | { readonly screen: 'confirm-delete' }

function gateHints(input: Extract<HintsInput, { screen: 'gate' }>): readonly KeyHint[] {
  if (input.inputOpen) {
    return [
      { key: '(chars)', meaning: 'type into the field' },
      { key: '(Backspace)', meaning: 'delete a character' },
      { key: '(Enter)', meaning: 'save the entry' },
      { key: '(Esc)', meaning: 'cancel the entry' },
    ]
  }
  return [
    { key: '(↑/↓)', meaning: 'move the cursor' },
    { key: '(space)', meaning: 'toggle accept / affirm the ack' },
    { key: '(Enter)', meaning: 'open redirect, answer blocker, or affirm' },
    { key: '(a)pprove', meaning: 'approve the gate' },
    ...(input.gateMode === 'early' ? [{ key: '(e)xtend', meaning: 'extend the round' }] : []),
    { key: '(x)abort', meaning: 'abort the run' },
    { key: '(q)uit', meaning: 'abandon — write nothing' },
    { key: '(?) help', meaning: 'toggle this help' },
  ]
}

function sessionListHints(input: Extract<HintsInput, { screen: 'session-list' }>): readonly KeyHint[] {
  return [
    { key: '(↑/↓)', meaning: 'move the cursor' },
    { key: '(Enter)', meaning: 'continue this run' },
    ...(input.stoppableHover ? [{ key: '(s)top active', meaning: 'stop the running run' }] : []),
    ...(input.reopenableHover ? [{ key: '(r)eopen gate', meaning: 'reopen the gate of a finished run' }] : []),
    ...(input.deletableHover ? [{ key: '(d)elete', meaning: 'delete the run directory' }] : []),
    { key: '(n)ew', meaning: 'start a new session' },
    { key: '(q)uit', meaning: 'quit to the shell' },
    { key: '(?) help', meaning: 'toggle this help' },
  ]
}

/** Only the currently-active bindings of the current screen. */
export function keyHints(input: HintsInput): readonly KeyHint[] {
  if (input.screen === 'gate') return gateHints(input)
  if (input.screen === 'running') {
    return [
      { key: '(q)', meaning: 'request a calm stop' },
      { key: '(Ctrl-C ×2)', meaning: 'exit immediately with code 130' },
      { key: '(?) help', meaning: 'toggle this help' },
    ]
  }
  if (input.screen === 'session-list') return sessionListHints(input)
  if (input.screen === 'session-create') {
    return [
      { key: '(Tab)', meaning: 'switch field' },
      { key: '(Enter)', meaning: 'start the run' },
      { key: '(Esc)', meaning: 'back to the list' },
    ]
  }
  if (input.screen === 'ack') return [{ key: '(any key)', meaning: 'back to sessions' }]
  return [
    { key: '(y)', meaning: 'delete permanently' },
    { key: '(any other key)', meaning: 'cancel back to the list' },
  ]
}

export interface OverlayState {
  readonly open: boolean
}

export type OverlayRouting =
  | { readonly kind: 'pass' }
  | { readonly kind: 'consume' }
  | { readonly kind: 'state'; readonly state: OverlayState }

/**
 * Fixed routing order: (1) a text-entry context consumes `?` as literal
 * input — the screen reducer sees the key; (2) an open overlay swallows
 * every key except its dismiss keys (`?`, Esc); (3) otherwise `?` opens.
 * Outcomes never carry decisions — overlay state cannot feed a settle path.
 */
export function reduceHelpOverlay(
  state: OverlayState,
  textEntry: boolean,
  input: string,
  key: KeyFlags,
): OverlayRouting {
  if (textEntry) return { kind: 'pass' }
  if (state.open) {
    if (input === '?' || key.escape) return { kind: 'state', state: { open: false } }
    return { kind: 'consume' }
  }
  if (input === '?') return { kind: 'state', state: { open: true } }
  return { kind: 'pass' }
}

/** Persistent key-hints footer: the hint keys, joined and width-truncated. */
export function Footer(props: { readonly hints: readonly KeyHint[]; readonly width: number }): ReactElement {
  const line = truncateDisplay(props.hints.map((hint) => hint.key).join(' · '), Math.max(1, props.width - 2))
  return createElement(Text, { dimColor: true }, line)
}

/** Help overlay: an inset framed panel listing this screen's keys with meanings. */
export function HelpOverlay(props: {
  readonly screen: string
  readonly hints: readonly KeyHint[]
  readonly width: number
}): ReactElement {
  const rows = props.hints.map((hint) => `${hint.key} — ${hint.meaning}`)
  return createElement(
    Box,
    { flexDirection: 'column' },
    ...frameLines(rows, props.width, `Keys · ${props.screen}`).map((line) => createElement(Text, { key: line }, line)),
  )
}

/**
 * Screen composition: content (and, while help is open, the inset overlay)
 * above the footer — the footer stays visible beneath the overlay, and a
 * dismissed overlay leaves the frame exactly as it was.
 */
export function ScreenChrome(props: {
  readonly overlay: OverlayState
  readonly screen: string
  readonly hints: readonly KeyHint[]
  readonly width: number
  readonly children: readonly ReactElement[]
}): ReactElement {
  return createElement(
    Box,
    { flexDirection: 'column' },
    ...props.children,
    ...(props.overlay.open
      ? [createElement(HelpOverlay, { key: 'help', screen: props.screen, hints: props.hints, width: props.width })]
      : []),
    createElement(Footer, { key: 'footer', hints: props.hints, width: props.width }),
  )
}
