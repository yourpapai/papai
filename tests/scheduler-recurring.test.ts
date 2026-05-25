// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { toScopedContextId } from '../src/chat/scoped-context.js'
import type { ChatProvider } from '../src/chat/types.js'
import type { Task } from '../src/providers/types.js'

const USER_ID = 'user-1'
const createdTask = {
  id: 'task-1',
  title: 'Recurring Test',
  projectId: 'project-1',
  url: 'https://tasks.test/task-1',
} as const satisfies Task

describe('scheduler-recurring notifyUser', () => {
  test('handles refused recurring notifications without throwing', async () => {
    const { setupTestDb } = await import('./utils/test-helpers.js')
    const { setContextSettings } = await import('../src/instances/context-store.js')
    const { notifyUser } = await import('../src/scheduler-recurring.js')
    await setupTestDb()
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
