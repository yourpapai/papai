// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { createEventBus } from '../../sdd-runner/src/event-bus.js'
import type { EventInput } from '../../sdd-runner/src/events.js'

function stageEnter(stage: 'intake' | 'draft' | 'review' = 'draft'): EventInput {
  return { altitude: 'L2', type: 'stage_enter', stage }
}

describe('createEventBus', () => {
  it('fans out an emitted event to all subscribers in subscription order', () => {
    const calls: string[] = []
    const bus = createEventBus()
    bus.subscribe(() => {
      calls.push('first')
    })
    bus.subscribe(() => {
      calls.push('second')
    })
    bus.subscribe(() => {
      calls.push('third')
    })
    bus.emit(stageEnter())
    expect(calls).toEqual(['first', 'second', 'third'])
  })

  it('passes the event object verbatim to each subscriber', () => {
    const received: EventInput[] = []
    const bus = createEventBus()
    bus.subscribe((event) => {
      received.push(event)
    })
    const event = stageEnter('review')
    bus.emit(event)
    expect(received).toEqual([event])
    expect(received[0]).toBe(event)
  })

  it('continues notifying siblings when a subscriber throws, reporting the error via onError', () => {
    const errors: Array<{ error: Error; event: EventInput }> = []
    const onError = (error: Error, event: EventInput): void => {
      errors.push({ error, event })
    }
    const received: string[] = []
    const bus = createEventBus({ onError })
    bus.subscribe(() => {
      received.push('before')
    })
    bus.subscribe(() => {
      throw new Error('boom')
    })
    bus.subscribe(() => {
      received.push('after')
    })
    const event = stageEnter()
    bus.emit(event)
    expect(received).toEqual(['before', 'after'])
    expect(errors).toHaveLength(1)
    expect(errors[0]?.error.message).toBe('boom')
    expect(errors[0]?.event).toBe(event)
  })

  it('supports unsubscribing via the returned handle', () => {
    const calls: string[] = []
    const bus = createEventBus()
    const unsubscribe = bus.subscribe(() => {
      calls.push('kept')
    })
    bus.subscribe(() => {
      calls.push('always')
    })
    bus.emit(stageEnter())
    unsubscribe()
    bus.emit(stageEnter())
    expect(calls).toEqual(['kept', 'always', 'always'])
  })
})
