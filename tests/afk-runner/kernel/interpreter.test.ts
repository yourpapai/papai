// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { executeActions } from '../../../afk-runner/src/kernel/interpreter.js'
import type { ActionSinks, UnknownAction } from '../../../afk-runner/src/kernel/interpreter.js'
import {
  createKernelMachine,
  initialStep,
  initialKernelContext,
  kernelSetup,
  step,
} from '../../../afk-runner/src/kernel/machine.js'
import type { KernelActions, KernelEvent } from '../../../afk-runner/src/kernel/machine.js'

const enterBeta = kernelSetup.createStateConfig({
  on: {
    'stage.enter': {
      target: 'beta',
      guard: { type: 'isStage', params: { stage: 'beta' } },
      actions: ['closeThenActivate'],
    },
  },
})

function commandMachine(): ReturnType<typeof createKernelMachine> {
  return createKernelMachine({
    id: 'commands',
    initial: 'start',
    context: initialKernelContext({ alpha: 'pending', beta: 'pending' }),
    states: {
      start: {
        on: {
          'stage.enter': [
            {
              target: 'alpha',
              guard: { type: 'isStage', params: { stage: 'alpha' } },
              actions: ['closeThenActivate'],
            },
            {
              target: 'beta',
              guard: { type: 'isStage', params: { stage: 'beta' } },
              actions: [
                { type: 'emit', params: { event: { type: 'stage.exit', stage: 'start' } } },
                { type: 'schedule', params: { work: { kind: 'spawn-reviewer' } } },
              ],
            },
          ],
        },
      },
      alpha: enterBeta,
      beta: {},
    },
  })
}

function fakeSinks(): { sinks: ActionSinks; emitted: KernelEvent[]; scheduled: string[] } {
  const emitted: KernelEvent[] = []
  const scheduled: string[] = []
  return {
    emitted,
    scheduled,
    sinks: {
      emit: (event) => {
        emitted.push(event)
      },
      schedule: (work) => {
        scheduled.push(work.kind)
      },
    },
  }
}

describe('kernel interpreter — closed action vocabulary', () => {
  it('step returns emit/schedule commands verbatim in transition order', () => {
    const machine = commandMachine()
    const [start] = initialStep(machine)
    const [, actions] = step(machine, start, { type: 'stage.enter', stage: 'beta' })
    expect(actions.map((action) => ({ type: action.type, params: action.params }))).toEqual([
      { type: 'emit', params: { event: { type: 'stage.exit', stage: 'start' } } },
      { type: 'schedule', params: { work: { kind: 'spawn-reviewer' } } },
    ])
  })

  it('executes emit and schedule against injected sinks in order', () => {
    const machine = commandMachine()
    const [start] = initialStep(machine)
    const [, actions] = step(machine, start, { type: 'stage.enter', stage: 'beta' })
    const { sinks, emitted, scheduled } = fakeSinks()
    executeActions(actions, sinks)
    expect(emitted).toEqual([{ type: 'stage.exit', stage: 'start' }])
    expect(scheduled).toEqual(['spawn-reviewer'])
  })

  it('rejects executable actions outside the closed vocabulary', () => {
    const { sinks } = fakeSinks()
    const rogue: readonly UnknownAction[] = [{ type: 'xstate.raise', params: { event: { type: 'gate.presented' } } }]
    expect(() => executeActions(rogue, sinks)).toThrow('xstate.raise')
  })

  it('assigns never surface in the executable action array', () => {
    const machine = commandMachine()
    const [start] = initialStep(machine)
    const [snapshot, actions] = step(machine, start, { type: 'stage.enter', stage: 'alpha' })
    expect(snapshot.context.stages['alpha']).toBe('active')
    expect(actions).toHaveLength(0)
  })

  it('re-folding the same events executes zero actions', () => {
    const machine = commandMachine()
    const events: readonly KernelEvent[] = [
      { type: 'stage.enter', stage: 'beta' },
      { type: 'stage.enter', stage: 'alpha' },
    ]
    const { emitted, scheduled } = fakeSinks()
    let snapshot = initialStep(machine)[0]
    for (let round = 0; round < 2; round += 1) {
      snapshot = initialStep(machine)[0]
      for (const event of events) {
        const [next] = step(machine, snapshot, event)
        snapshot = next
      }
    }
    expect(emitted).toHaveLength(0)
    expect(scheduled).toHaveLength(0)
    expect(snapshot.value).toBe('beta')
  })

  it('executeActions runs nothing for an empty action list', () => {
    const { sinks, emitted, scheduled } = fakeSinks()
    const empty: KernelActions = []
    executeActions(empty, sinks)
    expect(emitted).toHaveLength(0)
    expect(scheduled).toHaveLength(0)
  })
})
