// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import type { ModelMessage } from 'ai'

import { getThreadScopedStorageContextId } from '../../src/auth.js'
import { cacheObservedIncomingMessage } from '../../src/bot-message-caching.js'
import type { AuthorizationResult, IncomingMessage } from '../../src/chat/types.js'
import { appendHistory, loadHistory } from '../../src/history.js'
import { getMessageByContext } from '../../src/message-cache/store.js'
import { onIncomingEdit } from '../../src/message-edit/handle.js'
import type { MessageSegment } from '../../src/message-edit/segments.js'
import { lastTurnRegistry } from '../../src/run-control/last-turn-registry.js'
import { runRegistry } from '../../src/run-control/registry.js'
import { addUser } from '../../src/users.js'
import {
  createDmMessage,
  createMockChat,
  createMockReply,
  flushPendingWrites,
  mockLogger,
  seedTestPlatformInstance,
  setupTestDb,
} from '../utils/test-helpers.js'

const PLATFORM_ID = 'test-instance'
const ADMIN_ID = 'admin'

const scopedDm = (userId: string): string => getThreadScopedStorageContextId(userId, 'dm', undefined, PLATFORM_ID)

function authFor(ctxId: string): AuthorizationResult {
  return { allowed: true, isBotAdmin: false, isGroupAdmin: false, storageContextId: ctxId }
}

function makeUserTurn(messageId: string, text: string): ModelMessage {
  return {
    role: 'user',
    content: text,
    providerOptions: {
      papai: {
        messageIds: [messageId],
        segments: [{ messageId, text, username: null }] satisfies MessageSegment[],
        isThread: false,
        isDm: true,
      },
    },
  } as ModelMessage
}

describe('onIncomingEdit', () => {
  let chat: ReturnType<typeof createMockChat>

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: PLATFORM_ID })
    addUser({ userId: ADMIN_ID, platformInstanceId: PLATFORM_ID, addedBy: 'system' })
    runRegistry.clear()
    lastTurnRegistry.clear()
    chat = createMockChat()
  })

  test('skips command edits (no-op, no steer, no ack)', async () => {
    const ctxId = scopedDm('cmd-user')
    addUser({ userId: 'cmd-user', platformInstanceId: PLATFORM_ID, addedBy: ADMIN_ID })
    const { reply, textCalls } = createMockReply()
    const run = runRegistry.begin(ctxId, { turnId: 't', reply, originatingMessageIds: ['m1'] })

    const msg: IncomingMessage = {
      ...createDmMessage('cmd-user'),
      text: '/stop',
      commandMatch: 'stop',
      messageId: 'm1',
      editedAt: 1,
    }
    await onIncomingEdit(chat, msg, reply, {})

    expect(run.steerQueue.length).toBe(0)
    expect(textCalls.length).toBe(0)
    runRegistry.end(ctxId)
  })

  test('W1 pushes a steer correction containing the edited text and acks', async () => {
    const ctxId = scopedDm('w1-user')
    addUser({ userId: 'w1-user', platformInstanceId: PLATFORM_ID, addedBy: ADMIN_ID })

    const original: IncomingMessage = {
      ...createDmMessage('w1-user'),
      text: 'hello',
      messageId: 'm1',
    }
    cacheObservedIncomingMessage(original, authFor(ctxId))
    await flushPendingWrites()
    appendHistory(ctxId, [makeUserTurn('m1', 'hello')])

    const { reply, textCalls } = createMockReply()
    const run = runRegistry.begin(ctxId, { turnId: 't', reply, originatingMessageIds: ['m1'] })

    const edited: IncomingMessage = {
      ...createDmMessage('w1-user'),
      text: 'hi',
      messageId: 'm1',
      editedAt: 1,
    }
    await onIncomingEdit(chat, edited, reply, {})

    expect(run.steerQueue.some((s) => s.text.includes('Your earlier message was edited'))).toBe(true)
    expect(run.steerQueue.some((s) => s.text.includes('hi'))).toBe(true)
    expect(textCalls.some((t) => t.includes('folding that into the current run'))).toBe(true)

    // Baseline history + metadata correction ran for W1 too.
    expect(loadHistory(ctxId).find((m) => m.role === 'user')?.content).toBe('hi')
    expect(getMessageByContext(ctxId, 'm1')?.text).toBe('hi')

    runRegistry.end(ctxId)
  })

  test('W3 (silent) still applies baseline metadata + history correction, no ack', async () => {
    const ctxId = scopedDm('w3-user')
    addUser({ userId: 'w3-user', platformInstanceId: PLATFORM_ID, addedBy: ADMIN_ID })

    const original: IncomingMessage = {
      ...createDmMessage('w3-user'),
      text: 'first',
      messageId: 'm1',
    }
    cacheObservedIncomingMessage(original, authFor(ctxId))
    await flushPendingWrites()
    appendHistory(ctxId, [makeUserTurn('m1', 'first')])

    const { reply, textCalls } = createMockReply()
    const edited: IncomingMessage = {
      ...createDmMessage('w3-user'),
      text: 'second',
      messageId: 'm1',
      editedAt: 1,
    }
    await onIncomingEdit(chat, edited, reply, {})

    expect(textCalls.length).toBe(0)
    expect(getMessageByContext(ctxId, 'm1')?.text).toBe('second')
    expect(loadHistory(ctxId).find((m) => m.role === 'user')?.content).toBe('second')
  })

  test('skips when the edited text equals the stored text', async () => {
    const ctxId = scopedDm('same-user')
    addUser({ userId: 'same-user', platformInstanceId: PLATFORM_ID, addedBy: ADMIN_ID })

    const original: IncomingMessage = {
      ...createDmMessage('same-user'),
      text: 'unchanged',
      messageId: 'm1',
    }
    cacheObservedIncomingMessage(original, authFor(ctxId))
    await flushPendingWrites()
    appendHistory(ctxId, [makeUserTurn('m1', 'unchanged')])

    const { reply, textCalls } = createMockReply()
    const run = runRegistry.begin(ctxId, { turnId: 't', reply, originatingMessageIds: ['m1'] })

    const edited: IncomingMessage = {
      ...createDmMessage('same-user'),
      text: 'unchanged',
      messageId: 'm1',
      editedAt: 1,
    }
    await onIncomingEdit(chat, edited, reply, {})

    expect(run.steerQueue.length).toBe(0)
    expect(textCalls.length).toBe(0)
    runRegistry.end(ctxId)
  })

  test('skips when auth denies the user', async () => {
    const ctxId = scopedDm('denied-user')
    // Note: no addUser() → checkAuthorizationExtended returns allowed=false.
    const { reply, textCalls } = createMockReply()
    const run = runRegistry.begin(ctxId, { turnId: 't', reply, originatingMessageIds: ['m1'] })

    const edited: IncomingMessage = {
      ...createDmMessage('denied-user'),
      text: 'hi',
      messageId: 'm1',
      editedAt: 1,
    }
    await onIncomingEdit(chat, edited, reply, {})

    expect(run.steerQueue.length).toBe(0)
    expect(textCalls.length).toBe(0)
    runRegistry.end(ctxId)
  })
})
