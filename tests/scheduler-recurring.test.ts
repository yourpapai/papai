// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, spyOn, test } from 'bun:test'

import { toScopedContextId } from '../src/chat/scoped-context.js'
import type { ChatProvider } from '../src/chat/types.js'
import { logger, logMultistream } from '../src/logger.js'
import * as proactiveHistoryModule from '../src/proactive-history.js'
import type { Task } from '../src/providers/types.js'
import { createMockProvider } from './tools/mock-provider.js'
import { mockLogger } from './utils/test-helpers.js'

const USER_ID = 'user-1'
const createdTask = {
  id: 'task-1',
  title: 'Recurring Test',
  projectId: 'project-1',
  url: 'https://tasks.test/task-1',
} as const satisfies Task

describe('scheduler-recurring notifyUser', () => {
  test('handles refused recurring notifications without throwing', async () => {
    const { seedCommonTestPlatformInstances, seedTestTaskInstance, setupTestDb } =
      await import('./utils/test-helpers.js')
    const { setContextSettings } = await import('../src/instances/context-store.js')
    const { notifyUser } = await import('../src/scheduler-recurring.js')
    await setupTestDb()
    seedCommonTestPlatformInstances()
    seedTestTaskInstance({ id: 'kaneo-default' })
    setContextSettings({ contextId: USER_ID, taskInstanceId: 'kaneo-default', platformInstanceId: 'telegram-default' })
    const sentTo: string[] = []
    const chat = {
      name: 'mock',
      threadCapabilities: { supportsThreads: false, canCreateThreads: false, threadScope: 'message' },
      capabilities: new Set(),
      traits: { observedGroupMessages: 'all' },
      configRequirements: [],
      registerCommand: () => {},
      onMessage: () => {},
      sendMessage: (platformInstanceId, _target, _text): Promise<false> => {
        sentTo.push(platformInstanceId)
        return Promise.resolve(false)
      },
      renderContext: () => ({ method: 'text', content: '' }),
      start: () => Promise.resolve(),
      stop: () => Promise.resolve(),
    } as const satisfies ChatProvider

    await notifyUser(chat, USER_ID, createdTask)

    expect(sentTo).toEqual(['telegram-default'])
  })

  test('sends scoped recurring notifications to native DM target', async () => {
    const { notifyUser } = await import('../src/scheduler-recurring.js')
    const sentTargets: Array<{ platformInstanceId: string; contextId: string }> = []
    const chat = {
      name: 'mock',
      threadCapabilities: { supportsThreads: false, canCreateThreads: false, threadScope: 'message' },
      capabilities: new Set(),
      traits: { observedGroupMessages: 'all' },
      configRequirements: [],
      registerCommand: () => {},
      onMessage: () => {},
      sendMessage: (platformInstanceId, target, _text): Promise<void> => {
        sentTargets.push({ platformInstanceId, contextId: target.contextId })
        return Promise.resolve()
      },
      renderContext: () => ({ method: 'text', content: '' }),
      start: () => Promise.resolve(),
      stop: () => Promise.resolve(),
    } as const satisfies ChatProvider

    await notifyUser(
      chat,
      toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: USER_ID }),
      createdTask,
    )

    expect(sentTargets).toEqual([{ platformInstanceId: 'telegram-default', contextId: USER_ID }])
  })
})

describe('scheduler-recurring notifyUser — proactive history recording', () => {
  const spies: Array<{ mockRestore: () => void }> = []

  const track = <T extends { mockRestore: () => void }>(spy: T): T => {
    spies.push(spy)
    return spy
  }

  afterEach(() => {
    for (const spy of spies) spy.mockRestore()
    spies.length = 0
  })

  test('records the recurring-task notification in history once delivery is confirmed', async () => {
    mockLogger()
    const { notifyUser } = await import('../src/scheduler-recurring.js')
    const scopedUserId = toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: USER_ID })
    const weeklyReportTask = { ...createdTask, title: 'Weekly report' } as const satisfies Task
    const chat = {
      name: 'mock',
      threadCapabilities: { supportsThreads: false, canCreateThreads: false, threadScope: 'message' },
      capabilities: new Set(),
      traits: { observedGroupMessages: 'all' },
      configRequirements: [],
      registerCommand: () => {},
      onMessage: () => {},
      sendMessage: (_platformInstanceId, _target, _text): Promise<true> => Promise.resolve(true),
      renderContext: () => ({ method: 'text', content: '' }),
      start: () => Promise.resolve(),
      stop: () => Promise.resolve(),
    } as const satisfies ChatProvider
    const recordCalls: Array<[string, string]> = []
    track(
      spyOn(proactiveHistoryModule, 'recordProactiveInHistory').mockImplementation((storageContextId, markdown) => {
        recordCalls.push([storageContextId, markdown])
      }),
    )

    await notifyUser(chat, scopedUserId, weeklyReportTask)

    expect(recordCalls).toHaveLength(1)
    expect(recordCalls[0]).toEqual([scopedUserId, 'Recurring task created: **Weekly report** in project.'])
  })

  test('does not record history when the recurring-task notification is refused', async () => {
    mockLogger()
    const { notifyUser } = await import('../src/scheduler-recurring.js')
    const scopedUserId = toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: USER_ID })
    const weeklyReportTask = { ...createdTask, title: 'Weekly report' } as const satisfies Task
    const chat = {
      name: 'mock',
      threadCapabilities: { supportsThreads: false, canCreateThreads: false, threadScope: 'message' },
      capabilities: new Set(),
      traits: { observedGroupMessages: 'all' },
      configRequirements: [],
      registerCommand: () => {},
      onMessage: () => {},
      sendMessage: (_platformInstanceId, _target, _text): Promise<false> => Promise.resolve(false),
      renderContext: () => ({ method: 'text', content: '' }),
      start: () => Promise.resolve(),
      stop: () => Promise.resolve(),
    } as const satisfies ChatProvider
    const recordCalls: Array<[string, string]> = []
    track(
      spyOn(proactiveHistoryModule, 'recordProactiveInHistory').mockImplementation((storageContextId, markdown) => {
        recordCalls.push([storageContextId, markdown])
      }),
    )

    await notifyUser(chat, scopedUserId, weeklyReportTask)

    expect(recordCalls).toHaveLength(0)
  })
})

describe('finalizeCreatedRecurringTask log attribution', () => {
  // No mockLogger here: the module-bound child logger is the real pino instance,
  // so attribution is asserted against actual egress (see tests/reply-context.test.ts).
  test('recurring-instance-created info entry carries chatUserId so the owner keeps their titles', async () => {
    const { setupTestDb } = await import('./utils/test-helpers.js')
    const { createRecurringTask } = await import('../src/recurring.js')
    const { finalizeCreatedRecurringTask } = await import('../src/scheduler-recurring.js')
    await setupTestDb()
    const task = createRecurringTask({
      userId: USER_ID,
      projectId: 'project-1',
      title: 'Weekly report',
      triggerType: 'on_complete',
    })

    const logLines: string[] = []
    logMultistream.add({ level: 'info', stream: { write: (chunk: string): void => void logLines.push(chunk) } })
    logger.level = 'info'
    try {
      await finalizeCreatedRecurringTask(task, createMockProvider(), createdTask, null)
    } finally {
      logger.level = 'silent'
    }

    const entry = logLines.find((line) => line.includes('"msg":"Recurring task instance created"'))
    expect(entry, 'expected a recurring-instance-created log entry').toBeDefined()
    expect(entry).toContain('"chatUserId":"user-1"')
    expect(entry).toContain('"title":"Weekly report"')
  })
})
