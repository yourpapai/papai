// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ReplyFn, StatusHandle } from '../chat/types.js'
import { formatToolStatus } from './tool-status-labels.js'

const THINKING = '💭 Thinking…'

/** Owns a single ephemeral status message for one turn. All methods are best-effort and never throw. */
export type LiveStatusReporter = {
  /** Create the status message (Thinking placeholder). Safe to await even when unsupported. */
  start: () => Promise<void>
  /** A tool started executing. */
  onToolStart: (event: { toolName: string; input: unknown }) => void
  /** A tool finished executing. */
  onToolFinish: () => void
  /** Delete the status message. Idempotent. */
  dismiss: () => Promise<void>
}

/** Options for {@link createLiveStatusReporter}. */
export type LiveStatusReporterOptions = {
  /** When false, the reporter is fully inert — no status message is ever created. Defaults to true. */
  enabled?: boolean
}

export function createLiveStatusReporter(reply: ReplyFn, options?: LiveStatusReporterOptions): LiveStatusReporter {
  const enabled = options?.enabled !== false
  let handle: StatusHandle | undefined
  let inFlight = 0
  let lastStartLabel = THINKING
  let lastRendered: string | undefined

  const render = (): string => {
    if (inFlight <= 0) return THINKING
    if (inFlight === 1) return lastStartLabel
    return `${lastStartLabel} (+${inFlight - 1})`
  }

  const apply = (): void => {
    if (handle === undefined) return
    const text = render()
    if (text === lastRendered) return
    lastRendered = text
    void handle.update(text).catch(() => undefined)
  }

  return {
    start: async (): Promise<void> => {
      if (!enabled) return
      if (reply.createStatus === undefined) return
      handle = await reply.createStatus(THINKING).catch(() => undefined)
      if (handle !== undefined) lastRendered = THINKING
    },
    onToolStart: (event): void => {
      inFlight += 1
      lastStartLabel = formatToolStatus(event.toolName, event.input)
      apply()
    },
    onToolFinish: (): void => {
      inFlight = Math.max(0, inFlight - 1)
      apply()
    },
    dismiss: async (): Promise<void> => {
      if (handle === undefined) return
      const current = handle
      handle = undefined
      await current.dismiss().catch(() => undefined)
    },
  }
}
