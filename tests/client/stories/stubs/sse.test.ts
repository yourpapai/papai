// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { installSseStub, sseStub, uninstallSseStub } from '../../../../client/stories/stubs/sse.js'

describe('sse stub', () => {
  let original: typeof globalThis.EventSource | undefined

  beforeEach(() => {
    original = globalThis.EventSource
  })

  afterEach(() => {
    uninstallSseStub()
    if (original !== undefined) globalThis.EventSource = original
  })

  test('installs a stub onto globalThis.EventSource', () => {
    installSseStub()
    expect(globalThis.EventSource).not.toBe(original)
  })

  test('emit dispatches a named event to every open connection subscriber', () => {
    installSseStub()
    const es = new globalThis.EventSource('/debug/sse')
    const handler = mock(() => {})
    es.addEventListener('llm:full', handler)
    sseStub.emit('llm:full', { ok: true })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  test('reset clears emitted-event history', () => {
    installSseStub()
    sseStub.emit('foo', {})
    expect(sseStub.history().length).toBe(1)
    sseStub.reset()
    expect(sseStub.history()).toEqual([])
  })
})
