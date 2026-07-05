// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { TranscriptEvent } from './fetcher-schemas.js'
import { fetchAllHistory } from './fetchers.js'
import type { StreamHandlers } from './sse.js'
import { openTranscriptStream } from './sse.js'
import { mergeBySeq } from './stitch.js'

export type ViewerStatus = 'connecting' | 'live' | 'finished' | 'recording-disabled' | 'invalid-token' | 'error'

export interface TranscriptState {
  readonly events: TranscriptEvent[]
  readonly status: ViewerStatus
  load(): Promise<void>
}

interface ViewerData {
  events: TranscriptEvent[]
  status: ViewerStatus
}

interface StreamCtx {
  readonly token: string
  readonly data: ViewerData
  readonly buffer: TranscriptEvent[]
  historyLoaded: boolean
  maxSeq: number
  resyncing: boolean
}

function applyEvents(ctx: StreamCtx, list: TranscriptEvent[]): void {
  ctx.data.events = mergeBySeq(ctx.data.events, list)
  for (const e of list) if (e.seq > ctx.maxSeq) ctx.maxSeq = e.seq
}

/** Backfill events missed while disconnected (the live stream is live-only, no replay), then recover the banner. */
async function resync(ctx: StreamCtx): Promise<void> {
  if (ctx.resyncing) return
  ctx.resyncing = true
  try {
    const { events: gap } = await fetchAllHistory(ctx.token, ctx.maxSeq)
    applyEvents(ctx, gap)
    if (ctx.data.status === 'error' || ctx.data.status === 'connecting') ctx.data.status = 'live'
  } catch {
    /* native EventSource keeps retrying; the next reconnect will trigger another resync */
  } finally {
    ctx.resyncing = false
  }
}

function buildHandlers(ctx: StreamCtx): StreamHandlers {
  return {
    onEvent: (e) => {
      if (ctx.historyLoaded) applyEvents(ctx, [e])
      else ctx.buffer.push(e)
      if (ctx.data.status !== 'finished' && ctx.data.status !== 'recording-disabled') ctx.data.status = 'live'
    },
    onEnd: () => {
      if (ctx.data.status !== 'recording-disabled') ctx.data.status = 'finished'
    },
    onError: () => {
      if (ctx.data.status === 'finished') return
      ctx.data.status = 'error'
      if (ctx.historyLoaded) void resync(ctx)
    },
  }
}

async function loadHistory(ctx: StreamCtx, conn: { close(): void }): Promise<void> {
  try {
    const { events: hist, recordingDisabled } = await fetchAllHistory(ctx.token, -1)
    applyEvents(ctx, hist)
    ctx.historyLoaded = true
    applyEvents(ctx, ctx.buffer.splice(0))
    if (recordingDisabled && ctx.data.events.length === 0) ctx.data.status = 'recording-disabled'
    else if (ctx.data.status === 'error') ctx.data.status = 'live'
  } catch (err) {
    conn.close()
    ctx.data.status = err instanceof Error && err.message === 'not_found' ? 'invalid-token' : 'error'
  }
}

/**
 * Stitch order: open the live SSE stream first (buffering events until history
 * has loaded), page all history via fetchAllHistory, apply+merge (mergeBySeq)
 * history then flush the buffered live events on top.
 *
 * Self-heal: the native EventSource auto-reconnects the live tail on its own;
 * onError only flips the banner and (once history has loaded) backfills the
 * gap via resync(), since the live stream never replays missed events.
 */
export function createTranscriptState(token: string): TranscriptState {
  const data = $state<ViewerData>({ events: [], status: 'connecting' })
  const ctx: StreamCtx = { token, data, buffer: [], historyLoaded: false, maxSeq: -1, resyncing: false }

  const load = (): Promise<void> => {
    const conn = openTranscriptStream(token, buildHandlers(ctx))
    return loadHistory(ctx, conn)
  }

  return {
    get events(): TranscriptEvent[] {
      return data.events
    },
    get status(): ViewerStatus {
      return data.status
    },
    load,
  }
}
