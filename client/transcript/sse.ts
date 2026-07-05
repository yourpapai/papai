// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { TranscriptEventSchema, TRANSCRIPT_EVENT_TYPES, type TranscriptEvent } from './fetcher-schemas.js'

export interface StreamHandlers {
  onEvent(e: TranscriptEvent): void
  onEnd(): void
  onError(): void
}

export function openTranscriptStream(token: string, handlers: StreamHandlers): { close(): void } {
  const source = new EventSource(`/t/${encodeURIComponent(token)}/stream`)
  const handle = (raw: unknown): void => {
    if (typeof raw !== 'string') return
    try {
      const parsed = TranscriptEventSchema.safeParse(JSON.parse(raw))
      if (parsed.success) handlers.onEvent(parsed.data)
    } catch {
      /* skip malformed frame */
    }
  }
  for (const type of TRANSCRIPT_EVENT_TYPES) {
    source.addEventListener(type, (e) => {
      handle(e.data)
    })
  }
  source.addEventListener('end', () => {
    handlers.onEnd()
    source.close()
  })
  source.addEventListener('error', () => {
    handlers.onError()
  })
  return {
    close: () => {
      source.close()
    },
  }
}
