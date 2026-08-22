// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { EventInput } from './events.js'
import { renderModeFor } from './render-mode.js'
import type { Streams } from './render-mode.js'

/**
 * Live-view wiring (tui-wiring D2): the render mode is decided once from the
 * streams and environment, and the event-bus surface follows it exclusively —
 * append-only line rendering in `line`/`line-debug` modes, the Ink running
 * screen in `tui` mode. Never both.
 */

export interface RunScreenContext {
  readonly runDir: string
  readonly logPath: string
}

export interface RunScreenSessionLike {
  readonly onEvent: (event: EventInput) => void
  readonly unmount: () => void
}

export type LiveViewWiring =
  | { readonly mode: 'line' | 'line-debug'; readonly render: (event: EventInput) => void }
  | {
      readonly mode: 'tui'
      readonly liveEvents: (event: EventInput) => void
      readonly mountRunScreen: (ctx: RunScreenContext) => void
      readonly unmountRunScreen: () => void
    }

export function wireLiveView(
  streams: Streams,
  env: Readonly<Record<string, string | undefined>>,
  lineRender: (event: EventInput) => void,
  createSession: (ctx: RunScreenContext) => RunScreenSessionLike,
): LiveViewWiring {
  const mode = renderModeFor(streams, env)
  if (mode !== 'tui') return { mode, render: lineRender }
  let session: RunScreenSessionLike | null = null
  return {
    mode,
    liveEvents: (event) => {
      session?.onEvent(event)
    },
    mountRunScreen: (ctx) => {
      session ??= createSession(ctx)
    },
    unmountRunScreen: () => {
      session?.unmount()
      session = null
    },
  }
}
