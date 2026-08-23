// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { render, useInput } from 'ink'
import { createElement, useCallback, useEffect, useRef, useState } from 'react'

import type { KeyFlags } from './gate-session-state.js'
import { routeOfRow } from './session-flow.js'
import { listSessions } from './session-list.js'
import type { SessionRow } from './session-list.js'
import { createKeyFeed } from './tui-gate-session.js'
import type { KeyFeed } from './tui-gate-session.js'
import { reduceSessionScreen, SessionScreen } from './tui-session-screen.js'
import type { SessionScreenState } from './tui-session-screen.js'

/**
 * Live driver for the session screen (D2): a real terminal renders with
 * stdin; tests pass `keyScript` and get a scripted key feed instead.
 * Decisions resolve to targets executed through session-flow — abandoning
 * (`q`, escape, or an exhausted script) resolves null and writes nothing.
 */

export type PickerOutcome =
  | { readonly kind: 'gate' | 'resume' | 'report' | 'stop' | 'reopen'; readonly runId: string }
  | { readonly kind: 'create' }
  | null

export interface SessionPickerDeps {
  /** Defaults to listing the work dir's runs. */
  readonly listRows?: () => Promise<readonly SessionRow[]>
  readonly workDir?: string
  /** Scripted key source standing in for a live terminal. */
  readonly keyScript?: string
}

function outcomeOf(
  action: Extract<ReturnType<typeof reduceSessionScreen>, { kind: 'route' | 'stop' | 'reopen' | 'create' }>,
  rows: readonly SessionRow[],
): Exclude<PickerOutcome, null> {
  if (action.kind === 'create') return { kind: 'create' }
  if (action.kind === 'route') {
    const row = rows.find((candidate) => candidate.runId === action.runId)
    const verb = row === undefined ? 'resume' : routeOfRow(row)
    return { kind: verb, runId: action.runId }
  }
  return { kind: action.kind, runId: action.runId }
}

function SessionPicker(props: {
  readonly rows: readonly SessionRow[]
  readonly now: Date
  readonly onSettle: (outcome: PickerOutcome) => void
  readonly keys?: KeyFeed
}): ReturnType<typeof createElement> {
  const [state, setState] = useState<SessionScreenState>({ cursor: 0 })
  const stateRef = useRef(state)
  const handle = useCallback(
    (input: string, key: KeyFlags): void => {
      const action = reduceSessionScreen(stateRef.current, props.rows, input, key)
      if (action.kind === 'none') return
      if (action.kind === 'state') {
        stateRef.current = action.state
        setState(action.state)
        return
      }
      if (action.kind === 'abandon') {
        props.onSettle(null)
        return
      }
      props.onSettle(outcomeOf(action, props.rows))
    },
    [props],
  )
  useInput(handle, { isActive: props.keys === undefined })
  useEffect(() => {
    if (props.keys === undefined) return undefined
    return props.keys.onKey(handle)
  }, [props.keys, handle])
  return createElement(SessionScreen, { rows: props.rows, state, now: props.now })
}

const UP = '\u001b[A'
const DOWN = '\u001b[B'
const CR = '\r'

function tokensOf(script: string): string[] {
  const tokens: string[] = []
  let rest = script
  while (rest.length > 0) {
    const token = rest.startsWith(UP) || rest.startsWith(DOWN) ? rest.slice(0, 3) : rest.slice(0, 1)
    tokens.push(token)
    rest = rest.slice(token.length)
  }
  return tokens
}

function keyOf(token: string): KeyFlags {
  return {
    upArrow: token === UP,
    downArrow: token === DOWN,
    return: token === CR,
    escape: false,
    backspace: false,
    delete: false,
  }
}

async function feedScript(feed: KeyFeed, script: string): Promise<void> {
  await feed.whenSubscribed
  for (const token of tokensOf(script)) {
    feed.emit(token, keyOf(token))
  }
}

export async function runSessionPicker(deps: SessionPickerDeps): Promise<PickerOutcome> {
  const rows = await (deps.listRows?.() ?? listSessions(deps.workDir ?? '.'))
  const keys = deps.keyScript === undefined ? undefined : createKeyFeed()
  return new Promise<PickerOutcome>((resolve) => {
    let settled = false
    const instance = render(
      createElement(SessionPicker, {
        rows,
        now: new Date(),
        keys,
        onSettle: (outcome) => {
          if (settled) return
          settled = true
          instance.unmount()
          resolve(outcome)
        },
      }),
      { stdin: process.stdin, exitOnCtrlC: false },
    )
    if (keys === undefined) return
    void feedScript(keys, deps.keyScript ?? '').then(() => {
      if (settled) return
      settled = true
      instance.unmount()
      resolve(null)
    })
  })
}
