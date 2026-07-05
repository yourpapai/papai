// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { TranscriptEvent } from './fetcher-schemas.js'

/** Merge history + live into one seq-ordered list with no duplicates. */
export function mergeBySeq(history: TranscriptEvent[], live: TranscriptEvent[]): TranscriptEvent[] {
  const bySeq = new Map<number, TranscriptEvent>()
  for (const e of history) bySeq.set(e.seq, e)
  for (const e of live) if (!bySeq.has(e.seq)) bySeq.set(e.seq, e)
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq)
}
