// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { Experimental_SteeringNotDeliveredReason, Experimental_SteeringOutcome } from 'ai'

import { RunRegistry } from '../../src/run-control/registry.js'
import { requestSteer, settleSteering } from '../../src/run-control/steering.js'
import type { RunControl, SteeringHandle } from '../../src/run-control/types.js'
import { assertEach, type Row } from '../utils/grouped-assertions.js'
import { createFakeSteering, createMockReply } from '../utils/test-helpers.js'

const notDelivered = (reason: Experimental_SteeringNotDeliveredReason): Experimental_SteeringOutcome => ({
  type: 'not-delivered',
  id: 'steer-1',
  message: { role: 'user', content: 'only project X' },
  reason,
})

const delivered: Experimental_SteeringOutcome = {
  type: 'delivered',
  id: 'steer-1',
  message: { role: 'user', content: 'only project X' },
  stepNumber: 1,
}

function makeRun(steering: SteeringHandle): RunControl {
  return new RunRegistry().begin('ctx-1', {
    turnId: 't1',
    reply: createMockReply().reply,
    originatingMessageIds: [],
    steering,
  })
}

function deferredSteer(): { handle: SteeringHandle; resolve: (outcome: Experimental_SteeringOutcome) => void } {
  let resolveOutcome: (outcome: Experimental_SteeringOutcome) => void = () => undefined
  const handle = createFakeSteering(
    () =>
      new Promise<Experimental_SteeringOutcome>((resolve) => {
        resolveOutcome = resolve
      }),
  )
  return { handle, resolve: (outcome) => resolveOutcome(outcome) }
}

describe('requestSteer', () => {
  test('hands the text to the run handle and records one pending outcome', () => {
    const steered: unknown[] = []
    const handle = createFakeSteering((message) => {
      steered.push(message)
      return Promise.resolve(delivered)
    })
    const run = makeRun(handle)

    requestSteer(run, 'only project X')

    expect(steered).toEqual(['only project X'])
    expect(run.pendingSteerOutcomes).toHaveLength(1)
  })
})

describe('settleSteering', () => {
  test('delivered text leaves nothing for replay', async () => {
    const run = makeRun(createFakeSteering(() => Promise.resolve(delivered)))
    run.steeringStarted = true
    requestSteer(run, 'only project X')

    await settleSteering(run)

    expect(run.steerLeftovers).toEqual([])
    expect(run.pendingSteerOutcomes).toEqual([])
  })

  test('not-delivered outcome matrix becomes a leftover', async () => {
    type CaseRow = Row<{ readonly reason: Experimental_SteeringNotDeliveredReason }>
    const rows: readonly CaseRow[] = [
      { label: 'finished', reason: 'finished' },
      { label: 'stop-condition', reason: 'stop-condition' },
      { label: 'aborted', reason: 'aborted' },
      { label: 'error', reason: 'error' },
      { label: 'waiting-for-tool-results', reason: 'waiting-for-tool-results' },
      { label: 'removed-by-prepare-step', reason: 'removed-by-prepare-step' },
    ]

    await assertEach(rows, async (row) => {
      const run = makeRun(createFakeSteering(() => Promise.resolve(notDelivered(row.reason))))
      run.steeringStarted = true
      requestSteer(run, 'only project X')
      await settleSteering(run)
      expect(run.steerLeftovers).toEqual([{ text: 'only project X' }])
    })
  })

  test('a rejected steer() becomes a leftover', async () => {
    const run = makeRun(createFakeSteering(() => Promise.reject(new Error('steer exploded'))))
    run.steeringStarted = true
    requestSteer(run, 'only project X')

    await settleSteering(run)

    expect(run.steerLeftovers).toEqual([{ text: 'only project X' }])
  })

  test('waits for an outcome that settles after the loop returned', async () => {
    const { handle, resolve } = deferredSteer()
    const run = makeRun(handle)
    run.steeringStarted = true
    requestSteer(run, 'only project X')

    let settled = false
    const settling = settleSteering(run).then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    resolve(notDelivered('finished'))
    await settling
    expect(run.steerLeftovers).toEqual([{ text: 'only project X' }])
  })

  test('leftovers keep arrival order when outcomes settle in reverse', async () => {
    const resolvers: Array<(outcome: Experimental_SteeringOutcome) => void> = []
    const run = makeRun(
      createFakeSteering(
        () =>
          new Promise<Experimental_SteeringOutcome>((resolve) => {
            resolvers.push(resolve)
          }),
      ),
    )
    run.steeringStarted = true
    requestSteer(run, 'first steer')
    requestSteer(run, 'second steer')

    const settling = settleSteering(run)
    resolvers[1]?.(notDelivered('finished'))
    resolvers[0]?.(notDelivered('finished'))
    await settling

    expect(run.steerLeftovers).toEqual([{ text: 'first steer' }, { text: 'second steer' }])
  })

  test('a handle that never started delivers nothing, so pending text is not waited on', async () => {
    const run = makeRun(createFakeSteering(() => new Promise<Experimental_SteeringOutcome>(() => {})))
    requestSteer(run, 'only project X')
    expect(run.steeringStarted).toBe(false)

    await settleSteering(run)

    expect(run.steerLeftovers).toEqual([{ text: 'only project X' }])
  })

  test('settling twice does not duplicate leftovers', async () => {
    const run = makeRun(createFakeSteering(() => Promise.resolve(notDelivered('finished'))))
    run.steeringStarted = true
    requestSteer(run, 'only project X')

    await settleSteering(run)
    await settleSteering(run)

    expect(run.steerLeftovers).toEqual([{ text: 'only project X' }])
  })
})
