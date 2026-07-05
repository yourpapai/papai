// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { installSseStub, sseStub, uninstallSseStub } from '../../../client/stories/stubs/sse.js'
import { createTranscriptState } from '../../../client/transcript/transcript.svelte.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

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
})
