// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import type { ModelMessage } from 'ai'

import { getThreadScopedStorageContextId } from '../../src/auth.js'
import { cacheObservedIncomingMessage } from '../../src/bot-message-caching.js'
import type { AuthorizationResult, IncomingMessage, ReplyFn, ReplyTarget } from '../../src/chat/types.js'
import { appendHistory } from '../../src/history.js'
import type { ProcessMessageRest } from '../../src/llm-orchestrator-process-args.js'
import { onIncomingEdit } from '../../src/message-edit/handle.js'
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
        segments: [{ messageId, text, username: null }],
        isThread: false,
        isDm: true,
      },
    },
  } as ModelMessage
}

type ProcessCall = {
  reply: ReplyFn
  contextId: string
  chatUserId: string
  username: string | null
  userText: string
  contextType: 'dm' | 'group'
  rest: ProcessMessageRest
}

type EditCall = { target: ReplyTarget; markdown: string }

/** Build a ReplyFn that wraps `createMockReply` and captures `editReply` calls. */
function buildReplyWithEditCapture(): { reply: ReplyFn; editCalls: EditCall[] } {
  const editCalls: EditCall[] = []
  const base = createMockReply()
  const reply: ReplyFn = {
    ...base.reply,
    editReply: (target: ReplyTarget, markdown: string): Promise<void> => {
      editCalls.push({ target, markdown })
      return Promise.resolve()
    },
  }
  return { reply, editCalls }
}

