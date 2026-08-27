// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { render, useInput } from 'ink'
import { createElement, useCallback, useEffect, useRef } from 'react'

import type { EventInput } from './events.js'
import type { RunFold } from './run-view.js'
import { createRunView, emptyRunFold, foldRunView } from './run-view.js'
import { createKeyFeed } from './tui-gate-session.js'
import type { KeyFeed } from './tui-gate-session.js'
import { restoreRunFold } from './tui-restore.js'
import { reduceStopKey } from './tui-signals.js'
import type { StopKeyState } from './tui-signals.js'

/**
 * TUI running screen session (tui-wiring D1): mounts the existing RunView
 * over the fold layer and feeds it bus events. Holds no decision-relevant
 * state — the fold rebuilds from `events.ndjson`, so unmount is always safe.
 * Stop keys ride `reduceStopKey`: `q` / first Ctrl-C request a calm stop
 * through the injected seam, a second Ctrl-C hard-exits 130.
 */

export interface RunScreenTuiProps {
  readonly bag: RunFold
  readonly width: number
  readonly startedAt: number
  readonly now: number
  readonly onRequestCalmStop: () => void
  readonly onHardExit: () => void
  /** Scripted key source standing in for a live terminal stdin (tests). */
  readonly keys?: KeyFeed
}

const PLAIN_KEY = {
  upArrow: false,
  downArrow: false,
  return: false,
  escape: false,
  backspace: false,
  delete: false,
}

/** Instantiated once per module, not per render — the run tree must keep a stable component identity so `Static` regions never re-emit (fancy-ui D6). */
const RunView = createRunView()

export function RunScreenTui(props: RunScreenTuiProps): ReturnType<typeof createElement> {
  const { bag, width, startedAt, now, onRequestCalmStop, onHardExit, keys } = props
  const stopState = useRef<StopKeyState>({ interruptions: 0 })
  const handle = useCallback(
    (input: string) => {
      const reduced = reduceStopKey(stopState.current, input)
      stopState.current = reduced.state
      if (reduced.action.kind === 'calm-stop') onRequestCalmStop()
      else if (reduced.action.kind === 'exit-130') onHardExit()
    },
    [onRequestCalmStop, onHardExit],
  )
  useInput(handle, { isActive: keys === undefined })
  useEffect(() => {
    if (keys === undefined) return undefined
    return keys.onKey(handle)
  }, [keys, handle])
  return createElement(RunView, {
    state: bag.state,
    slots: bag.slots,
    findings: bag.findings,
    width,
    startedAt,
    now,
  })
}

export interface RunScreenSessionDeps {
  readonly logPath: string
  readonly requestCalmStop: () => void
  readonly hardExit: (code: number) => void
  /** Scripted keys driving the session when no live terminal owns stdin. */
  readonly keyScript?: string
}

export interface RunScreenSession {
  readonly onEvent: (event: EventInput) => void
  readonly unmount: () => void
  /** Current fold bag — the data behind the next frame. */
  readonly snapshot: () => RunFold
  /** Resolves once scripted keys have been delivered (live terminals: immediate). */
  readonly whenArmed: Promise<void>
}

function seedFold(logPath: string): RunFold {
  try {
    return restoreRunFold(logPath)
  } catch {
    // A fresh run has no event log yet — an empty fold is the correct seed.
    return emptyRunFold()
  }
}

async function feedScript(feed: KeyFeed, script: string): Promise<void> {
  await feed.whenSubscribed
  for (const char of script) feed.emit(char, PLAIN_KEY)
}

export function createRunScreenSession(deps: RunScreenSessionDeps): RunScreenSession {
  let bag = seedFold(deps.logPath)
  const width = process.stdout.columns ?? 100
  const startedAt = Date.now()
  const keys = deps.keyScript === undefined ? undefined : createKeyFeed()
  const element = (): ReturnType<typeof createElement> =>
    createElement(RunScreenTui, {
      bag,
      width,
      startedAt,
      now: Date.now(),
      onRequestCalmStop: (): void => {
        deps.requestCalmStop()
      },
      onHardExit: (): void => {
        deps.hardExit(130)
      },
      ...(keys === undefined ? {} : { keys }),
    })
  const instance = render(element(), { stdin: process.stdin, exitOnCtrlC: false })
  const whenArmed = keys === undefined ? Promise.resolve() : feedScript(keys, deps.keyScript ?? '')
  return {
    onEvent: (event) => {
      bag = foldRunView(bag, event)
      instance.rerender(element())
    },
    unmount: (): void => {
      instance.unmount()
    },
    snapshot: (): RunFold => bag,
    whenArmed,
  }
}
