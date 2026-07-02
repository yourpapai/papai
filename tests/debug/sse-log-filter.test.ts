// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { emitGlobal } from '../../src/debug/event-bus.js'
import { addClient, removeClient, init } from '../../src/debug/state-collector.js'

const collect = (): { controller: ReadableStreamDefaultController; seen: string[] } => {
  const seen: string[] = []
  const controller: ReadableStreamDefaultController = {
    enqueue: (chunk: Uint8Array): void => void seen.push(new TextDecoder().decode(chunk)),
    close: (): void => {},
    error: (): void => {},
    desiredSize: 1,
  }
  return { controller, seen }
}

describe('SSE per-connection log filter', () => {
  test('log:entry events are filtered by the connection filter; other events pass', () => {
    init('admin')
    const { controller, seen } = collect()
    addClient(controller, { include: ['chat'], exclude: [], level: 0 })
    // drop the state:init frame
    seen.length = 0

    emitGlobal('log:entry', { level: 30, time: 't1', msg: 'a', scope: 'chat:telegram' })
    emitGlobal('log:entry', { level: 30, time: 't2', msg: 'b', scope: 'tool:x' })

    const logFrames = seen.filter((f) => f.includes('event: log:entry'))
    expect(logFrames).toHaveLength(1)
    expect(logFrames[0]).toContain('chat:telegram')

    removeClient(controller)
  })
})