describe('W2 rerun pathway', () => {
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

  describe('no side-effects (completedEffects empty)', () => {
    test('regenerates a fresh turn with the edited text and supersedes the old reply', async () => {
      const ctxId = scopedDm('w2-user')
      addUser({ userId: 'w2-user', platformInstanceId: PLATFORM_ID, addedBy: ADMIN_ID })

      const original: IncomingMessage = {
        ...createDmMessage('w2-user'),
        text: 'hello',
        messageId: 'm1',
      }
      cacheObservedIncomingMessage(original, authFor(ctxId))
      await flushPendingWrites()
      appendHistory(ctxId, [makeUserTurn('m1', 'hello')])

      const replyTarget: ReplyTarget = { platform: 'telegram', ref: { messageId: 99, chatId: 1 } }
      lastTurnRegistry.record(ctxId, {
        originatingMessageIds: ['m1'],
        completedEffects: [],
        replyTarget,
        finishedAt: Date.now(),
      })

      const processCalls: ProcessCall[] = []
      const { reply, editCalls } = buildReplyWithEditCapture()

      const edited: IncomingMessage = {
        ...createDmMessage('w2-user'),
        text: 'hi (edited)',
        messageId: 'm1',
        editedAt: 2,
      }
      await onIncomingEdit(chat, edited, reply, {
        processMessage: (
          replyArg: ReplyFn,
          contextId: string,
          chatUserId: string,
          username: string | null,
          userText: string,
          contextType: 'dm' | 'group',
          ...rest: ProcessMessageRest
        ): Promise<void> => {
          processCalls.push({ reply: replyArg, contextId, chatUserId, username, userText, contextType, rest })
          return Promise.resolve()
        },
      })

      expect(processCalls.length).toBe(1)
      const call = processCalls[0]!
      expect(call.reply).toBe(reply)
      expect(call.contextId).toBe(ctxId)
      expect(call.chatUserId).toBe('w2-user')
      expect(call.username).toBeNull()
      expect(call.userText).toBe('hi (edited)')
      expect(call.contextType).toBe('dm')
      // ProcessMessageRest positional slots:
      //   [0] configContextId, [1] deps, [2] attachments, [3] turnId, [4] actorRole
      // For a DM with no thread, configContextId === storageContextId.
      expect(call.rest[0]).toBe(ctxId)
      expect(call.rest[2]).toEqual([])
      expect(call.rest[3]).toBeUndefined()
      expect(call.rest[4]).toBe('member')

      expect(editCalls.length).toBe(1)
      expect(editCalls[0]!.target).toBe(replyTarget)
      expect(editCalls[0]!.markdown).toBe('⟲ Superseded by your edit.')
    })

    test('skips supersede when reply.editReply is unavailable', async () => {
      const ctxId = scopedDm('w2-noedit-user')
      addUser({ userId: 'w2-noedit-user', platformInstanceId: PLATFORM_ID, addedBy: ADMIN_ID })

      const original: IncomingMessage = {
        ...createDmMessage('w2-noedit-user'),
        text: 'hello',
        messageId: 'm1',
      }
      cacheObservedIncomingMessage(original, authFor(ctxId))
      await flushPendingWrites()
      appendHistory(ctxId, [makeUserTurn('m1', 'hello')])

      lastTurnRegistry.record(ctxId, {
        originatingMessageIds: ['m1'],
        completedEffects: [],
        replyTarget: { platform: 'telegram', ref: { messageId: 7 } },
        finishedAt: Date.now(),
      })

      let processed = 0
      const { reply } = createMockReply()

      const edited: IncomingMessage = {
        ...createDmMessage('w2-noedit-user'),
        text: 'hi (edited)',
        messageId: 'm1',
        editedAt: 2,
      }
      await onIncomingEdit(chat, edited, reply, {
        processMessage: (): Promise<void> => {
          processed++
          return Promise.resolve()
        },
      })

      expect(processed).toBe(1)
    })

    test('skips regeneration when processMessage is not wired into deps', async () => {
      const ctxId = scopedDm('w2-nodeps-user')
      addUser({ userId: 'w2-nodeps-user', platformInstanceId: PLATFORM_ID, addedBy: ADMIN_ID })

      const original: IncomingMessage = {
        ...createDmMessage('w2-nodeps-user'),
        text: 'hello',
        messageId: 'm1',
      }
      cacheObservedIncomingMessage(original, authFor(ctxId))
      await flushPendingWrites()
      appendHistory(ctxId, [makeUserTurn('m1', 'hello')])

      lastTurnRegistry.record(ctxId, {
        originatingMessageIds: ['m1'],
        completedEffects: [],
        replyTarget: { platform: 'telegram', ref: { messageId: 7 } },
        finishedAt: Date.now(),
      })

      const { reply, editCalls } = buildReplyWithEditCapture()

      const edited: IncomingMessage = {
        ...createDmMessage('w2-nodeps-user'),
        text: 'hi (edited)',
        messageId: 'm1',
        editedAt: 2,
      }
      await onIncomingEdit(chat, edited, reply, {})

      expect(editCalls.length).toBe(0)
    })
  })

  describe('side-effects present (completedEffects non-empty)', () => {
    test('does NOT immediately regenerate — Task 11 posts an ask-first prompt instead', async () => {
      const ctxId = scopedDm('w2-side-user')
      addUser({ userId: 'w2-side-user', platformInstanceId: PLATFORM_ID, addedBy: ADMIN_ID })

      const original: IncomingMessage = {
        ...createDmMessage('w2-side-user'),
        text: 'hello',
        messageId: 'm1',
      }
      cacheObservedIncomingMessage(original, authFor(ctxId))
      await flushPendingWrites()
      appendHistory(ctxId, [makeUserTurn('m1', 'hello')])

      lastTurnRegistry.record(ctxId, {
        originatingMessageIds: ['m1'],
        completedEffects: [{ toolName: 'create_task' }],
        replyTarget: { platform: 'telegram', ref: { messageId: 88 } },
        finishedAt: Date.now(),
      })

      let processed = 0
      const { reply, editCalls } = buildReplyWithEditCapture()

      const edited: IncomingMessage = {
        ...createDmMessage('w2-side-user'),
        text: 'hi (edited)',
        messageId: 'm1',
        editedAt: 2,
      }
      await onIncomingEdit(chat, edited, reply, {
        processMessage: (): Promise<void> => {
          processed++
          return Promise.resolve()
        },
      })

      expect(processed).toBe(0)
      expect(editCalls.length).toBe(0)
    })
  })
})
