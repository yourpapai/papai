// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import { DEFAULT_OPTIONS, DEFAULT_TASK_OPTIONS } from '../../src/utils/scheduler.helpers.js'
import type { Emitters, Task } from '../../src/utils/scheduler.helpers.js'

interface MockLogger {
  debug: () => void
  info: () => void
  warn: () => void
  error: () => void
  child: () => MockLogger
}

const mockLogger: MockLogger = {
  debug: (): void => {},
  info: (): void => {},
  warn: (): void => {},
  error: (): void => {},
  child: (): MockLogger => mockLogger,
}

void mock.module('../../src/logger.js', () => ({ logger: mockLogger }))

const { executeTask } = await import('../../src/utils/scheduler.internal.js')

const makeTask = (handler: Task['handler']): Task => ({
  name: 'test-task',
  handler,
  interval: 1000,
  cron: null,
  options: { ...DEFAULT_TASK_OPTIONS },
  running: true,
  intervalId: null,
  timeoutId: null,
  lastRun: null,
  nextRun: null,
  errorCount: 0,
  retryAttempt: 0,
  retryTimeoutId: null,
})

const makeEmitters = (): { emitters: Emitters; emitError: ReturnType<typeof mock> } => {
  const emitError = mock(() => {})
  const emitters: Emitters = {
    emitTick: () => {},
    emitError,
    emitRetry: () => {},
    emitFatalError: () => {},
  }
  return { emitters, emitError }
}

describe('executeTask', () => {
  test('resolves without rejection when handler throws synchronously', async () => {
    const task = makeTask(() => {
      throw new Error('sync handler error')
    })
    const { emitters, emitError } = makeEmitters()

    await expect(executeTask(task, DEFAULT_OPTIONS, emitters, () => {})).resolves.toBeUndefined()
    expect(emitError).toHaveBeenCalledTimes(1)
  })

  test('resolves without rejection when handler returns a rejected promise', async () => {
    const task = makeTask(() => Promise.reject(new Error('async handler error')))
    const { emitters, emitError } = makeEmitters()

    await expect(executeTask(task, DEFAULT_OPTIONS, emitters, () => {})).resolves.toBeUndefined()
    expect(emitError).toHaveBeenCalledTimes(1)
  })

  test('calls emitTick on success', async () => {
    const emitTick = mock(() => {})
    const task = makeTask(() => {})
    const emitters: Emitters = {
      emitTick,
      emitError: () => {},
      emitRetry: () => {},
      emitFatalError: () => {},
    }

    await executeTask(task, DEFAULT_OPTIONS, emitters, () => {})

    expect(emitTick).toHaveBeenCalledTimes(1)
  })
})
