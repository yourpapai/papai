// tests/operational/scenarios/deferred-poller-lifecycle.operational.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import type { ChatProvider } from '../../../src/chat/types.js'
import { createPollerLifecycle } from '../../../src/deferred-prompts/poller-lifecycle.js'
import type { BuildProviderFn } from '../../../src/deferred-prompts/proactive-llm.js'
import { createScheduler } from '../../../src/utils/scheduler.js'
import { createMockChat, mockLogger, setupTestDb, waitFor } from '../../utils/test-helpers.js'
import { OPERATIONAL_STORIES } from './catalog.js'

const title = (scenarioId: keyof typeof OPERATIONAL_STORIES): string => OPERATIONAL_STORIES[scenarioId].title

const buildProvider: BuildProviderFn = () => {
  throw new Error('BuildProviderFn should not be invoked when no due work is seeded')
}

describe('T4 operational — deferred poller lifecycle', () => {
  let chat: ChatProvider

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    chat = createMockChat()
  })

  test(title('SCN-deferred-poller-lifecycle'), async () => {
    const scheduler = createScheduler({ unrefByDefault: true })
    const lifecycle = createPollerLifecycle(scheduler)
    try {
      lifecycle.startPollers(chat, buildProvider)
      await waitFor(() => scheduler.getTaskState('deferred-scheduled-poll')?.lastRun !== null)
      expect(scheduler.getTaskState('deferred-alert-poll')?.running).toBe(true)

      lifecycle.stopPollers()
      await scheduler.drainAll()
      expect(scheduler.hasTask('deferred-scheduled-poll')).toBe(false)
      expect(scheduler.hasTask('deferred-alert-poll')).toBe(false)
    } finally {
      lifecycle.stopPollers()
      await scheduler.drainAll()
    }
  })
})
