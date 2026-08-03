// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import type { ModelMessage } from 'ai'

import type { AnalyticsObserver } from '../../src/analytics/runtime.js'
import type { AnalyticsSourceFact } from '../../src/analytics/source-facts.js'
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

const recordFacts = (): { observer: AnalyticsObserver; facts: AnalyticsSourceFact[] } => {
  const facts: AnalyticsSourceFact[] = []
  return {
    facts,
    observer: {
      observe: (fact: AnalyticsSourceFact): void => {
        facts.push(fact)
      },
      flush: (): Promise<void> => Promise.resolve(),
      stop: (): Promise<void> => Promise.resolve(),
    },
  }
}

const regenPhases = (facts: AnalyticsSourceFact[]): string[] =>
  facts.filter((fact) => fact.type === 'edit_regen').map((fact) => (fact as { phase: string }).phase)

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

  test('W1 emits a turn_steered fact on the active run when an analytics observer is wired', async () => {
    const ctxId = scopedDm('w1-analytics-user')
    addUser({ userId: 'w1-analytics-user', platformInstanceId: PLATFORM_ID, addedBy: ADMIN_ID })

    const original: IncomingMessage = {
      ...createDmMessage('w1-analytics-user'),
      text: 'hello',
      messageId: 'm1',
    }
    cacheObservedIncomingMessage(original, authFor(ctxId))
    await flushPendingWrites()
    appendHistory(ctxId, [makeUserTurn('m1', 'hello')])

    const { reply } = createMockReply()
    const run = runRegistry.begin(ctxId, { turnId: 't-analytics', reply, originatingMessageIds: ['m1'] })

    const facts: AnalyticsSourceFact[] = []
    const edited: IncomingMessage = {
      ...createDmMessage('w1-analytics-user'),
      text: 'hi',
      messageId: 'm1',
      editedAt: 1,
    }
    await onIncomingEdit(chat, edited, reply, {
      analyticsObserver: {
        observe: (fact: AnalyticsSourceFact): void => {
          facts.push(fact)
        },
        flush: (): Promise<void> => Promise.resolve(),
        stop: (): Promise<void> => Promise.resolve(),
      },
    })

    const steered = facts.filter((fact) => fact.type === 'turn_steered')
    expect(steered).toHaveLength(1)
    expect(steered[0]).toMatchObject({
      ordinal: 1,
      ackSent: true,
      source: { rawTurnId: 't-analytics', actorRole: 'member' },
    })
    // The edit is a correction, not a newly accepted message: no double count.
    expect(facts.some((fact) => fact.type === 'chat_message_accepted')).toBe(false)
    expect(run.steerQueue.some((s) => s.text.includes('Your earlier message was edited'))).toBe(true)

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

  test('W1 emits edit_classified w1 alongside the steer fact', async () => {
    const ctxId = scopedDm('w1-classified-user')
    addUser({ userId: 'w1-classified-user', platformInstanceId: PLATFORM_ID, addedBy: ADMIN_ID })
    const original: IncomingMessage = { ...createDmMessage('w1-classified-user'), text: 'hello', messageId: 'm1' }
    cacheObservedIncomingMessage(original, authFor(ctxId))
    await flushPendingWrites()
    appendHistory(ctxId, [makeUserTurn('m1', 'hello')])
    const { reply } = createMockReply()
    runRegistry.begin(ctxId, { turnId: 't-classified', reply, originatingMessageIds: ['m1'] })
    const { observer, facts } = recordFacts()
    const edited: IncomingMessage = {
      ...createDmMessage('w1-classified-user'),
      text: 'hi',
      messageId: 'm1',
      editedAt: 1,
    }
    await onIncomingEdit(chat, edited, reply, { analyticsObserver: observer })
    const classified = facts.filter((fact) => fact.type === 'edit_classified')
    expect(classified).toHaveLength(1)
    expect(classified[0]).toMatchObject({ window: 'w1' })
    runRegistry.end(ctxId)
  })

  test('W2 no-side-effects emits edit_classified w2 plus the regen funnel', async () => {
    const ctxId = scopedDm('w2-classified-user')
    addUser({ userId: 'w2-classified-user', platformInstanceId: PLATFORM_ID, addedBy: ADMIN_ID })
    const original: IncomingMessage = { ...createDmMessage('w2-classified-user'), text: 'hello', messageId: 'm1' }
    cacheObservedIncomingMessage(original, authFor(ctxId))
    await flushPendingWrites()
    appendHistory(ctxId, [makeUserTurn('m1', 'hello')])
    lastTurnRegistry.record(ctxId, {
      originatingMessageIds: ['m1'],
      completedEffects: [],
      replyTarget: undefined,
      finishedAt: Date.now(),
    })
    const { reply } = createMockReply()
    const { observer, facts } = recordFacts()
    const edited: IncomingMessage = {
      ...createDmMessage('w2-classified-user'),
      text: 'hi',
      messageId: 'm1',
      editedAt: 2,
    }
    await onIncomingEdit(chat, edited, reply, { processMessage: () => Promise.resolve(), analyticsObserver: observer })
    const classified = facts.filter((fact) => fact.type === 'edit_classified')
    expect(classified).toHaveLength(1)
    expect(classified[0]).toMatchObject({ window: 'w2' })
    expect(regenPhases(facts)).toEqual(['regen_started', 'regen_completed'])
  })

  test('W3 emits edit_classified w3 and no regen facts', async () => {
    const ctxId = scopedDm('w3-classified-user')
    addUser({ userId: 'w3-classified-user', platformInstanceId: PLATFORM_ID, addedBy: ADMIN_ID })
    const original: IncomingMessage = { ...createDmMessage('w3-classified-user'), text: 'first', messageId: 'm1' }
    cacheObservedIncomingMessage(original, authFor(ctxId))
    await flushPendingWrites()
    appendHistory(ctxId, [makeUserTurn('m1', 'first')])
    const { reply } = createMockReply()
    const { observer, facts } = recordFacts()
    const edited: IncomingMessage = {
      ...createDmMessage('w3-classified-user'),
      text: 'second',
      messageId: 'm1',
      editedAt: 1,
    }
    await onIncomingEdit(chat, edited, reply, { analyticsObserver: observer })
    const classified = facts.filter((fact) => fact.type === 'edit_classified')
    expect(classified).toHaveLength(1)
    expect(classified[0]).toMatchObject({ window: 'w3' })
    expect(regenPhases(facts)).toEqual([])
  })

  test('a same-text no-op edit emits no facts', async () => {
    const ctxId = scopedDm('w-noop-user')
    addUser({ userId: 'w-noop-user', platformInstanceId: PLATFORM_ID, addedBy: ADMIN_ID })
    const original: IncomingMessage = { ...createDmMessage('w-noop-user'), text: 'same', messageId: 'm1' }
    cacheObservedIncomingMessage(original, authFor(ctxId))
    await flushPendingWrites()
    const { reply } = createMockReply()
    const { observer, facts } = recordFacts()
    const edited: IncomingMessage = { ...createDmMessage('w-noop-user'), text: 'same', messageId: 'm1', editedAt: 2 }
    await onIncomingEdit(chat, edited, reply, { analyticsObserver: observer })
    expect(facts).toHaveLength(0)
  })

  test('W2 without processMessage emits edit_regen history_only and skips regen', async () => {
    const ctxId = scopedDm('w2-history-user')
    addUser({ userId: 'w2-history-user', platformInstanceId: PLATFORM_ID, addedBy: ADMIN_ID })
    const original: IncomingMessage = { ...createDmMessage('w2-history-user'), text: 'hello', messageId: 'm1' }
    cacheObservedIncomingMessage(original, authFor(ctxId))
    await flushPendingWrites()
    appendHistory(ctxId, [makeUserTurn('m1', 'hello')])
    lastTurnRegistry.record(ctxId, {
      originatingMessageIds: ['m1'],
      completedEffects: [],
      replyTarget: undefined,
      finishedAt: Date.now(),
    })
    const { reply } = createMockReply()
    const { observer, facts } = recordFacts()
    const edited: IncomingMessage = { ...createDmMessage('w2-history-user'), text: 'hi', messageId: 'm1', editedAt: 2 }
    await onIncomingEdit(chat, edited, reply, { analyticsObserver: observer })
    expect(regenPhases(facts)).toEqual(['history_only'])
  })
})
