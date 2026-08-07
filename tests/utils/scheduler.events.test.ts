// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import type { EventEmitter } from '../../src/utils/scheduler.helpers.js'
import type {
  ErrorHandler,
  ErrorEvent,
  FatalErrorHandler,
  FatalErrorEvent,
  RetryHandler,
  RetryEvent,
  TickHandler,
  TickEvent,
} from '../../src/utils/scheduler.types.js'

type SchedulerEventsModule = typeof import('../../src/utils/scheduler.events.js')

const isSchedulerEventsModule = (value: unknown): value is SchedulerEventsModule =>
  typeof value === 'object' && value !== null && typeof Reflect.get(value, 'createEmitters') === 'function'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const requireRecord = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new Error('expected a record value')
  }
  return value
}

interface Recorder {
  readonly childCalls: readonly unknown[][]
  readonly errorCalls: ReadonlyArray<{ payload: unknown; message: unknown }>
}

async function loadSchedulerEventsModule(): Promise<{ eventsModule: SchedulerEventsModule; recorder: Recorder }> {
  const childCalls: unknown[][] = []
  const errorCalls: Array<{ payload: unknown; message: unknown }> = []
  const childLogger = {
    debug: (): void => {},
    info: (): void => {},
    warn: (): void => {},
    error: (payload: unknown, message: unknown): void => {
      errorCalls.push({ payload, message })
    },
  }
  const logger = {
    debug: (): void => {},
    info: (): void => {},
    warn: (): void => {},
    error: (): void => {},
    child: (...args: unknown[]): typeof childLogger => {
      childCalls.push(args)
      return childLogger
    },
  }
  void mock.module('../../src/logger.js', () => ({ logger }))
  const loaded: unknown = await import(`../../src/utils/scheduler.events.js?t=${crypto.randomUUID()}`)
  if (!isSchedulerEventsModule(loaded)) {
    throw new Error('scheduler.events module did not export expected shape')
  }
  return { eventsModule: loaded, recorder: { childCalls, errorCalls } }
}

const throwingHandler = (): void => {
  throw new Error('handler blew up')
}

const eventsFor = (slot: 'tick' | 'error' | 'retry' | 'fatalError'): EventEmitter => {
  const events: EventEmitter = {
    tick: new Set<TickHandler>(),
    error: new Set<ErrorHandler>(),
    retry: new Set<RetryHandler>(),
    fatalError: new Set<FatalErrorHandler>(),
  }
  if (slot === 'tick') events.tick.add(throwingHandler)
  else if (slot === 'error') events.error.add(throwingHandler)
  else if (slot === 'retry') events.retry.add(throwingHandler)
  else events.fatalError.add(throwingHandler)
  return events
}

const fixedTimestamp = new Date(0)

describe('createEmitters', () => {
  test('binds the module logger to the scheduler:events scope at import time', async () => {
    const { recorder } = await loadSchedulerEventsModule()

    expect(recorder.childCalls.length).toBe(1)
    const scopeArg = requireRecord(recorder.childCalls[0]?.[0])
    expect(scopeArg['scope']).toBe('scheduler:events')
  })

  test('logs the exact payload when a tick handler throws', async () => {
    const {
      eventsModule: { createEmitters },
      recorder,
    } = await loadSchedulerEventsModule()

    const tickEvent: TickEvent = { name: 'tick-task', duration: 7, timestamp: fixedTimestamp }
    createEmitters(eventsFor('tick')).emitTick(tickEvent)

    expect(recorder.errorCalls.length).toBe(1)
    const payload = requireRecord(recorder.errorCalls[0]?.payload)
    expect(payload['error']).toBe('handler blew up')
    expect(payload['event']).toBe('tick')
    expect(recorder.errorCalls[0]?.message).toBe('Event handler threw error')
  })

  test('logs the exact payload when an error handler throws', async () => {
    const {
      eventsModule: { createEmitters },
      recorder,
    } = await loadSchedulerEventsModule()

    const errorEvent: ErrorEvent = {
      name: 'error-task',
      error: new Error('boom'),
      attempt: 2,
      timestamp: fixedTimestamp,
    }
    createEmitters(eventsFor('error')).emitError(errorEvent)

    expect(recorder.errorCalls.length).toBe(1)
    const payload = requireRecord(recorder.errorCalls[0]?.payload)
    expect(payload['error']).toBe('handler blew up')
    expect(payload['event']).toBe('error')
    expect(recorder.errorCalls[0]?.message).toBe('Event handler threw error')
  })

  test('logs the exact payload when a retry handler throws', async () => {
    const {
      eventsModule: { createEmitters },
      recorder,
    } = await loadSchedulerEventsModule()

    const retryEvent: RetryEvent = {
      name: 'retry-task',
      attempt: 3,
      delay: 250,
      timestamp: fixedTimestamp,
    }
    createEmitters(eventsFor('retry')).emitRetry(retryEvent)

    expect(recorder.errorCalls.length).toBe(1)
    const payload = requireRecord(recorder.errorCalls[0]?.payload)
    expect(payload['error']).toBe('handler blew up')
    expect(payload['event']).toBe('retry')
    expect(recorder.errorCalls[0]?.message).toBe('Event handler threw error')
  })

  test('logs the exact payload when a fatalError handler throws', async () => {
    const {
      eventsModule: { createEmitters },
      recorder,
    } = await loadSchedulerEventsModule()

    const fatalErrorEvent: FatalErrorEvent = {
      name: 'fatal-task',
      error: new Error('boom'),
      timestamp: fixedTimestamp,
    }
    createEmitters(eventsFor('fatalError')).emitFatalError(fatalErrorEvent)

    expect(recorder.errorCalls.length).toBe(1)
    const payload = requireRecord(recorder.errorCalls[0]?.payload)
    expect(payload['error']).toBe('handler blew up')
    expect(payload['event']).toBe('fatalError')
    expect(recorder.errorCalls[0]?.message).toBe('Event handler threw error')
  })
})
