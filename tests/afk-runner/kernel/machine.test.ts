// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import {
  initialStep,
  kernelSetup,
  createKernelMachine,
  initialKernelContext,
  step,
} from '../../../afk-runner/src/kernel/machine.js'

const alpha = kernelSetup.createStateConfig({
  on: {
    'stage.enter': [
      {
        target: 'fork',
        guard: { type: 'isStage', params: { stage: 'fork' } },
        actions: ['closeThenActivate'],
      },
      {
        target: 'beta',
        guard: { type: 'isStage', params: { stage: 'beta' } },
        actions: ['closeThenActivate'],
      },
    ],
  },
})

const fork = kernelSetup.createStateConfig({
  on: {
    'stage.enter': {
      target: 'beta',
      guard: { type: 'isStage', params: { stage: 'beta' } },
      actions: ['closeThenActivate'],
    },
  },
})

function fixtureMachine(): ReturnType<typeof createKernelMachine> {
  return createKernelMachine({
    id: 'fixture',
    initial: 'start',
    context: initialKernelContext({ alpha: 'pending', beta: 'pending' }),
    on: {
      'stage.exit': { actions: ['markStageDone'] },
    },
    states: {
      start: {
        on: {
          'stage.enter': {
            target: 'alpha',
            guard: { type: 'isStage', params: { stage: 'alpha' } },
            actions: ['closeThenActivate'],
          },
        },
      },
      alpha,
      fork,
      beta: {},
    },
  })
}

describe('kernel machine-as-data builder', () => {
  it('derives the initial state from initialStep', () => {
    const [snapshot, actions] = initialStep(fixtureMachine())
    expect(snapshot.value).toBe('start')
    expect(snapshot.context.stages).toEqual({ alpha: 'pending', beta: 'pending' })
    expect(actions).toHaveLength(0)
  })

  it('folds dot-notation stage.enter events through pure transition to the expected values', () => {
    const machine = fixtureMachine()
    let [snapshot] = initialStep(machine)
    ;[snapshot] = step(machine, snapshot, { type: 'stage.enter', stage: 'alpha' })
    expect(snapshot.value).toBe('alpha')
    expect(snapshot.context.stages).toEqual({ alpha: 'active', beta: 'pending' })
    ;[snapshot] = step(machine, snapshot, { type: 'stage.enter', stage: 'beta' })
    expect(snapshot.value).toBe('beta')
    expect(snapshot.context.stages).toEqual({ alpha: 'done', beta: 'active' })
  })

  it('picks the first matching edge in an ordered transition array', () => {
    const machine = fixtureMachine()
    let [snapshot] = initialStep(machine)
    ;[snapshot] = step(machine, snapshot, { type: 'stage.enter', stage: 'alpha' })
    ;[snapshot] = step(machine, snapshot, { type: 'stage.enter', stage: 'fork' })
    expect(snapshot.value).toBe('fork')
    ;[snapshot] = step(machine, snapshot, { type: 'stage.enter', stage: 'beta' })
    expect(snapshot.value).toBe('beta')
  })

  it('guards reject invalid transitions deterministically: snapshot unchanged, no actions', () => {
    const machine = fixtureMachine()
    const [snapshot] = initialStep(machine)
    const rejected = step(machine, snapshot, { type: 'stage.enter', stage: 'beta' })
    expect(rejected[0].value).toBe('start')
    expect(rejected[0].context.stages).toEqual(snapshot.context.stages)
    expect(rejected[1]).toHaveLength(0)
    const rejectedAgain = step(machine, snapshot, { type: 'stage.enter', stage: 'beta' })
    expect(rejectedAgain[0].context).toEqual(rejected[0].context)
    expect(rejectedAgain[1]).toHaveLength(0)
  })

  it('executes root-level stage.exit assigns without moving position', () => {
    const machine = fixtureMachine()
    let [snapshot] = initialStep(machine)
    ;[snapshot] = step(machine, snapshot, { type: 'stage.enter', stage: 'alpha' })
    ;[snapshot] = step(machine, snapshot, { type: 'stage.exit', stage: 'alpha' })
    expect(snapshot.value).toBe('alpha')
    expect(snapshot.context.stages).toEqual({ alpha: 'done', beta: 'pending' })
  })

  it('folding the same event list twice produces deep-equal snapshots', () => {
    const machine = fixtureMachine()
    const events = [
      { type: 'stage.enter', stage: 'alpha' },
      { type: 'stage.exit', stage: 'alpha' },
      { type: 'stage.enter', stage: 'beta' },
    ] as const
    const foldOnce = (): unknown => {
      let [snapshot]: ReturnType<typeof step> = initialStep(machine)
      for (const event of events) [snapshot] = step(machine, snapshot, event)
      return { value: snapshot.value, context: snapshot.context }
    }
    expect(foldOnce()).toEqual(foldOnce())
  })
})
