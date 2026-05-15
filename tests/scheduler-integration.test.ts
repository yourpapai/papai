// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Integration tests for the central scheduler instance.
 * Verifies that cleanup tasks are registered and work correctly.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { scheduler } from '../src/scheduler-instance.js'

describe('Scheduler Integration', () => {
  beforeEach(() => {
    // Stop all tasks before each test
    scheduler.stopAll()
  })

  afterEach(() => {
    scheduler.stopAll()
  })

  afterAll(() => {
    // Ensure cleanup
    scheduler.stopAll()
  })

  test('should have cleanup tasks registered', () => {
    expect(scheduler.hasTask('user-cache-cleanup')).toBe(true)
    expect(scheduler.hasTask('message-cache-sweep')).toBe(true)
    expect(scheduler.hasTask('message-cleanup')).toBe(true)
    expect(scheduler.hasTask('staged-files-purge')).toBe(true)
  })

  test('should start and stop cleanup tasks', () => {
    scheduler.startAll()

    expect(scheduler.getTaskState('user-cache-cleanup')?.running).toBe(true)
    expect(scheduler.getTaskState('message-cache-sweep')?.running).toBe(true)
    expect(scheduler.getTaskState('message-cleanup')?.running).toBe(true)

    scheduler.stopAll()

    expect(scheduler.getTaskState('user-cache-cleanup')?.running).toBe(false)
    expect(scheduler.getTaskState('message-cache-sweep')?.running).toBe(false)
    expect(scheduler.getTaskState('message-cleanup')?.running).toBe(false)
  })

  test('should handle task errors gracefully', async () => {
    let errorCaught = false

    scheduler.on('error', () => {
      errorCaught = true
    })

    scheduler.register('test-error-task', {
      interval: 100,
      handler: () => {
        throw new Error('Test error')
      },
    })

    scheduler.start('test-error-task')

    // Wait for error
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 200)
    })

    expect(errorCaught).toBe(true)

    scheduler.stop('test-error-task')
    scheduler.unregister('test-error-task')
  })
})
