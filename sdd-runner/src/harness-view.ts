// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { EventInput } from './events.js'
import type { LiveViewWiring } from './live-view.js'
import { wireLiveView } from './live-view.js'
import type { Streams } from './render-mode.js'
import { requestCalmStop } from './stop-controller.js'
import { registerTerminalTitle, TERMINAL_TITLE_RESTORE } from './terminal-title.js'
import type { TerminalTitleHandle } from './terminal-title.js'
import { createRunScreenSession } from './tui-run-session.js'

/** Injectable seams for `harnessLiveView` (tests drive the TUI mode headlessly). */
export interface LiveViewOverrides {
  readonly streams?: Streams
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly keyScript?: string
}

/** Mode-decided live view for this process: Ink run screen on a TTY, lines otherwise. */
export function harnessLiveView(
  lineRender: (event: EventInput) => void,
  hardExit: (code: number) => void,
  overrides?: LiveViewOverrides,
): LiveViewWiring {
  return wireLiveView(
    overrides?.streams ?? { stdout: { isTTY: process.stdout.isTTY }, stdin: { isTTY: process.stdin.isTTY } },
    overrides?.env ?? process.env,
    lineRender,
    ({ runDir, logPath }) =>
      createRunScreenSession({
        logPath,
        requestCalmStop: (): void => {
          requestCalmStop(runDir)
        },
        hardExit,
        ...(overrides?.keyScript === undefined ? {} : { keyScript: overrides.keyScript }),
      }),
  )
}

/** Title restoration on a TTY only; the interrupt handlers carry the teardown hook. */
export function registerTitleIfTty(
  stream: { readonly isTTY?: boolean; write(chunk: string): boolean },
  onInterrupt: (code: number) => void,
): TerminalTitleHandle | undefined {
  if (stream.isTTY !== true) return undefined
  return registerTerminalTitle(
    (chunk: string): void => {
      stream.write(chunk)
    },
    (): string => TERMINAL_TITLE_RESTORE,
    onInterrupt,
  )
}
