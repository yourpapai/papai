// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { HistoryResponseSchema, type HistoryResponse, type TranscriptEvent } from './fetcher-schemas.js'

export async function fetchHistoryPage(token: string, after: number): Promise<HistoryResponse> {
  const res = await fetch(`/t/${encodeURIComponent(token)}/transcript?after=${after}&limit=200`)
  if (res.status === 404) throw new Error('not_found')
  return HistoryResponseSchema.parse(await res.json())
}

type HistoryAccumulator = { events: TranscriptEvent[]; recordingDisabled: boolean }

async function pageHistory(token: string, cursor: number, acc: HistoryAccumulator): Promise<HistoryAccumulator> {
  const page = await fetchHistoryPage(token, cursor)
  const merged: HistoryAccumulator = {
    events: [...acc.events, ...page.events],
    recordingDisabled: acc.recordingDisabled || page.recording === 'disabled',
  }
  return page.nextCursor === null ? merged : pageHistory(token, page.nextCursor, merged)
}

/** Page from `after` until caught up. Returns all events + the recording marker of the first page. */
export function fetchAllHistory(token: string, after = -1): Promise<HistoryAccumulator> {
  return pageHistory(token, after, { events: [], recordingDisabled: false })
}
