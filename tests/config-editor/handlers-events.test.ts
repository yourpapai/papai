// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { startEditor, handleEditorCallback, handleEditorMessage } from '../../src/config-editor/handlers.js'
import { deleteEditorSession } from '../../src/config-editor/state.js'
import { setContextSettings } from '../../src/instances/context-store.js'
import { insertTaskInstance } from '../../src/instances/task-store.js'
import {
  registerContributedTaskProviderType,
  unregisterContributedTaskProviderType,
} from '../../src/providers/registry.js'
import { createMockProvider } from '../tools/mock-provider.js'
import { mockLogger, seedCommonTestPlatformInstances, setupTestDb } from '../utils/test-helpers.js'

const KANEO_PLUGIN_ID = 'task-provider-kaneo'
const KANEO_CREDENTIAL_KEY = 'plugin:task-provider-kaneo:provider:credential'

const registerKaneoContributed = (): void => {
  registerContributedTaskProviderType('kaneo', {
    pluginId: KANEO_PLUGIN_ID,
    factory: () => createMockProvider({ name: 'kaneo' }),
    capabilities: new Set(),
    displayName: 'Kaneo',
    instanceConfigSchema: [],
    contextConfigSchema: [
      {
        key: 'credential',
        label: 'Kaneo API Key',
        required: true,
        sensitive: true,
        scope: 'context',
        storageKey: 'kaneo_apikey',
      },
    ],
    traits: new Set(),
  })
}

describe('config_editor events', () => {
  const userId = 'user-1'
  const storageContextId = 'ctx-1'

  const assignKaneoContext = (): void => {
    insertTaskInstance({ id: 'ctx-1-kaneo', type: 'kaneo', config: { url: 'https://kaneo.invalid' }, status: 'active' })
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
    registerKaneoContributed()
  })

  afterEach(() => {
    unregisterContributedTaskProviderType(KANEO_PLUGIN_ID)
  })

  test('startEditor emits config_editor:opened event', async () => {
    assignKaneoContext()
    const { subscribe } = await import('../../src/debug/event-bus.js')
    const events: Array<{ type: string; data: Record<string, unknown> }> = []
    subscribe((event) => {
      events.push({ type: event.type, data: event.data })
    })

    startEditor(userId, storageContextId, KANEO_CREDENTIAL_KEY)

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

    startEditor(userId, storageContextId, KANEO_CREDENTIAL_KEY)
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

    startEditor(userId, storageContextId, KANEO_CREDENTIAL_KEY)
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

    startEditor(userId, storageContextId, KANEO_CREDENTIAL_KEY)
    handleEditorMessage(userId, storageContextId, 'gpt-4o')
    handleEditorCallback(userId, storageContextId, 'save', KANEO_CREDENTIAL_KEY)

    const closedEvent = events.find((e) => e.type === 'config_editor:closed')
    expect(closedEvent).toBeDefined()
    expect(closedEvent?.data['userId']).toBe(userId)
  })
})
