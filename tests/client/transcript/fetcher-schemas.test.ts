// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { HistoryResponseSchema, TranscriptEventSchema } from '../../../client/transcript/fetcher-schemas.js'

describe('transcript schemas', () => {
  test('parses a raw event envelope', () => {
    const e = TranscriptEventSchema.parse({
      seq: 3,
      ts: '2026-07-05T00:00:00Z',
      type: 'update',
      payload: { a: 1 },
    })
    expect(e.seq).toBe(3)
    expect(e.type).toBe('update')
  })

  test('rejects unknown type', () => {
    expect(() =>
      TranscriptEventSchema.parse({
        seq: 1,
        ts: 'x',
        type: 'bogus',
        payload: {},
      }),
    ).toThrow()
  })

  test('parses history page with recording marker', () => {
    const page = HistoryResponseSchema.parse({
      events: [],
      nextCursor: null,
      recording: 'disabled',
    })
    expect(page.recording).toBe('disabled')
    expect(page.nextCursor).toBeNull()
  })
})
