// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { TranscriptEvent } from '../../../client/transcript/fetcher-schemas.js'
import { mergeBySeq } from '../../../client/transcript/stitch.js'

const ev = (seq: number): TranscriptEvent => ({
  seq,
  ts: `t${seq}`,
  type: 'update',
  payload: {},
})

describe('mergeBySeq', () => {
  test('drops live events already covered by history', () => {
    const merged = mergeBySeq([ev(1), ev(2), ev(3)], [ev(3), ev(4), ev(5)])
    expect(merged.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5])
  })

  test('is idempotent on repeated seqs from either side', () => {
    const merged = mergeBySeq([ev(1), ev(2)], [ev(2), ev(2), ev(3)])
    expect(merged.map((e) => e.seq)).toEqual([1, 2, 3])
  })

  test('sorts out-of-order input by seq', () => {
    const merged = mergeBySeq([ev(2), ev(1)], [ev(4), ev(3)])
    expect(merged.map((e) => e.seq)).toEqual([1, 2, 3, 4])
  })

  test('history wins on seq collision even when live carries different content', () => {
    const hist: TranscriptEvent = { seq: 1, ts: 'history-ts', type: 'update', payload: { from: 'history' } }
    const live: TranscriptEvent = { seq: 1, ts: 'live-ts', type: 'result', payload: { from: 'live' } }
    const merged = mergeBySeq([hist], [live])
    expect(merged).toEqual([hist])
  })
})
