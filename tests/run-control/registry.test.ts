// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import type { Experimental_SteeringNotDeliveredReason, Experimental_SteeringOutcome } from 'ai'

import { RunRegistry } from '../../src/run-control/registry.js'
import { requestSteer } from '../../src/run-control/steering.js'
import type { SteeringHandle } from '../../src/run-control/types.js'
import { createFakeSteering, createMockReply } from '../utils/test-helpers.js'

const delivered: Experimental_SteeringOutcome = {
  type: 'delivered',
  id: 'steer-delivered',
  message: { role: 'user', content: 'only project X' },
  stepNumber: 1,
}

const notDelivered = (reason: Experimental_SteeringNotDeliveredReason): Experimental_SteeringOutcome => ({
  type: 'not-delivered',
  id: 'steer-undelivered',
  message: { role: 'user', content: 'and use tabs' },
  reason,
})

/** A handle whose outcomes the test resolves by hand, in arrival order. */
function deferredHandle(): {
  handle: SteeringHandle
  resolvers: Array<(outcome: Experimental_SteeringOutcome) => void>
} {
  const resolvers: Array<(outcome: Experimental_SteeringOutcome) => void> = []
  const handle = createFakeSteering(
    () =>
      new Promise<Experimental_SteeringOutcome>((resolve) => {
        resolvers.push(resolve)
      }),
  )
  return { handle, resolvers }
}

describe('RunRegistry', () => {
  let registry: RunRegistry

  beforeEach(() => {
    registry = new RunRegistry()
  })

  test('begin creates a run retrievable by contextId, carrying the steering handle', () => {
    const { reply } = createMockReply()
    const steering = createFakeSteering(() => Promise.resolve(delivered))
    const run = registry.begin('ctx-1', { turnId: 't1', reply, originatingMessageIds: [], steering })
    expect(run.contextId).toBe('ctx-1')
    expect(run.turnId).toBe('t1')
    expect(run.stopRequested).toBe(false)
    expect(run.steering).toBe(steering)
    expect(run.steeringStarted).toBe(false)
    expect(run.pendingSteerOutcomes).toEqual([])
    expect(run.steerLeftovers).toEqual([])
    expect(run.completedEffects).toEqual([])
    expect(registry.get('ctx-1')).toBe(run)
  })

  test('get returns undefined for unknown context', () => {
    expect(registry.get('nope')).toBeUndefined()
  })

  test('end settles pending steers and returns only the undelivered text', async () => {
    const { reply } = createMockReply()
    const { handle, resolvers } = deferredHandle()
    const run = registry.begin('ctx-1', { turnId: 't1', reply, originatingMessageIds: [], steering: handle })
    run.steeringStarted = true
    requestSteer(run, 'only project X')
    requestSteer(run, 'and use tabs')

    const ending = registry.end('ctx-1')
    expect(registry.get('ctx-1')).toBeUndefined()
    resolvers[0]?.(delivered)
    resolvers[1]?.(notDelivered('finished'))

    expect(await ending).toEqual([{ text: 'and use tabs' }])
    expect(run.pendingSteerOutcomes).toEqual([])
  })

  test('end does not resolve before a pending steer outcome settles', async () => {
    const { reply } = createMockReply()
    const { handle, resolvers } = deferredHandle()
    const run = registry.begin('ctx-1', { turnId: 't1', reply, originatingMessageIds: [], steering: handle })
    run.steeringStarted = true
    requestSteer(run, 'only project X')

    let ended = false
    const ending = registry.end('ctx-1').then((leftover) => {
      ended = true
      return leftover
    })
    await Promise.resolve()
    expect(ended).toBe(false)

    resolvers[0]?.(notDelivered('aborted'))
    expect(await ending).toEqual([{ text: 'only project X' }])
  })

  test('end on unknown context returns an empty array', async () => {
    expect(await registry.end('nope')).toEqual([])
  })

  test('a run begun without a handle replays every steer as leftover', async () => {
    const { reply } = createMockReply()
    const run = registry.begin('ctx-1', { turnId: 't1', reply, originatingMessageIds: [] })
    requestSteer(run, 'only project X')

    expect(await registry.end('ctx-1')).toEqual([{ text: 'only project X' }])
  })

  test('one run per context — second begin replaces the first', () => {
    const { reply } = createMockReply()
    registry.begin('ctx-1', { turnId: 't1', reply, originatingMessageIds: [] })
    const second = registry.begin('ctx-1', { turnId: 't2', reply, originatingMessageIds: [] })
    expect(registry.get('ctx-1')).toBe(second)
  })

  test('records originatingMessageIds on the run', () => {
    const { reply } = createMockReply()
    const run = registry.begin('ctx', { turnId: 't1', reply, originatingMessageIds: ['m1', 'm2'] })
    expect(run.originatingMessageIds).toEqual(['m1', 'm2'])
  })
})
