// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Tests for wizard-integration module
 */

import { beforeEach, describe, expect, test } from 'bun:test'

import type { ReplyFn } from '../src/chat/types.js'
import { handleWizardMessage } from '../src/wizard-integration.js'
import { createWizard } from '../src/wizard/engine.js'
import { deleteWizardSession } from '../src/wizard/state.js'
import { createMockReply, mockLogger, setupTestDb } from './utils/test-helpers.js'

describe('wizard-integration', () => {
  const userId = 'user123'
  const storageContextId = 'ctx456'

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    deleteWizardSession(userId, storageContextId)
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
