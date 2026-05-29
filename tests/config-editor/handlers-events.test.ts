// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { startEditor, handleEditorCallback, handleEditorMessage } from '../../src/config-editor/handlers.js'
import { deleteEditorSession } from '../../src/config-editor/state.js'
import { setContextSettings } from '../../src/instances/context-store.js'
import { insertTaskInstance } from '../../src/instances/task-store.js'
import { mockLogger, seedCommonTestPlatformInstances, setupTestDb } from '../utils/test-helpers.js'

describe('config_editor events', () => {
  const userId = 'user-1'
  const storageContextId = 'ctx-1'

  const assignKaneoContext = (): void => {
    insertTaskInstance({
      id: 'ctx-1-kaneo',
      type: 'kaneo',
      config: { baseUrl: 'https://kaneo.invalid' },
      status: 'active',
    })
    setContextSettings({
      contextId: storageContextId,
      taskInstanceId: 'ctx-1-kaneo',
      platformInstanceId: 'telegram-default',
    })
  }

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
    deleteEditorSession(userId, storageContextId)
  })

  test('startEditor emits config_editor:opened event', async () => {
    assignKaneoContext()
    const { subscribe } = await import('../../src/debug/event-bus.js')
    const events: Array<{ type: string; data: Record<string, unknown> }> = []
    subscribe((event) => {
      events.push({ type: event.type, data: event.data })
    })

    startEditor(userId, storageContextId, 'kaneo_apikey')

    const openedEvent = events.find((e) => e.type === 'config_editor:opened')
    expect(openedEvent).toBeDefined()
    expect(openedEvent?.data['userId']).toBe(userId)
  })

  test('handleEditorMessage emits config_editor:step event', async () => {
    assignKaneoContext()
    const { subscribe } = await import('../../src/debug/event-bus.js')
    const events: Array<{ type: string; data: Record<string, unknown> }> = []
    subscribe((event) => {
      events.push({ type: event.type, data: event.data })
    })

    startEditor(userId, storageContextId, 'kaneo_apikey')
    handleEditorMessage(userId, storageContextId, 'gpt-4o')

    const stepEvent = events.find((e) => e.type === 'config_editor:step')
    expect(stepEvent).toBeDefined()
    expect(stepEvent?.data['userId']).toBe(userId)
    expect(stepEvent?.data['step']).toBe('value_entered')
  })

  test('handleEditorCallback cancel emits config_editor:closed event', async () => {
    assignKaneoContext()
    const { subscribe } = await import('../../src/debug/event-bus.js')
    const events: Array<{ type: string; data: Record<string, unknown> }> = []
    subscribe((event) => {
      events.push({ type: event.type, data: event.data })
    })

    startEditor(userId, storageContextId, 'kaneo_apikey')
    handleEditorCallback(userId, storageContextId, 'cancel')

    const closedEvent = events.find((e) => e.type === 'config_editor:closed')
    expect(closedEvent).toBeDefined()
    expect(closedEvent?.data['userId']).toBe(userId)
  })

  test('handleEditorCallback save emits config_editor:closed event', async () => {
    assignKaneoContext()
    const { subscribe } = await import('../../src/debug/event-bus.js')
    const events: Array<{ type: string; data: Record<string, unknown> }> = []
    subscribe((event) => {
      events.push({ type: event.type, data: event.data })
    })

    startEditor(userId, storageContextId, 'kaneo_apikey')
    handleEditorMessage(userId, storageContextId, 'gpt-4o')
    handleEditorCallback(userId, storageContextId, 'save', 'kaneo_apikey')

    const closedEvent = events.find((e) => e.type === 'config_editor:closed')
    expect(closedEvent).toBeDefined()
    expect(closedEvent?.data['userId']).toBe(userId)
  })
})
