// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { render, useInput } from 'ink'
import { createElement, useCallback, useEffect } from 'react'

import { keyHints, ScreenChrome } from './tui-chrome.js'
import { createKeyFeed } from './tui-gate-session.js'
import type { KeyFeed } from './tui-gate-session.js'
import { FramedPanel, panelRow } from './tui-panels.js'
import { createScriptKeys, pumpScript } from './tui-session-keys.js'
import type { ScriptKeys } from './tui-session-keys.js'
import { useTerminalWidth } from './tui-width.js'

/**
 * Any-key ack screen: a static block (report, notice) owned by the session
 * shell — no pager, no truncation. Any key returns; an exhausted script also
 * resolves so a scripted run can never hang on it. The mount is injectable:
 * ink-testing-library exposes frames, the live ink instance does not.
 *
 * Presentation (fancy-ui 6.4): framing only — the block sits in the shared
 * frame style with a footer listing the single any-key affordance. `?` acks
 * like any other key; the overlay is never composed here.
 */

export interface AckInstance {
  readonly unmount: () => void
  readonly lastFrame: () => string | undefined
}

export type AckMount = (element: ReturnType<typeof createElement>) => AckInstance

export interface AckFrames {
  readonly frames: readonly string[]
}

function inkMount(element: ReturnType<typeof createElement>): AckInstance {
  const instance = render(element, { stdin: process.stdin, exitOnCtrlC: false })
  return {
    unmount: (): void => {
      instance.unmount()
    },
    lastFrame: (): undefined => undefined,
  }
}

function AckScreen(props: {
  readonly lines: readonly string[]
  readonly onAck: () => void
  readonly keys?: KeyFeed
}): ReturnType<typeof createElement> {
  const handle = useCallback((): void => {
    props.onAck()
  }, [props])
  const width = useTerminalWidth()
  useInput(handle, { isActive: props.keys === undefined })
  useEffect(() => {
    if (props.keys === undefined) return undefined
    return props.keys.onKey(handle)
  }, [props.keys, handle])
  return createElement(ScreenChrome, {
    overlay: { open: false },
    screen: 'ack',
    hints: keyHints({ screen: 'ack' }),
    width,
    children: [
      createElement(FramedPanel, {
        title: '',
        rows: props.lines.map((line, index) => panelRow(`l${String(index)}`, line)),
        width,
      }),
    ],
  })
}

export function runAckScreen(deps: {
  readonly lines: readonly string[]
  /** Scripted key source standing in for a live terminal (tests). */
  readonly keyScript?: string
  /** Scripted keys shared across loop iterations; drives this screen's ack. */
  readonly script?: ScriptKeys
  /** Injectable mount; defaults to the live ink renderer. */
  readonly mount?: AckMount
}): Promise<AckFrames> {
  const lines = [...deps.lines]
  const script = deps.script ?? (deps.keyScript === undefined ? undefined : createScriptKeys(deps.keyScript))
  const keys = script === undefined ? undefined : createKeyFeed()
  const mount = deps.mount ?? inkMount
  return new Promise<AckFrames>((resolve) => {
    let settled = false
    const frames: string[] = []
    const finish = (): void => {
      if (settled) return
      settled = true
      const frame = instance.lastFrame()
      if (frame !== undefined) frames.push(frame)
      instance.unmount()
      resolve({ frames })
    }
    const instance = mount(
      createElement(AckScreen, {
        lines,
        ...(keys === undefined ? {} : { keys }),
        onAck: finish,
      }),
    )
    if (script === undefined || keys === undefined) return
    void pumpScript(keys, script, (): boolean => settled).then(finish)
  })
}
