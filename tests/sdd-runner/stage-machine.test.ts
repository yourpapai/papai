// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { EventInputSchema } from '../../sdd-runner/src/events.js'
import type { EventInput } from '../../sdd-runner/src/events.js'
import { createStageMachine, remainingStages, StageHaltError } from '../../sdd-runner/src/stage-machine.js'

function eventSummary(event: EventInput): string {
  if ('stage' in event) return `${event.type}:${event.stage}`
  return event.type
}

interface Bus {
  readonly emit: (event: EventInput) => void
  readonly emitted: EventInput[]
}

function makeBus(): Bus {
  const emitted: EventInput[] = []
  return {
    emit: (event) => {
      emitted.push(EventInputSchema.parse(event))
    },
    emitted,
  }
}

describe('remainingStages', () => {
  it('returns the ordered tail from the resume point, keeping atomicity at M', () => {
    expect(remainingStages('review', 'M')).toEqual(['review', 'decompose', 'atomicity', 'gate'])
  })

  it('skips atomicity at S', () => {
    expect(remainingStages('review', 'S')).toEqual(['review', 'decompose', 'gate'])
  })

  it('returns all six stages from intake before depth is classified', () => {
    expect(remainingStages('intake', null)).toEqual(['intake', 'draft', 'review', 'decompose', 'atomicity', 'gate'])
  })
})

describe('runStage', () => {
  it('emits stage_enter before the handler and stage_exit after it', async () => {
    const bus = makeBus()
    const machine = createStageMachine({ emit: bus.emit })
    const order: string[] = []
    await machine.runStage('draft', () => {
      order.push('handler')
      return Promise.resolve()
    })
    const types = bus.emitted.map(eventSummary)
    expect(types).toEqual(['stage_enter:draft', 'stage_exit:draft'])
    expect(order).toEqual(['handler'])
  })

  it('propagates a halt without emitting stage_exit for the active stage', async () => {
    const bus = makeBus()
    const machine = createStageMachine({ emit: bus.emit })
    const run = machine.runStage('review', () => Promise.reject(new StageHaltError('cap hit with open blockers')))
    await expect(run).rejects.toThrow(/cap hit/u)
    const types = bus.emitted.map((e) => e.type)
    expect(types).toEqual(['stage_enter'])
  })

  it('propagates unexpected errors without emitting stage_exit', async () => {
    const bus = makeBus()
    const machine = createStageMachine({ emit: bus.emit })
    const run = machine.runStage('intake', () => Promise.reject(new Error('estimator died')))
    await expect(run).rejects.toThrow(/estimator died/u)
    expect(bus.emitted).toHaveLength(1)
  })
})
