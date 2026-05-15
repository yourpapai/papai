import { beforeEach, describe, expect, test } from 'bun:test'

import { startEditor, handleEditorCallback, handleEditorMessage } from '../../src/config-editor/handlers.js'
import { deleteEditorSession } from '../../src/config-editor/state.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('config_editor events', () => {
  const userId = 'user-1'
  const storageContextId = 'ctx-1'

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    deleteEditorSession(userId, storageContextId)
  })

  test('startEditor emits config_editor:opened event', async () => {
    const { subscribe } = await import('../../src/debug/event-bus.js')
    const events: Array<{ type: string; data: Record<string, unknown> }> = []
    subscribe((event) => {
      events.push({ type: event.type, data: event.data })
    })

    startEditor(userId, storageContextId, 'main_model')

    const openedEvent = events.find((e) => e.type === 'config_editor:opened')
    expect(openedEvent).toBeDefined()
    expect(openedEvent?.data['userId']).toBe(userId)
  })

  test('handleEditorMessage emits config_editor:step event', async () => {
    const { subscribe } = await import('../../src/debug/event-bus.js')
    const events: Array<{ type: string; data: Record<string, unknown> }> = []
    subscribe((event) => {
      events.push({ type: event.type, data: event.data })
    })

    startEditor(userId, storageContextId, 'main_model')
    handleEditorMessage(userId, storageContextId, 'gpt-4o')

    const stepEvent = events.find((e) => e.type === 'config_editor:step')
    expect(stepEvent).toBeDefined()
    expect(stepEvent?.data['userId']).toBe(userId)
    expect(stepEvent?.data['step']).toBe('value_entered')
  })

  test('handleEditorCallback cancel emits config_editor:closed event', async () => {
    const { subscribe } = await import('../../src/debug/event-bus.js')
    const events: Array<{ type: string; data: Record<string, unknown> }> = []
    subscribe((event) => {
      events.push({ type: event.type, data: event.data })
    })

    startEditor(userId, storageContextId, 'main_model')
    handleEditorCallback(userId, storageContextId, 'cancel')

    const closedEvent = events.find((e) => e.type === 'config_editor:closed')
    expect(closedEvent).toBeDefined()
    expect(closedEvent?.data['userId']).toBe(userId)
  })

  test('handleEditorCallback save emits config_editor:closed event', async () => {
    const { subscribe } = await import('../../src/debug/event-bus.js')
    const events: Array<{ type: string; data: Record<string, unknown> }> = []
    subscribe((event) => {
      events.push({ type: event.type, data: event.data })
    })

    startEditor(userId, storageContextId, 'main_model')
    handleEditorMessage(userId, storageContextId, 'gpt-4o')
    handleEditorCallback(userId, storageContextId, 'save', 'main_model')

    const closedEvent = events.find((e) => e.type === 'config_editor:closed')
    expect(closedEvent).toBeDefined()
    expect(closedEvent?.data['userId']).toBe(userId)
  })
})
