// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type { ChatProvider } from '../../src/chat/types.js'
import { createPollerLifecycle } from '../../src/deferred-prompts/poller-lifecycle.js'
import type { BuildProviderFn } from '../../src/deferred-prompts/proactive-llm.js'
import { createScheduler, type Scheduler } from '../../src/utils/scheduler.js'
import { createMockChat, mockLogger, setupTestDb, waitFor } from '../utils/test-helpers.js'

describe('createPollerLifecycle', () => {
  let scheduler: Scheduler
  let lifecycle: ReturnType<typeof createPollerLifecycle>
  let chat: ChatProvider

  const buildProvider: BuildProviderFn = () => {
    throw new Error('BuildProviderFn should not be invoked when no due work is seeded')
  }

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    scheduler = createScheduler({ unrefByDefault: true })
    chat = createMockChat()
    lifecycle = createPollerLifecycle(scheduler)
  })

  afterEach(async () => {
    lifecycle.stopPollers()
    await scheduler.drainAll()
  })

  test('registers once and removes both pollers when stopped', async () => {
    lifecycle.startPollers(chat, buildProvider)
    lifecycle.startPollers(chat, buildProvider)
    await waitFor(() => scheduler.getTaskState('deferred-scheduled-poll')?.running === true)
    expect(scheduler.hasTask('deferred-alert-poll')).toBe(true)

    lifecycle.stopPollers()
    await scheduler.drainAll()
    expect(scheduler.hasTask('deferred-scheduled-poll')).toBe(false)
    expect(scheduler.hasTask('deferred-alert-poll')).toBe(false)
  })

  test('snapshot reflects factory-local running state', () => {
    expect(lifecycle.getPollerSnapshot().scheduledRunning).toBe(false)
    expect(lifecycle.getPollerSnapshot().alertsRunning).toBe(false)

    lifecycle.startPollers(chat, buildProvider)

    expect(lifecycle.getPollerSnapshot().scheduledRunning).toBe(true)
    expect(lifecycle.getPollerSnapshot().alertsRunning).toBe(true)

    lifecycle.stopPollers()

    expect(lifecycle.getPollerSnapshot().scheduledRunning).toBe(false)
    expect(lifecycle.getPollerSnapshot().alertsRunning).toBe(false)
  })
})
