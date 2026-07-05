// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { installSseStub, sseStub, uninstallSseStub } from '../../../client/stories/stubs/sse.js'
import type { TranscriptEvent } from '../../../client/transcript/fetcher-schemas.js'
import { openTranscriptStream } from '../../../client/transcript/sse.js'

describe('openTranscriptStream', () => {
  beforeEach(() => {
    installSseStub()
  })

  afterEach(() => {
    uninstallSseStub()
  })

  test('parses a well-formed event and forwards it to onEvent', () => {
    const onEvent = mock((_e: TranscriptEvent) => {})
    openTranscriptStream('tok', { onEvent, onEnd: () => {}, onError: () => {} })
    sseStub.emit('update', { seq: 1, ts: 't1', type: 'update', payload: { a: 1 } })
    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(onEvent.mock.calls[0]?.[0]).toEqual({ seq: 1, ts: 't1', type: 'update', payload: { a: 1 } })
  })

  test('swallows a malformed frame instead of throwing', () => {
    const onEvent = mock(() => {})
    openTranscriptStream('tok', { onEvent, onEnd: () => {}, onError: () => {} })
    expect(() => sseStub.emit('update', { seq: 'not-a-number' })).not.toThrow()
    expect(onEvent).not.toHaveBeenCalled()
  })

  test('calls onEnd then closes the connection on the end event', () => {
    const onEnd = mock(() => {})
    const conn = openTranscriptStream('tok', { onEvent: () => {}, onEnd, onError: () => {} })
    sseStub.emit('end', {})
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(() => conn.close()).not.toThrow()
  })

  test('calls onError on the error event', () => {
    const onError = mock(() => {})
    openTranscriptStream('tok', { onEvent: () => {}, onEnd: () => {}, onError })
    sseStub.emit('error', {})
    expect(onError).toHaveBeenCalledTimes(1)
  })

  test('close() closes the underlying connection', () => {
    const onEvent = mock(() => {})
    const conn = openTranscriptStream('tok', { onEvent, onEnd: () => {}, onError: () => {} })
    conn.close()
    sseStub.emit('update', { seq: 1, ts: 't1', type: 'update', payload: {} })
    expect(onEvent).not.toHaveBeenCalled()
  })
})
