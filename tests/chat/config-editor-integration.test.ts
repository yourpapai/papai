// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Tests for config-editor chat integration
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { handleConfigEditorMessage } from '../../src/chat/config-editor-integration.js'
import type { ReplyFn } from '../../src/chat/types.js'
import { deleteEditorSession, startEditor } from '../../src/config-editor/index.js'
import { setContextSettings } from '../../src/instances/context-store.js'
import { insertTaskInstance } from '../../src/instances/task-store.js'
import {
  registerContributedTaskProviderType,
  unregisterContributedTaskProviderType,
} from '../../src/providers/registry.js'
import { createMockProvider } from '../tools/mock-provider.js'
import { createMockReply, mockLogger, seedCommonTestPlatformInstances, setupTestDb } from '../utils/test-helpers.js'

const KANEO_PLUGIN_ID = 'task-provider-kaneo'
// Plugin-namespaced credential key for contributed kaneo
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

describe('config-editor chat integration', () => {
  const userId = 'user123'
  const storageContextId = 'ctx456'

  const assignKaneoContext = (): void => {
    insertTaskInstance({
      id: 'ctx456-kaneo',
      type: 'kaneo',
      config: { url: 'https://kaneo.invalid' },
      status: 'active',
    })
    setContextSettings({
      contextId: storageContextId,
      taskInstanceId: 'ctx456-kaneo',
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
    // kaneo is plugin-contributed; the credential field uses the plugin-namespaced storage key
    assignKaneoContext()
    startEditor(userId, storageContextId, KANEO_CREDENTIAL_KEY)
    const { reply, buttonCalls } = createMockReply()

    const result = await handleConfigEditorMessage(userId, storageContextId, 'sk-test-api-key-12345', reply)
    expect(result).toBe(true)
    expect(buttonCalls.length).toBeGreaterThan(0)
    expect(buttonCalls[0]).not.toContain('sk-test-api-key-12345')
  })

  test('calls deleteMessage when available and key is sensitive', async () => {
    // kaneo is plugin-contributed; the credential field uses the plugin-namespaced storage key
    assignKaneoContext()
    startEditor(userId, storageContextId, KANEO_CREDENTIAL_KEY)
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
    // kaneo is plugin-contributed; the credential field uses the plugin-namespaced storage key
    assignKaneoContext()
    startEditor(userId, storageContextId, KANEO_CREDENTIAL_KEY)
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
