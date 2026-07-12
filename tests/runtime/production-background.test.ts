// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { ChatRouter } from '../../src/chat/router.js'
import { type ProductionBackgroundDeps, startProductionBackground } from '../../src/runtime/production-background.js'

function fixture(events: string[]): ProductionBackgroundDeps {
  const record = (event: string): void => {
    events.push(event)
  }
  return {
    registerDefaultTasks: () => record('tasks:register'),
    startRecurring: () => record('recurring:start'),
    startPollers: () => record('pollers:start'),
    startTasks: () => record('tasks:start'),
    startSweeper: () => {
      record('sweeper:start')
      return () => record('sweeper:stop')
    },
    stopTasks: () => record('tasks:stop'),
    drainTasks: (): Promise<void> => {
      record('tasks:drain')
      return Promise.resolve()
    },
    stopRecurring: () => record('recurring:stop'),
    stopPollers: () => record('pollers:stop'),
    unregisterDefaultTasks: () => record('tasks:unregister'),
  }
}

const router = (): ChatRouter =>
  new ChatRouter(() => {
    throw new Error('No adapters are created by the production background contract')
  })

describe('production background composition', () => {
  test('starts static production services and stops them in safety order once', async () => {
    const events: string[] = []
    const background = await startProductionBackground(router(), fixture(events))

    await background.stop()
    await background.stop()

    expect(events).toEqual([
      'tasks:register',
      'recurring:start',
      'pollers:start',
      'tasks:start',
      'sweeper:start',
      'tasks:stop',
      'tasks:drain',
      'recurring:stop',
      'pollers:stop',
      'tasks:unregister',
      'sweeper:stop',
    ])
  })

  test('rolls back acquired services when startup fails', async () => {
    const events: string[] = []
    const deps = fixture(events)
    deps.startPollers = (): void => {
      events.push('pollers:start')
      throw new Error('poller boom')
    }

    await expect(startProductionBackground(router(), deps)).rejects.toThrow('poller boom')
    expect(events).toContain('tasks:unregister')
  })

  test('attempts every cleanup step and reports all shutdown failures', async () => {
    const events: string[] = []
    const deps = fixture(events)
    deps.stopTasks = (): void => {
      events.push('tasks:stop')
      throw new Error('stop boom')
    }
    deps.drainTasks = (): Promise<void> => {
      events.push('tasks:drain')
      return Promise.reject(new Error('drain boom'))
    }
    const background = await startProductionBackground(router(), deps)

    const firstStop = background.stop()
    const secondStop = background.stop()

    expect(firstStop).toBe(secondStop)
    await expect(firstStop).rejects.toBeInstanceOf(AggregateError)
    expect(events.slice(-6)).toEqual([
      'tasks:stop',
      'tasks:drain',
      'recurring:stop',
      'pollers:stop',
      'tasks:unregister',
      'sweeper:stop',
    ])
  })
})
