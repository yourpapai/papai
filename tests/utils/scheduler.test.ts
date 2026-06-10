// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Tests for the core scheduler implementation.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import {
  FatalError,
  RetryableError,
  TaskAlreadyExistsError,
  TaskNotFoundError,
} from '../../src/utils/scheduler.errors.js'
import type { ErrorEvent, FatalErrorEvent, RetryEvent, TickEvent } from '../../src/utils/scheduler.types.js'
import { waitFor } from '../utils/test-helpers.js'

// Simple mock logger type that matches what we need
interface MockLogger {
  debug: () => void
  info: () => void
  warn: () => void
  error: () => void
  child: () => MockLogger
}

// Create mutable logger implementation for mocking
let loggerImpl: MockLogger = {
  debug: (): void => {},
  info: (): void => {},
  warn: (): void => {},
  error: (): void => {},
  child: (): MockLogger => loggerImpl,
}

// Import after mocking
const { createScheduler } = await import('../../src/utils/scheduler.js')

describe('createScheduler', () => {
  beforeEach(() => {
    loggerImpl = {
      debug: (): void => {},
      info: (): void => {},
      warn: (): void => {},
      error: (): void => {},
      child: (): MockLogger => loggerImpl,
    }

    // Mock logger before importing scheduler
    void mock.module('../../src/logger.js', () => ({
      logger: loggerImpl,
    }))
  })

  describe('registration', () => {
    test('should register a task', () => {
      const scheduler = createScheduler()

      scheduler.register('test-task', {
        handler: (): void => {},
        interval: 1000,
      })

      expect(scheduler.hasTask('test-task')).toBe(true)
    })

    test('should throw on duplicate registration', () => {
      const scheduler = createScheduler()

      scheduler.register('test-task', {
        handler: (): void => {},
        interval: 1000,
      })

      expect(() => {
        scheduler.register('test-task', {
          handler: (): void => {},
          interval: 1000,
        })
      }).toThrow(TaskAlreadyExistsError)
    })

    test('should accept custom options', () => {
      const scheduler = createScheduler({
        defaultRetries: 5,
        unrefByDefault: false,
        maxRetryDelay: 120000,
      })

      scheduler.register('test-task', {
        handler: (): void => {},
        interval: 1000,
      })

      expect(scheduler.hasTask('test-task')).toBe(true)
    })
  })

  describe('task state', () => {
    test('should return null for non-existent task', () => {
      const scheduler = createScheduler()

      expect(scheduler.getTaskState('non-existent')).toBe(null)
    })

    test('should return correct initial state', () => {
      const scheduler = createScheduler()

      scheduler.register('test-task', {
        handler: (): void => {},
        interval: 1000,
      })

      const state = scheduler.getTaskState('test-task')

      expect(state).not.toBe(null)
      expect(state!.running).toBe(false)
      expect(state!.lastRun).toBe(null)
      expect(state!.nextRun).toBe(null)
      expect(state!.errorCount).toBe(0)
      expect(state!.retryAttempt).toBe(0)
    })

    test('should return correct state after starting', () => {
      const scheduler = createScheduler()

      scheduler.register('test-task', {
        handler: (): void => {},
        interval: 1000,
      })

      scheduler.start('test-task')
      const state = scheduler.getTaskState('test-task')

      expect(state!.running).toBe(true)
      expect(state!.nextRun).not.toBe(null)

      scheduler.stop('test-task')
    })
  })

  describe('hasTask', () => {
    test('should return true for registered task', () => {
      const scheduler = createScheduler()

      scheduler.register('test-task', {
        handler: (): void => {},
        interval: 1000,
      })

      expect(scheduler.hasTask('test-task')).toBe(true)
    })

    test('should return false for unregistered task', () => {
      const scheduler = createScheduler()

      expect(scheduler.hasTask('non-existent')).toBe(false)
    })
  })

  describe('start and stop', () => {
    test('should start a registered task', async () => {
      const scheduler = createScheduler()
      let executed = false

      scheduler.register('test-task', {
        handler: (): void => {
          executed = true
        },
        interval: 25,
      })

      scheduler.start('test-task')

      await waitFor(() => executed)

      expect(executed).toBe(true)
      scheduler.stop('test-task')
    })

    test('should stop a running task', () => {
      const scheduler = createScheduler()

      scheduler.register('test-task', {
        handler: (): void => {},
        interval: 1000,
      })

      scheduler.start('test-task')
      scheduler.stop('test-task')

      const state = scheduler.getTaskState('test-task')
      expect(state!.running).toBe(false)
      expect(state!.nextRun).toBe(null)
    })

    test('should start all tasks', async () => {
      const scheduler = createScheduler()
      let task1Executed = false
      let task2Executed = false

      scheduler.register('task-1', {
        handler: (): void => {
          task1Executed = true
        },
        interval: 25,
      })

      scheduler.register('task-2', {
        handler: (): void => {
          task2Executed = true
        },
        interval: 25,
      })

      scheduler.startAll()

      await waitFor(() => task1Executed)
      await waitFor(() => task2Executed)

      expect(task1Executed).toBe(true)
      expect(task2Executed).toBe(true)

      scheduler.stopAll()
    })

    test('should stop all tasks', () => {
      const scheduler = createScheduler()

      scheduler.register('task-1', {
        handler: (): void => {},
        interval: 1000,
      })

      scheduler.register('task-2', {
        handler: (): void => {},
        interval: 1000,
      })

      scheduler.startAll()
      scheduler.stopAll()

      expect(scheduler.getTaskState('task-1')!.running).toBe(false)
      expect(scheduler.getTaskState('task-2')!.running).toBe(false)
    })
  })

  describe('events', () => {
    test('should emit tick event on successful execution', async () => {
      const scheduler = createScheduler()
      const tickEvents: TickEvent[] = []

      scheduler.on('tick', (event: TickEvent) => {
        tickEvents.push(event)
      })

      scheduler.register('test-task', {
        handler: (): void => {},
        interval: 25,
      })

      scheduler.start('test-task')

      await waitFor(() => tickEvents.length > 0)

      expect(tickEvents.length).toBeGreaterThan(0)
      expect(tickEvents[0]!.name).toBe('test-task')
      expect(tickEvents[0]!.duration).toBeGreaterThanOrEqual(0)

      scheduler.stop('test-task')
    })

    test('should emit error event on task failure', async () => {
      const scheduler = createScheduler()
      const errorEvents: ErrorEvent[] = []

      scheduler.on('error', (event: ErrorEvent) => {
        errorEvents.push(event)
      })

      scheduler.register('test-task', {
        handler: (): void => {
          throw new Error('Test error')
        },
        interval: 25,
        options: { retries: 0 },
      })

      scheduler.start('test-task')

      await waitFor(() => errorEvents.length > 0)

      expect(errorEvents.length).toBeGreaterThan(0)
      expect(errorEvents[0]!.name).toBe('test-task')
      expect(errorEvents[0]!.error.message).toBe('Test error')

      scheduler.stop('test-task')
    })

    test('should emit retry event when retrying', async () => {
      const scheduler = createScheduler()
      const retryEvents: RetryEvent[] = []

      scheduler.on('retry', (event: RetryEvent) => {
        retryEvents.push(event)
      })

      scheduler.register('test-task', {
        handler: (): void => {
          throw new RetryableError('Retryable error')
        },
        interval: 1000,
        // The retry event is emitted synchronously when the retry is
        // scheduled, so immediate execution is enough to observe it.
        options: { retries: 1, immediate: true },
      })

      scheduler.start('test-task')

      await waitFor(() => retryEvents.length > 0)

      expect(retryEvents.length).toBeGreaterThan(0)
      expect(retryEvents[0]!.name).toBe('test-task')
      expect(retryEvents[0]!.attempt).toBe(1)
      expect(retryEvents[0]!.delay).toBeGreaterThan(0)

      scheduler.stop('test-task')
    })

    test('should emit fatalError event on max retries exceeded', async () => {
      const scheduler = createScheduler()
      const fatalErrorEvents: FatalErrorEvent[] = []

      scheduler.on('fatalError', (event: FatalErrorEvent) => {
        fatalErrorEvents.push(event)
      })

      scheduler.register('test-task', {
        handler: (): void => {
          throw new Error('Persistent error')
        },
        interval: 50,
        options: { retries: 0, immediate: true },
      })

      scheduler.start('test-task')

      await waitFor(() => fatalErrorEvents.length > 0)

      expect(fatalErrorEvents.length).toBeGreaterThan(0)
      expect(fatalErrorEvents[0]!.name).toBe('test-task')

      scheduler.stop('test-task')
    })

    test('should emit fatalError event on FatalError', async () => {
      const scheduler = createScheduler()
      const fatalErrorEvents: FatalErrorEvent[] = []

      scheduler.on('fatalError', (event: FatalErrorEvent) => {
        fatalErrorEvents.push(event)
      })

      scheduler.register('test-task', {
        handler: (): void => {
          throw new FatalError('Fatal error')
        },
        interval: 50,
        options: { retries: 3, immediate: true },
      })

      scheduler.start('test-task')

      await waitFor(() => fatalErrorEvents.length > 0)

      expect(fatalErrorEvents.length).toBeGreaterThan(0)
      expect(fatalErrorEvents[0]!.name).toBe('test-task')
      expect(fatalErrorEvents[0]!.error.message).toBe('Fatal error')

      scheduler.stop('test-task')
    })
  })

  const throwOnFirstAttempt = (attempts: number): void => {
    if (attempts < 2) throw new RetryableError('Temporary failure')
  }

  describe('retry logic', () => {
    test('should retry on RetryableError', async () => {
      // Cap backoff so the retry fires within milliseconds instead of the
      // default ~2s first-retry delay. The long interval keeps the second
      // attempt attributable to the retry path, not the next interval tick.
      const scheduler = createScheduler({ maxRetryDelay: 25 })
      let attempts = 0

      scheduler.register('test-task', {
        handler: (): void => {
          attempts++
          throwOnFirstAttempt(attempts)
        },
        interval: 1000,
        options: { retries: 3, immediate: true },
      })

      scheduler.start('test-task')

      await waitFor(() => attempts >= 2)

      // Should have retried and succeeded on second attempt
      expect(attempts).toBeGreaterThanOrEqual(2)

      scheduler.stop('test-task')
    })

    test('should stop after max retries exceeded', async () => {
      const scheduler = createScheduler({ maxRetryDelay: 100 })
      let attempts = 0

      scheduler.register('test-task', {
        handler: (): void => {
          attempts++
          throw new Error('Always fails')
        },
        interval: 50,
        options: { retries: 2, immediate: true },
      })

      scheduler.start('test-task')

      // With maxRetryDelay: 100 the backoff is capped, so the task exhausts
      // its retries and stops itself within a few hundred ms at most.
      await waitFor(() => !scheduler.getTaskState('test-task')!.running)

      // Should have stopped after max retries
      const state = scheduler.getTaskState('test-task')
      expect(state!.running).toBe(false)

      // Should have attempted: initial + 2 retries = 3
      expect(attempts).toBeGreaterThanOrEqual(3)
    })
  })

  describe('immediate execution', () => {
    test('should execute immediately when immediate option is true', async () => {
      const scheduler = createScheduler()
      let executed = false

      scheduler.register('test-task', {
        handler: (): void => {
          executed = true
        },
        interval: 10000,
        options: { immediate: true },
      })

      await waitFor(() => executed)

      expect(executed).toBe(true)

      scheduler.stop('test-task')
    })
  })

  describe('default options', () => {
    test('should use default options when not specified', () => {
      const scheduler = createScheduler()

      scheduler.register('test-task', {
        handler: (): void => {},
        interval: 1000,
      })

      // Should not throw, uses defaults
      expect(scheduler.hasTask('test-task')).toBe(true)
    })

    test('should respect custom scheduler options', () => {
      const scheduler = createScheduler({
        defaultRetries: 5,
        maxRetryDelay: 120000,
        unrefByDefault: false,
      })

      scheduler.register('test-task', {
        handler: (): void => {
          throw new Error('Always fails')
        },
        interval: 1000,
      })

      scheduler.start('test-task')

      // Task should use default retries from scheduler options
      expect(scheduler.hasTask('test-task')).toBe(true)

      scheduler.stop('test-task')
    })
  })

  describe('unregister', () => {
    test('should unregister a task', () => {
      const scheduler = createScheduler()

      scheduler.register('test-task', {
        handler: (): void => {},
        interval: 1000,
      })

      expect(scheduler.hasTask('test-task')).toBe(true)

      scheduler.unregister('test-task')

      expect(scheduler.hasTask('test-task')).toBe(false)
    })

    test('should stop running task before unregistering', () => {
      const scheduler = createScheduler()

      scheduler.register('test-task', {
        handler: (): void => {},
        interval: 1000,
      })

      scheduler.start('test-task')
      scheduler.unregister('test-task')

      expect(scheduler.hasTask('test-task')).toBe(false)
    })

    test('should throw TaskNotFoundError for non-existent task', () => {
      const scheduler = createScheduler()

      expect(() => {
        scheduler.unregister('non-existent')
      }).toThrow(TaskNotFoundError)
    })

    test('should allow re-registration after unregister', () => {
      const scheduler = createScheduler()

      scheduler.register('test-task', {
        handler: (): void => {},
        interval: 1000,
      })

      scheduler.unregister('test-task')

      // Should not throw
      scheduler.register('test-task', {
        handler: (): void => {},
        interval: 2000,
      })

      expect(scheduler.hasTask('test-task')).toBe(true)
    })
  })

  describe('cron expression support', () => {
    test('should register task with cron expression', () => {
      const scheduler = createScheduler()

      scheduler.register('cron-task', {
        handler: (): void => {},
        cron: '*/5 * * * *',
      })

      expect(scheduler.hasTask('cron-task')).toBe(true)
    })

    test('should throw when both interval and cron provided', () => {
      const scheduler = createScheduler()

      expect(() => {
        scheduler.register('invalid-task', {
          handler: (): void => {},
          interval: 1000,
          cron: '*/5 * * * *',
        })
      }).toThrow('Task cannot have both interval and cron')
    })

    test('should throw when neither interval nor cron provided', () => {
      const scheduler = createScheduler()

      expect(() => {
        scheduler.register('invalid-task', {
          handler: (): void => {},
        })
      }).toThrow('Task must have either interval or cron')
    })

    test('should throw on invalid cron expression when starting', () => {
      const scheduler = createScheduler()

      scheduler.register('invalid-cron-task', {
        handler: (): void => {},
        cron: 'invalid-cron',
      })

      expect(() => {
        scheduler.start('invalid-cron-task')
      }).toThrow('Invalid cron expression')
    })

    test('should start cron task and calculate next run', () => {
      const scheduler = createScheduler()

      scheduler.register('cron-task', {
        handler: (): void => {},
        cron: '@hourly',
      })

      scheduler.start('cron-task')
      const state = scheduler.getTaskState('cron-task')

      expect(state!.running).toBe(true)
      expect(state!.nextRun).not.toBe(null)
      // Next run should be in the future (within next hour)
      expect(state!.nextRun!.getTime()).toBeGreaterThan(Date.now())
      // +5s tolerance for test
      expect(state!.nextRun!.getTime()).toBeLessThan(Date.now() + 3600 * 1000 + 5000)

      scheduler.stop('cron-task')
    })

    test('should clear nextRun when stopping cron task', () => {
      const scheduler = createScheduler()

      scheduler.register('cron-task', {
        handler: (): void => {},
        cron: '@daily',
      })

      scheduler.start('cron-task')
      expect(scheduler.getTaskState('cron-task')!.nextRun).not.toBe(null)

      scheduler.stop('cron-task')
      expect(scheduler.getTaskState('cron-task')!.nextRun).toBe(null)
    })

    test('cron task should support immediate execution', async () => {
      const scheduler = createScheduler()
      let executed = false

      scheduler.register('cron-task', {
        handler: (): void => {
          executed = true
        },
        // Very long interval (once per year)
        cron: '@yearly',
        options: { immediate: true },
      })

      scheduler.start('cron-task')

      await waitFor(() => executed)

      expect(executed).toBe(true)
      scheduler.stop('cron-task')
    })
  })
})
