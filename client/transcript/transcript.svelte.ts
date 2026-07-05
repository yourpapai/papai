// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { TranscriptEvent } from './fetcher-schemas.js'
import { fetchAllHistory } from './fetchers.js'
import { openTranscriptStream } from './sse.js'
import { mergeBySeq } from './stitch.js'

export type ViewerStatus = 'connecting' | 'live' | 'finished' | 'recording-disabled' | 'invalid-token' | 'error'

/**
 * Stitch order: open the live SSE stream first (buffering events until history
 * has loaded), page all history via fetchAllHistory, apply+merge (mergeBySeq)
 * history then flush the buffered live events on top.
 */
export function createTranscriptState(token: string) {
  let events = $state<TranscriptEvent[]>([])
  let status = $state<ViewerStatus>('connecting')
  const buffer: TranscriptEvent[] = []
  let historyLoaded = false

  const apply = (list: TranscriptEvent[]): void => {
    events = mergeBySeq(events, list)
  }

  const start = (): { close(): void } =>
    openTranscriptStream(token, {
      onEvent: (e) => {
        if (!historyLoaded) buffer.push(e)
        else apply([e])
        if (status === 'connecting') status = 'live'
      },
      onEnd: () => {
        if (status !== 'recording-disabled') status = 'finished'
      },
      onError: () => {
        if (status !== 'finished') status = 'error'
      },
    })

  const load = async (): Promise<void> => {
    const conn = start()
    try {
      const { events: hist, recordingDisabled } = await fetchAllHistory(token, -1)
      apply(hist)
      historyLoaded = true
      apply(buffer.splice(0))
      if (recordingDisabled && events.length === 0) status = 'recording-disabled'
    } catch (err) {
      conn.close()
      status = err instanceof Error && err.message === 'not_found' ? 'invalid-token' : 'error'
    }
  }

  return {
    get events() {
      return events
    },
    get status() {
      return status
    },
    load,
  }
}
