// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Tests for wizard-integration module
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type { ReplyFn } from '../src/chat/types.js'
import {
  registerContributedTaskProviderType,
  unregisterContributedTaskProviderType,
} from '../src/providers/registry.js'
import { handleWizardMessage } from '../src/wizard-integration.js'
import { createWizard } from '../src/wizard/engine.js'
import { deleteWizardSession } from '../src/wizard/state.js'
import { createMockProvider } from './tools/mock-provider.js'
import { createMockReply, mockLogger, setupTestDb } from './utils/test-helpers.js'

const KANEO_PLUGIN_ID = 'task-provider-kaneo'

const registerKaneoContributed = (): void => {
  registerContributedTaskProviderType('kaneo', {
    pluginId: KANEO_PLUGIN_ID,
    factory: () => createMockProvider({ name: 'kaneo' }),
    capabilities: new Set(),
    displayName: 'Kaneo',
    instanceConfigSchema: [{ key: 'baseUrl', label: 'Kaneo URL', required: true, sensitive: false, scope: 'instance' }],
    contextConfigSchema: [
      {
        key: 'credential',
        label: 'Kaneo API Key',
        required: true,
        sensitive: true,
        scope: 'context',
        storageKey: 'kaneo_apikey',
      },
      {
        key: 'workspaceId',
        label: 'Workspace ID',
        required: true,
        sensitive: false,
        scope: 'context',
        storageKey: 'kaneo_workspace_id',
      },
    ],
    traits: new Set(),
  })
}

describe('wizard-integration', () => {
  const userId = 'user123'
  const storageContextId = 'ctx456'

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    deleteWizardSession(userId, storageContextId)
    registerKaneoContributed()
  })

  afterEach(() => {
    unregisterContributedTaskProviderType(KANEO_PLUGIN_ID)
  })

  test('returns false when no active wizard', async () => {
    const { reply } = createMockReply()

    const result = await handleWizardMessage(userId, storageContextId, 'some text', reply, true)
    expect(result).toBe(false)
  })

  test('handleWizardMessage falls back to text when interactive buttons are disabled', async () => {
    await createWizard(userId, storageContextId, 'kaneo')
    const { reply, textCalls, buttonCalls } = createMockReply()

    const handled = await handleWizardMessage(userId, storageContextId, 'sk-test12345', reply, false)

    expect(handled).toBe(true)
    expect(textCalls.length).toBeGreaterThan(0)
    expect(buttonCalls.length).toBe(0)
  })

  test('calls deleteMessage when available and step is sensitive', async () => {
    await createWizard(userId, storageContextId, 'kaneo')
    const deletedIds: string[] = []
    const reply: ReplyFn = {
      ...createMockReply().reply,
      deleteMessage: (messageId: string): Promise<void> => {
        deletedIds.push(messageId)
        return Promise.resolve()
      },
    }

    const handled = await handleWizardMessage(
      userId,
      storageContextId,
      'sk-test-api-key',
      reply,
      false,
      undefined,
      'msg-789',
    )
    expect(handled).toBe(true)
    expect(deletedIds).toEqual(['msg-789'])
  })

  test('appends warning when deleteMessage unavailable and step is sensitive', async () => {
    await createWizard(userId, storageContextId, 'kaneo')
    const { reply, textCalls } = createMockReply()

    const handled = await handleWizardMessage(
      userId,
      storageContextId,
      'sk-test-api-key',
      reply,
      false,
      undefined,
      'msg-789',
    )
    expect(handled).toBe(true)
    expect(textCalls.length).toBeGreaterThan(0)
    expect(textCalls[0]).toContain('manually delete')
  })
})
