// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getThreadScopedStorageContextId } from '../../src/auth.js'
import type { AuthorizationResult, IncomingMessage, ReplyFn, ReplyTarget } from '../../src/chat/types.js'
import { setConfigValue } from '../../src/config.js'
import type { ProcessMessageFn, ProcessMessageRest } from '../../src/llm-orchestrator-process-args.js'
import type { EditHandlerDeps } from '../../src/message-edit/handle.js'
import { regenerateFromEditedText } from '../../src/message-edit/w2-regen.js'
import type { LastTurn } from '../../src/run-control/last-turn-registry.js'
import { addUser } from '../../src/users.js'
import { createDmMessage, mockLogger, seedTestPlatformInstance, setupTestDb } from '../utils/test-helpers.js'

const PLATFORM_ID = 'test-instance'
const ADMIN_ID = 'admin'

const scopedDm = (userId: string): string => getThreadScopedStorageContextId(userId, 'dm', undefined, PLATFORM_ID)

function authFor(ctxId: string): AuthorizationResult {
  return { allowed: true, isBotAdmin: false, isGroupAdmin: false, storageContextId: ctxId }
}

type ProcessCall = {
  reply: ReplyFn
  contextId: string
  chatUserId: string
  userText: string
  contextType: 'dm' | 'group'
  rest: ProcessMessageRest
}

function buildProcessSpy(calls: ProcessCall[]): ProcessMessageFn {
  const spy: ProcessMessageFn = (
    reply: ReplyFn,
    contextId: string,
    chatUserId: string,
    _username: string | null,
    userText: string,
    contextType: 'dm' | 'group',
    ...rest: ProcessMessageRest
  ): Promise<void> => {
    calls.push({ reply, contextId, chatUserId, userText, contextType, rest })
    return Promise.resolve()
  }
  return spy
}

describe('regenerateFromEditedText', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: PLATFORM_ID })
    addUser({ userId: ADMIN_ID, platformInstanceId: PLATFORM_ID, addedBy: 'system' })
  })

  test('kicks processMessage with the edited text and supersedes the old reply', async () => {
    const ctxId = scopedDm('regen-user')
    addUser({ userId: 'regen-user', platformInstanceId: PLATFORM_ID, addedBy: ADMIN_ID })

    const msg: IncomingMessage = { ...createDmMessage('regen-user'), text: 'do better thing', messageId: 'm1' }
    const replyTarget: ReplyTarget = { platform: 'telegram', ref: { messageId: 4 } }
    const last: LastTurn = {
      originatingMessageIds: ['m1'],
      completedEffects: [],
      replyTarget,
      finishedAt: Date.now(),
    }
    const editCalls: Array<{ target: ReplyTarget; markdown: string }> = []
    const reply: ReplyFn = {
      text: () => Promise.resolve(),
      formatted: () => Promise.resolve(),
      typing: () => {},
      buttons: () => Promise.resolve(undefined),
      editReply: (target, markdown): Promise<void> => {
        editCalls.push({ target, markdown })
        return Promise.resolve()
      },
    }

    const processCalls: ProcessCall[] = []
    const deps: EditHandlerDeps = { processMessage: buildProcessSpy(processCalls) }

    await regenerateFromEditedText(msg, reply, authFor(ctxId), last, deps)

    expect(processCalls.length).toBe(1)
    const call = processCalls[0]!
    expect(call.contextId).toBe(ctxId)
    expect(call.userText).toBe('do better thing')
    expect(call.rest[2]).toEqual([])
    expect(call.rest[3]).toBeUndefined()

    expect(editCalls.length).toBe(1)
    expect(editCalls[0]!.target).toBe(replyTarget)
    expect(editCalls[0]!.markdown).toBe('⟲ Superseded by your edit.')
  })

  test('forwards isBotAdmin and platformInstanceId to the regenerated turn', async () => {
    const ctxId = scopedDm('regen-admin-user')
    addUser({ userId: 'regen-admin-user', platformInstanceId: PLATFORM_ID, addedBy: ADMIN_ID })

    const msg: IncomingMessage = { ...createDmMessage('regen-admin-user'), text: 'redo it', messageId: 'm1' }
    const last: LastTurn = {
      originatingMessageIds: ['m1'],
      completedEffects: [],
      replyTarget: undefined,
      finishedAt: Date.now(),
    }
    const reply: ReplyFn = {
      text: () => Promise.resolve(),
      formatted: () => Promise.resolve(),
      typing: () => {},
      buttons: () => Promise.resolve(undefined),
    }

    const processCalls: ProcessCall[] = []
    const deps: EditHandlerDeps = { processMessage: buildProcessSpy(processCalls) }

    await regenerateFromEditedText(msg, reply, { ...authFor(ctxId), isBotAdmin: true }, last, deps)

    expect(processCalls.length).toBe(1)
    expect(processCalls[0]!.rest[7]).toBe(true)
    expect(processCalls[0]!.rest[8]).toBe(msg.platformInstanceId)
  })

  test('supersedes the old reply in the context language', async () => {
    const ctxId = scopedDm('regen-ru-user')
    addUser({ userId: 'regen-ru-user', platformInstanceId: PLATFORM_ID, addedBy: ADMIN_ID })
    setConfigValue(ctxId, 'language', 'ru')

    const msg: IncomingMessage = { ...createDmMessage('regen-ru-user'), text: 'сделай лучше', messageId: 'm1' }
    const last: LastTurn = {
      originatingMessageIds: ['m1'],
      completedEffects: [],
      replyTarget: { platform: 'telegram', ref: { messageId: 4 } },
      finishedAt: Date.now(),
    }
    const editCalls: Array<{ target: ReplyTarget; markdown: string }> = []
    const reply: ReplyFn = {
      text: () => Promise.resolve(),
      formatted: () => Promise.resolve(),
      typing: () => {},
      buttons: () => Promise.resolve(undefined),
      editReply: (target, markdown): Promise<void> => {
        editCalls.push({ target, markdown })
        return Promise.resolve()
      },
    }

    await regenerateFromEditedText(msg, reply, authFor(ctxId), last, {
      processMessage: buildProcessSpy([]),
    })

    expect(editCalls.length).toBe(1)
    expect(editCalls[0]!.markdown).toBe('⟲ Заменено вашей правкой.')
  })

  test('skips and logs when processMessage is not wired into deps', async () => {
    const ctxId = scopedDm('regen-nodeps-user')
    addUser({ userId: 'regen-nodeps-user', platformInstanceId: PLATFORM_ID, addedBy: ADMIN_ID })

    const msg: IncomingMessage = { ...createDmMessage('regen-nodeps-user'), text: 'x', messageId: 'm1' }
    const last: LastTurn = {
      originatingMessageIds: ['m1'],
      completedEffects: [],
      replyTarget: { platform: 'telegram', ref: { messageId: 1 } },
      finishedAt: Date.now(),
    }
    let editCalled = false
    const reply: ReplyFn = {
      text: () => Promise.resolve(),
      formatted: () => Promise.resolve(),
      typing: () => {},
      buttons: () => Promise.resolve(undefined),
      editReply: (): Promise<void> => {
        editCalled = true
        return Promise.resolve()
      },
    }

    await regenerateFromEditedText(msg, reply, authFor(ctxId), last, {})

    expect(editCalled).toBe(false)
  })
})
