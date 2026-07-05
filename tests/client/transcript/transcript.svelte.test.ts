// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { installSseStub, sseStub, uninstallSseStub } from '../../../client/stories/stubs/sse.js'
import { createTranscriptState } from '../../../client/transcript/transcript.svelte.js'
import { restoreFetch, setMockFetch, waitFor } from '../../utils/test-helpers.js'

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

/** Serve `first` on the initial history fetch, then `rest` on every subsequent call (e.g. a resync backfill). */
function sequentialHistoryMock(first: Response, rest: Response): (url: string) => Promise<Response> {
  let calls = 0
  return (_url: string): Promise<Response> => {
    const response = calls === 0 ? first : rest
    calls += 1
    return Promise.resolve(response)
  }
}

describe('createTranscriptState', () => {
  beforeEach(() => {
    installSseStub()
  })

  afterEach(() => {
    uninstallSseStub()
    restoreFetch()
  })

  test('stitches history + a live event and flips status to live', async () => {
    setMockFetch(() =>
      Promise.resolve(json({ events: [{ seq: 1, ts: 't1', type: 'result', payload: {} }], nextCursor: null })),
    )
    const state = createTranscriptState('tok')
    const loaded = state.load()
    sseStub.emit('update', { seq: 2, ts: 't2', type: 'update', payload: { a: 1 } })
    await loaded
    expect(state.status).toBe('live')
    expect(state.events.map((e) => e.seq)).toEqual([1, 2])
  })

  test('404 on history sets status invalid-token', async () => {
    setMockFetch(() => Promise.resolve(json({ error: 'not found' }, 404)))
    const state = createTranscriptState('tok')
    await state.load()
    expect(state.status).toBe('invalid-token')
  })

  test('recording-disabled with no events sets status recording-disabled', async () => {
    setMockFetch(() => Promise.resolve(json({ events: [], nextCursor: null, recording: 'disabled' })))
    const state = createTranscriptState('tok')
    await state.load()
    expect(state.status).toBe('recording-disabled')
    expect(state.events).toEqual([])
  })

  test('stream end sets status finished', async () => {
    setMockFetch(() => Promise.resolve(json({ events: [], nextCursor: null })))
    const state = createTranscriptState('tok')
    await state.load()
    sseStub.emit('end', {})
    expect(state.status).toBe('finished')
  })

  test('stream error before history has loaded sets status error (no resync yet)', async () => {
    let resolveHistory: (() => void) | undefined
    const historyPromise = new Promise<Response>((resolve) => {
      resolveHistory = (): void => resolve(json({ events: [], nextCursor: null }))
    })
    setMockFetch(() => historyPromise)
    const state = createTranscriptState('tok')
    const loaded = state.load()
    sseStub.emit('error', {})
    expect(state.status).toBe('error')
    resolveHistory?.()
    await loaded
  })

  test('a live event after history has loaded is applied immediately, not buffered', async () => {
    setMockFetch(() => Promise.resolve(json({ events: [], nextCursor: null })))
    const state = createTranscriptState('tok')
    await state.load()
    sseStub.emit('update', { seq: 1, ts: 't1', type: 'update', payload: {} })
    expect(state.events.map((e) => e.seq)).toEqual([1])
  })

  test('reconnect: stream error after history loaded triggers resync backfill and recovers status to live', async () => {
    setMockFetch(
      sequentialHistoryMock(
        json({ events: [{ seq: 1, ts: 't1', type: 'result', payload: {} }], nextCursor: null }),
        json({ events: [{ seq: 2, ts: 't2', type: 'update', payload: {} }], nextCursor: null }),
      ),
    )
    const state = createTranscriptState('tok')
    await state.load()
    sseStub.emit('error', {})
    expect(state.status).toBe('error')
    await waitFor(() => state.status === 'live')
    expect(state.events.map((e) => e.seq)).toEqual([1, 2])
  })
})
