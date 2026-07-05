// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { fetchAllHistory, fetchHistoryPage } from '../../../client/transcript/fetchers.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

describe('fetchHistoryPage', () => {
  afterEach(() => {
    restoreFetch()
  })

  test('GETs the token-scoped transcript endpoint with after/limit query', async () => {
    let seenUrl = ''
    setMockFetch((url) => {
      seenUrl = url
      return Promise.resolve(
        new Response(JSON.stringify({ events: [], nextCursor: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })
    const page = await fetchHistoryPage('tok abc', 5)
    expect(seenUrl).toBe('/t/tok%20abc/transcript?after=5&limit=200')
    expect(page.nextCursor).toBeNull()
  })

  test('throws not_found on a 404', async () => {
    setMockFetch(() => Promise.resolve(new Response('nope', { status: 404 })))
    await expect(fetchHistoryPage('bad', -1)).rejects.toThrow('not_found')
  })
})

describe('fetchAllHistory', () => {
  afterEach(() => {
    restoreFetch()
  })

  test('pages until nextCursor is null, accumulating events and OR-ing recording-disabled', async () => {
    const pages = [
      { events: [{ seq: 0, ts: 't0', type: 'update', payload: {} }], nextCursor: 1, recording: 'disabled' },
      { events: [{ seq: 1, ts: 't1', type: 'update', payload: {} }], nextCursor: null },
    ]
    let call = 0
    setMockFetch(() => {
      const body = pages[call]
      call += 1
      return Promise.resolve(
        new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )
    })
    const { events, recordingDisabled } = await fetchAllHistory('tok', -1)
    expect(events.map((e) => e.seq)).toEqual([0, 1])
    expect(recordingDisabled).toBe(true)
    expect(call).toBe(2)
  })
})
