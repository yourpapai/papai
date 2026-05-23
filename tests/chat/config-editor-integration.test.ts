// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Tests for config-editor chat integration
 */

import { beforeEach, describe, expect, test } from 'bun:test'

import { handleConfigEditorMessage } from '../../src/chat/config-editor-integration.js'
import type { ReplyFn } from '../../src/chat/types.js'
import { deleteEditorSession, startEditor } from '../../src/config-editor/index.js'
import { setContextSettings } from '../../src/instances/context-store.js'
import { insertTaskInstance } from '../../src/instances/task-store.js'
import { createMockReply, mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('config-editor chat integration', () => {
  const userId = 'user123'
  const storageContextId = 'ctx456'

  const assignKaneoContext = (): void => {
    insertTaskInstance({ id: 'ctx456-kaneo', type: 'kaneo', config: { url: 'https://kaneo.invalid' }, status: 'active' })
    setContextSettings({ contextId: storageContextId, taskInstanceId: 'ctx456-kaneo', platformInstanceId: 'telegram-default' })
  }

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    deleteEditorSession(userId, storageContextId)
  })

  test('returns false when no active editor', async () => {
    const reply = {
      text: async (): Promise<void> => {},
      formatted: async (): Promise<void> => {},
      file: async (): Promise<void> => {},
      typing: (): void => {},
      buttons: async (): Promise<void> => {},
    }

    const result = await handleConfigEditorMessage(userId, storageContextId, 'some text', reply)
    expect(result).toBe(false)
  })

  test('handles message when editor is active', async () => {
    // Start an editor session
    startEditor(userId, storageContextId, 'timezone')

    let buttonsCalled = false
    const reply = {
      text: async (): Promise<void> => {},
      formatted: async (): Promise<void> => {},
      file: async (): Promise<void> => {},
      typing: (): void => {},
      buttons: (): Promise<void> => {
        buttonsCalled = true
        return Promise.resolve()
      },
    }

    const result = await handleConfigEditorMessage(userId, storageContextId, 'UTC', reply)
    expect(result).toBe(true)
    expect(buttonsCalled).toBe(true)
  })

  test('sets isSensitiveKey flag for sensitive key', async () => {
    assignKaneoContext()
    startEditor(userId, storageContextId, 'kaneo_apikey')
    const { reply, buttonCalls } = createMockReply()

    const result = await handleConfigEditorMessage(userId, storageContextId, 'sk-test-api-key-12345', reply)
    expect(result).toBe(true)
    expect(buttonCalls.length).toBeGreaterThan(0)
    expect(buttonCalls[0]).not.toContain('sk-test-api-key-12345')
  })

  test('calls deleteMessage when available and key is sensitive', async () => {
    assignKaneoContext()
    startEditor(userId, storageContextId, 'kaneo_apikey')
    const deletedIds: string[] = []
    const reply: ReplyFn = {
      text: async (): Promise<void> => {},
      formatted: async (): Promise<void> => {},
      file: async (): Promise<void> => {},
      typing: (): void => {},
      buttons: async (): Promise<void> => {},
      deleteMessage: (messageId: string): Promise<void> => {
        deletedIds.push(messageId)
        return Promise.resolve()
      },
    }

    const result = await handleConfigEditorMessage(userId, storageContextId, 'sk-key', reply, 'msg-123')
    expect(result).toBe(true)
    expect(deletedIds).toEqual(['msg-123'])
  })

  test('appends warning when deleteMessage unavailable and key is sensitive', async () => {
    assignKaneoContext()
    startEditor(userId, storageContextId, 'kaneo_apikey')
    const { reply, buttonCalls } = createMockReply()

    const result = await handleConfigEditorMessage(userId, storageContextId, 'sk-key', reply, 'msg-123')
    expect(result).toBe(true)
    expect(buttonCalls.length).toBeGreaterThan(0)
    expect(buttonCalls[0]).toContain('manually delete')
  })

  test('does not delete or warn for non-sensitive key', async () => {
    startEditor(userId, storageContextId, 'timezone')
    const deletedIds: string[] = []
    const reply: ReplyFn = {
      text: async (): Promise<void> => {},
      formatted: async (): Promise<void> => {},
      file: async (): Promise<void> => {},
      typing: (): void => {},
      buttons: async (): Promise<void> => {},
      deleteMessage: (messageId: string): Promise<void> => {
        deletedIds.push(messageId)
        return Promise.resolve()
      },
    }

    const result = await handleConfigEditorMessage(userId, storageContextId, 'UTC', reply, 'msg-456')
    expect(result).toBe(true)
    expect(deletedIds).toEqual([])
  })
})
