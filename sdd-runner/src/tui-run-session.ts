// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { render, useInput, useStdout } from 'ink'
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { EventInput } from './events.js'
import type { RunFold } from './run-view.js'
import { createRunView, emptyRunFold, foldRunView } from './run-view.js'
import { keyHints, reduceHelpOverlay, ScreenChrome } from './tui-chrome.js'
import type { OverlayState } from './tui-chrome.js'
import { createKeyFeed } from './tui-gate-session.js'
import type { KeyFeed } from './tui-gate-session.js'
import { restoreRunFold } from './tui-restore.js'
import { reduceStopKey } from './tui-signals.js'
import type { StopKeyState } from './tui-signals.js'
import { colorModeFromStdout } from './tui-tokens.js'
import { useTerminalWidth } from './tui-width.js'

/**
 * TUI running screen session (tui-wiring D1): mounts the existing RunView
 * over the fold layer and feeds it bus events. Holds no decision-relevant
 * state — the fold rebuilds from `events.ndjson`, so unmount is always safe.
 * Stop keys ride `reduceStopKey`: `q` / first Ctrl-C request a calm stop
 * through the injected seam, a second Ctrl-C hard-exits 130.
 *
 * Presentation (fancy-ui 6.2): the persistent footer + `?` help overlay ride
 * `ScreenChrome` above the stop keys (an open overlay swallows stop keys);
 * width is reactive (`useTerminalWidth` replaces the mount-time capture).
 */

export interface RunScreenTuiProps {
  readonly bag: RunFold
  /** Injectable width override; the terminal width when absent. */
  readonly width?: number
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

/** Overlay routing above the stop keys: an open overlay swallows `q`/Ctrl-C; `?`/Esc toggle it. */
function useRunScreenKeys(
  onRequestCalmStop: () => void,
  onHardExit: () => void,
): { readonly handle: (input: string) => void; readonly overlay: OverlayState } {
  const stopState = useRef<StopKeyState>({ interruptions: 0 })
  const [overlay, setOverlay] = useState<OverlayState>({ open: false })
  const overlayRef = useRef<OverlayState>(overlay)
  const handle = useCallback(
    (input: string) => {
      const routing = reduceHelpOverlay(overlayRef.current, false, input, {
        upArrow: false,
        downArrow: false,
        return: false,
        escape: input === '\u001b',
        backspace: false,
        delete: false,
      })
      if (routing.kind === 'state') {
        overlayRef.current = routing.state
        setOverlay(routing.state)
        return
      }
      if (routing.kind === 'consume') return
      const reduced = reduceStopKey(stopState.current, input)
      stopState.current = reduced.state
      if (reduced.action.kind === 'calm-stop') onRequestCalmStop()
      else if (reduced.action.kind === 'exit-130') onHardExit()
    },
    [onRequestCalmStop, onHardExit],
  )
  return { handle, overlay }
}

export function RunScreenTui(props: RunScreenTuiProps): ReturnType<typeof createElement> {
  const { bag, startedAt, now, onRequestCalmStop, onHardExit, keys } = props
  const { stdout } = useStdout()
  const terminalWidth = useTerminalWidth()
  const width = props.width ?? terminalWidth
  const colorMode = useMemo(() => colorModeFromStdout(stdout), [stdout])
  const { handle, overlay } = useRunScreenKeys(onRequestCalmStop, onHardExit)
  useInput(handle, { isActive: keys === undefined })
  useEffect(() => {
    if (keys === undefined) return undefined
    return keys.onKey(handle)
  }, [keys, handle])
  return createElement(ScreenChrome, {
    overlay,
    screen: 'running',
    hints: keyHints({ screen: 'running' }),
    width,
    children: [
      createElement(RunView, {
        state: bag.state,
        slots: bag.slots,
        findings: bag.findings,
        history: bag.history,
        width,
        startedAt,
        now,
        colorMode,
      }),
    ],
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
  const startedAt = Date.now()
  const keys = deps.keyScript === undefined ? undefined : createKeyFeed()
  const element = (): ReturnType<typeof createElement> =>
    createElement(RunScreenTui, {
      bag,
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
