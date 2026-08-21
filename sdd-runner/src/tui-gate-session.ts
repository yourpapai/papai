// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Box, Text, render, useInput } from 'ink'
import { createElement, useCallback, useEffect, useRef, useState } from 'react'

import { renderGateAnswers, responseFromAnswers } from './gate-answers.js'
import type { GateAnswers } from './gate-answers.js'
import { parseGateResponse } from './gate-model.js'
import { decisionAnswers, reduceSession } from './gate-session-state.js'
import type { Decision, KeyFlags, SessionState } from './gate-session-state.js'
import type { GateSessionView } from './gate-session.js'
import { createGateScreen } from './tui-gate.js'

export type { KeyFlags } from './gate-session-state.js'

/**
 * TUI gate session (D4: one Ink front-end): the interactive walkthrough
 * `gate-session.ts` drove over a `Prompter`, driven instead by the gate
 * screen's own keys. Settling runs the same write-then-parse self-check as
 * every other write path; abandoning writes nothing.
 */

/** A push-source of key events standing in for a live terminal stdin. */
export interface KeyFeed {
  readonly onKey: (handler: (input: string, key: KeyFlags) => void) => () => void
  readonly emit: (input: string, key: KeyFlags) => void
  /** Resolves once a consumer subscribes, so scripted keys are never emitted before the session listens. */
  readonly whenSubscribed: Promise<void>
}

export function createKeyFeed(): KeyFeed {
  const handlers: Array<(input: string, key: KeyFlags) => void> = []
  let resolveSubscribed!: () => void
  const whenSubscribed = new Promise<void>((resolve) => {
    resolveSubscribed = resolve
  })
  return {
    onKey: (handler) => {
      handlers.push(handler)
      resolveSubscribed()
      return () => {
        const index = handlers.indexOf(handler)
        handlers.splice(index, 1)
      }
    },
    emit: (input, key) => {
      for (const handler of [...handlers]) handler(input, key)
    },
    whenSubscribed,
  }
}

export interface GateSessionTuiProps {
  readonly view: GateSessionView
  readonly onSettle: (answers: GateAnswers) => void
  readonly onAbandoned: () => void
  /** Scripted key source; absent on a live terminal (Ink's useInput drives). */
  readonly keys?: KeyFeed
}

export function GateSessionTui(props: GateSessionTuiProps): ReturnType<typeof createElement> {
  const { view, onSettle, onAbandoned, keys } = props
  const [state, setState] = useState<SessionState>({
    cursor: 0,
    toggles: {},
    redirects: {},
    blockerAnswers: {},
    ackAffirmed: false,
    input: null,
    inputText: '',
  })
  const stateRef = useRef<SessionState>(state)
  const settle = useCallback(
    (decision: Decision) => {
      onSettle(decisionAnswers(stateRef.current, view, decision))
    },
    [view, onSettle],
  )
  const handle = useCallback(
    (input: string, key: KeyFlags) => {
      const action = reduceSession(stateRef.current, view, input, key)
      if (action.kind === 'state') {
        stateRef.current = action.state
        setState(action.state)
      } else if (action.kind === 'settle') settle(action.decision)
      else if (action.kind === 'abandon') onAbandoned()
    },
    [view, settle, onAbandoned],
  )
  useInput(
    (input, key) => {
      handle(input, key)
    },
    { isActive: keys === undefined },
  )
  useEffect(() => {
    if (keys === undefined) return undefined
    return keys.onKey(handle)
  }, [keys, handle])
  const GateScreen = createGateScreen()
  const screen = createElement(GateScreen, { view, ...state, width: 100 })
  if (state.input === null) return screen
  const label = state.input.kind === 'redirect' ? `redirect for ${state.input.id}` : `answer for ${state.input.id}`
  return createElement(
    Box,
    { flexDirection: 'column' },
    screen,
    createElement(Text, null, `${label}: ${state.inputText}`),
  )
}

export interface TuiGateSessionDeps {
  readonly view: GateSessionView
  readonly writeGateMd: (md: string) => Promise<void>
  /** Scripted keys driving the session when no live terminal owns stdin. */
  readonly keyScript?: string
}

export type TuiGateSessionResult =
  | { readonly status: 'answered'; readonly decision: GateAnswers['decision']; readonly gateMd: string }
  | { readonly status: 'abandoned' }

function expectedContent(view: GateSessionView): Parameters<typeof parseGateResponse>[1] {
  return {
    assumptions: view.items
      .filter((item) => item.kind === 'assumption')
      .map((item) => ({ id: item.id, text: item.text, blast_radius: item.blastRadius })),
    blockers: view.blockers.map((blocker) => ({ id: blocker.id, gap: blocker.gap, evidence: blocker.evidence })),
    findings: view.items
      .filter((item) => item.kind === 'finding')
      .map((item) => ({ id: item.id, gap: item.text, evidence: item.evidence })),
    ...(view.requiredAck === null ? {} : { requiredAck: view.requiredAck.id }),
    gateMode: view.gateMode,
  }
}

async function settleWithSelfCheck(
  answers: GateAnswers,
  view: GateSessionView,
  writeGateMd: (md: string) => Promise<void>,
): Promise<{ readonly gateMd: string }> {
  const md = renderGateAnswers(answers)
  const parsed = parseGateResponse(md, expectedContent(view))
  if (JSON.stringify(parsed) !== JSON.stringify(responseFromAnswers(answers))) {
    throw new Error('answer self-check failed: rendered answers parse back as a different outcome')
  }
  await writeGateMd(md)
  return { gateMd: md }
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

/**
 * Drive the TUI gate session to a decision: a live terminal renders with
 * real stdin; tests pass `keyScript` and get a scripted key feed instead.
 * The settled answers pass the write-then-parse self-check before anything
 * is written; abandoning — `q` or an exhausted script — writes nothing.
 */
export function runTuiGateSession(deps: TuiGateSessionDeps): Promise<TuiGateSessionResult> {
  const { view, writeGateMd } = deps
  const keys = deps.keyScript === undefined ? undefined : createKeyFeed()
  return new Promise<TuiGateSessionResult>((resolve, reject) => {
    let settled = false
    let abandoned = false
    let settling = false
    const finish = (result: TuiGateSessionResult): void => {
      if (settled || abandoned || settling) return
      if (result.status === 'abandoned') abandoned = true
      else settled = true
      instance.unmount()
      resolve(result)
    }
    const instance = render(
      createElement(GateSessionTui, {
        view,
        onSettle: (answers) => {
          if (settled || abandoned || settling) return
          settling = true
          void settleWithSelfCheck(answers, view, writeGateMd)
            .then((outcome) => {
              settled = true
              instance.unmount()
              resolve({ status: 'answered', decision: answers.decision, gateMd: outcome.gateMd })
            })
            .catch((error: unknown) => {
              if (settled || abandoned) return
              settled = true
              instance.unmount()
              reject(error instanceof Error ? error : new Error(String(error)))
            })
        },
        onAbandoned: () => {
          finish({ status: 'abandoned' })
        },
        ...(keys === undefined ? {} : { keys }),
      }),
      { stdin: process.stdin, exitOnCtrlC: false },
    )
    if (keys === undefined) return
    void feedScript(keys, deps.keyScript ?? '').then(() => {
      finish({ status: 'abandoned' })
    })
  })
}
