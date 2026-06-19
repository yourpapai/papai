// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { RunRegistry } from '../../src/run-control/registry.js'
import type { PrepareStep } from '../../src/run-control/steering-prepare-step.js'
import { composePrepareSteps, createSteeringPrepareStep } from '../../src/run-control/steering-prepare-step.js'
import type { RunControl } from '../../src/run-control/types.js'
import { createMockReply } from '../utils/test-helpers.js'

function makeRun(): RunControl {
  const { reply } = createMockReply()
  return new RunRegistry().begin('ctx', { turnId: 't', reply })
}

describe('createSteeringPrepareStep', () => {
  test('returns undefined when steer queue is empty', () => {
    const run = makeRun()
    const step = createSteeringPrepareStep(run)
    expect(step({ stepNumber: 0, steps: [], messages: [{ role: 'user' as const, content: 'hi' }] })).toBeUndefined()
  })

  test('appends queued steer messages and drains the queue', () => {
    const run = makeRun()
    run.steerQueue.push({ text: 'only project X' })
    const step = createSteeringPrepareStep(run)
    const base = [{ role: 'user' as const, content: 'close stale tasks' }]
    const result = step({ stepNumber: 1, steps: [], messages: base })
    expect(result).toEqual({ messages: [...base, { role: 'user', content: 'only project X' }] })
    expect(run.steerQueue).toEqual([])
  })
})

describe('composePrepareSteps', () => {
  test('steering only: forwards injected messages', () => {
    const run = makeRun()
    run.steerQueue.push({ text: 'steer' })
    const composed = composePrepareSteps(createSteeringPrepareStep(run), undefined)
    const result = composed({ stepNumber: 1, steps: [], messages: [{ role: 'user' as const, content: 'a' }] })
    expect(result?.messages).toEqual([
      { role: 'user', content: 'a' },
      { role: 'user', content: 'steer' },
    ])
    expect(result?.activeTools).toBeUndefined()
  })

  test('merges steering messages with disclosure activeTools', () => {
    const run = makeRun()
    run.steerQueue.push({ text: 'steer' })
    const disclosure: PrepareStep = () => ({ activeTools: ['get_current_time'] })
    const composed = composePrepareSteps(createSteeringPrepareStep(run), disclosure)
    const result = composed({ stepNumber: 1, steps: [], messages: [] })
    expect(result?.messages).toEqual([{ role: 'user', content: 'steer' }])
    expect(result?.activeTools).toEqual(['get_current_time'])
  })

  test('disclosure open-all ({}) preserves steering messages and sets no activeTools', () => {
    const run = makeRun()
    run.steerQueue.push({ text: 'steer' })
    const disclosure: PrepareStep = () => ({})
    const composed = composePrepareSteps(createSteeringPrepareStep(run), disclosure)
    const result = composed({ stepNumber: 1, steps: [], messages: [] })
    expect(result?.messages).toEqual([{ role: 'user', content: 'steer' }])
    expect(result?.activeTools).toBeUndefined()
  })

  test('both empty: returns undefined', () => {
    const run = makeRun()
    const disclosure: PrepareStep = () => ({})
    const composed = composePrepareSteps(createSteeringPrepareStep(run), disclosure)
    expect(composed({ stepNumber: 0, steps: [], messages: [] })).toBeUndefined()
  })
})
