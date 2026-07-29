// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, expect, test } from 'bun:test'

import { toScopedContextId } from '../src/chat/scoped-context.js'
import type { DeferredDeliveryTarget } from '../src/chat/types.js'
import * as schema from '../src/db/schema.js'
import { tick } from '../src/scheduler.js'
import { createMockProvider } from './tools/mock-provider.js'
import { createMockChat, getTestDb, mockLogger, setupTestDb } from './utils/test-helpers.js'

beforeEach(async () => {
  mockLogger()
  await setupTestDb()
})

test('tick delivers the recurring notification to the injected chat provider', async () => {
  const userId = toScopedContextId({
    platformInstanceId: 'pi-1',
    nativeContextId: 'alice',
  })
  getTestDb()
    .insert(schema.recurringTasks)
    .values({
      id: 'rec-1',
      userId,
      projectId: 'project-1',
      title: 'Water the plants',
      triggerType: 'cron',
      rrule: 'FREQ=DAILY',
      dtstartUtc: '2020-01-01T09:00:00.000Z',
      enabled: '1',
      nextRun: '2020-01-01T09:00:00.000Z',
    })
    .run()

  const sends: Array<{
    platformInstanceId: string
    target: DeferredDeliveryTarget
    markdown: string
  }> = []
  const chat = createMockChat({
    sendMessage: (platformInstanceId, target, markdown) => {
      sends.push({ platformInstanceId, target, markdown })
      return Promise.resolve(true)
    },
  })

  const provider = createMockProvider({
    createTask: (input) => Promise.resolve({ id: 'task-1', title: input.title, url: '' }),
  })
  await tick({ resolve: () => provider, chat })

  expect(sends).toHaveLength(1)
  expect(sends[0]?.markdown).toContain('Water the plants')
})
