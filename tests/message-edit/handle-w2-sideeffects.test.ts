// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import type { ModelMessage } from 'ai'

import type { AnalyticsObserver } from '../../src/analytics/runtime.js'
import type { AnalyticsSourceFact, EditRegenFact } from '../../src/analytics/source-facts.js'
import { getThreadScopedStorageContextId } from '../../src/auth.js'
import { cacheObservedIncomingMessage } from '../../src/bot-message-caching.js'
import type {
  AuthorizationResult,
  ButtonReplyOptions,
  IncomingMessage,
  PromptHandle,
  ReplyFn,
  ReplyTarget,
} from '../../src/chat/types.js'
import { appendHistory } from '../../src/history.js'
import type { ProcessMessageFn, ProcessMessageRest } from '../../src/llm-orchestrator-process-args.js'
import { peekEditPrompt } from '../../src/message-edit/edit-prompt-store.js'
import { resetEditPromptStoreForTesting } from '../../src/message-edit/edit-prompt-store.testing.js'
import { onIncomingEdit } from '../../src/message-edit/handle.js'
import { lastTurnRegistry } from '../../src/run-control/last-turn-registry.js'
import { runRegistry } from '../../src/run-control/registry.js'
import { addUser } from '../../src/users.js'
import {
  createDmMessage,
  createMockChat,
  flushPendingWrites,
  mockLogger,
  seedTestPlatformInstance,
  setupTestDb,
} from '../utils/test-helpers.js'

const PLATFORM_ID = 'test-instance'
const ADMIN_ID = 'admin'

const scopedDm = (userId: string): string => getThreadScopedStorageContextId(userId, 'dm', undefined, PLATFORM_ID)

function authFor(ctxId: string): AuthorizationResult {
  return {
    allowed: true,
    isBotAdmin: false,
    isGroupAdmin: false,
    storageContextId: ctxId,
  }
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

type ButtonCall = { content: string; options: ButtonReplyOptions }
type EditCall = { target: ReplyTarget; markdown: string }
type ProcessCall = {
  reply: ReplyFn
  contextId: string
  chatUserId: string
  userText: string
  contextType: 'dm' | 'group'
  rest: ProcessMessageRest
}

interface CapturingReply {
  reply: ReplyFn
  buttonCalls: ButtonCall[]
  editCalls: EditCall[]
  ephemeralCalls: string[]
}

function buildCapturingReply(): CapturingReply {
  const buttonCalls: ButtonCall[] = []
  const editCalls: EditCall[] = []
  const ephemeralCalls: string[] = []
  const reply: ReplyFn = {
    text: () => Promise.resolve(),
    formatted: () => Promise.resolve(),
    typing: () => {},
    buttons: (content: string, options: ButtonReplyOptions): Promise<PromptHandle | undefined> => {
      buttonCalls.push({ content, options })
      return Promise.resolve({ redact: () => Promise.resolve(), remove: () => Promise.resolve() })
    },
    editReply: (target: ReplyTarget, markdown: string): Promise<void> => {
      editCalls.push({ target, markdown })
      return Promise.resolve()
    },
    ephemeralConfirm: (text: string): Promise<void> => {
      ephemeralCalls.push(text)
      return Promise.resolve()
    },
  }
  return { reply, buttonCalls, editCalls, ephemeralCalls }
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

describe('W2 rerun pathway — side-effects (Task 11)', () => {
  let chat: ReturnType<typeof createMockChat>

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: PLATFORM_ID })
    addUser({
      userId: ADMIN_ID,
      platformInstanceId: PLATFORM_ID,
      addedBy: 'system',
    })
    runRegistry.clear()
    lastTurnRegistry.clear()
    resetEditPromptStoreForTesting()
    chat = createMockChat()
  })

  test('posts an ask-first prompt with edit:adjust/edit:note callbackData', async () => {
    const ctxId = scopedDm('w2-se-user')
    addUser({
      userId: 'w2-se-user',
      platformInstanceId: PLATFORM_ID,
      addedBy: ADMIN_ID,
    })

    const original: IncomingMessage = {
      ...createDmMessage('w2-se-user'),
      text: 'create my task',
      messageId: 'm1',
    }
    cacheObservedIncomingMessage(original, authFor(ctxId))
    await flushPendingWrites()
    appendHistory(ctxId, [makeUserTurn('m1', 'create my task')])

    const replyTarget: ReplyTarget = {
      platform: 'telegram',
      ref: { messageId: 50, chatId: 1 },
    }
    lastTurnRegistry.record(ctxId, {
      originatingMessageIds: ['m1'],
      completedEffects: [{ toolName: 'create_task' }],
      replyTarget,
      finishedAt: Date.now(),
    })

    const processCalls: ProcessCall[] = []
    const { reply, buttonCalls, editCalls } = buildCapturingReply()

    const edited: IncomingMessage = {
      ...createDmMessage('w2-se-user'),
      text: 'create my other task',
      messageId: 'm1',
      editedAt: 2,
    }
    await onIncomingEdit(chat, edited, reply, {
      processMessage: buildProcessSpy(processCalls),
    })

    // The side-effects branch must NOT immediately regenerate.
    expect(processCalls.length).toBe(0)
    expect(editCalls.length).toBe(0)

    // Exactly one prompt, carrying both edit: buttons.
    expect(buttonCalls.length).toBe(1)
    const buttons = buttonCalls[0]!.options.buttons!
    expect(buttons.length).toBe(2)
    const callbackData = buttons.map((b) => b.callbackData).sort()
    expect(callbackData[0]).toMatch(/^edit:adjust:[A-Za-z0-9_-]+$/u)
    expect(callbackData[1]).toMatch(/^edit:note:[A-Za-z0-9_-]+$/u)
    expect(callbackData[0]).not.toBe(callbackData[1])

    // Prompt body surfaces the stop summary and the edited text.
    expect(buttonCalls[0]!.content).toContain('create_task')
    expect(buttonCalls[0]!.content).toContain('create my other task')
  })

  test('Adjust button triggers corrective regen + supersede + ephemeral ack', async () => {
    const ctxId = scopedDm('w2-adj-user')
    addUser({
      userId: 'w2-adj-user',
      platformInstanceId: PLATFORM_ID,
      addedBy: ADMIN_ID,
    })

    const original: IncomingMessage = {
      ...createDmMessage('w2-adj-user'),
      text: 'do thing',
      messageId: 'm1',
    }
    cacheObservedIncomingMessage(original, authFor(ctxId))
    await flushPendingWrites()
    appendHistory(ctxId, [makeUserTurn('m1', 'do thing')])

    const replyTarget: ReplyTarget = {
      platform: 'telegram',
      ref: { messageId: 7 },
    }
    lastTurnRegistry.record(ctxId, {
      originatingMessageIds: ['m1'],
      completedEffects: [{ toolName: 'create_task' }],
      replyTarget,
      finishedAt: Date.now(),
    })

    const processCalls: ProcessCall[] = []
    const { reply, buttonCalls, editCalls, ephemeralCalls } = buildCapturingReply()

    const edited: IncomingMessage = {
      ...createDmMessage('w2-adj-user'),
      text: 'do better thing',
      messageId: 'm1',
      editedAt: 2,
    }
    await onIncomingEdit(chat, edited, reply, {
      processMessage: buildProcessSpy(processCalls),
    })

    // Find the registered prompt and fire its onAdjust (mirrors what the
    // interaction-router does when the user clicks [Adjust for me]).
    const adjustButton = buttonCalls[0]!.options.buttons!.find((b) => b.callbackData.startsWith('edit:adjust:'))!
    const promptId = adjustButton.callbackData.replace('edit:adjust:', '')
    const prompt = peekEditPrompt(promptId)
    expect(prompt).toBeDefined()
    await prompt!.onAdjust()

    // Same production-shape regen as the no-side-effects branch.
    expect(processCalls.length).toBe(1)
    const call = processCalls[0]!
    expect(call.reply).toBe(reply)
    expect(call.contextId).toBe(ctxId)
    expect(call.chatUserId).toBe('w2-adj-user')
    expect(call.userText).toBe('do better thing')
    expect(call.contextType).toBe('dm')
    expect(call.rest[0]).toBe(ctxId)
    expect(call.rest[2]).toEqual([])
    expect(call.rest[3]).toBeUndefined()
    expect(call.rest[4]).toBe('member')

    // Old reply is superseded.
    expect(editCalls.length).toBe(1)
    expect(editCalls[0]!.target).toBe(replyTarget)
    expect(editCalls[0]!.markdown).toBe('⟲ Superseded by your edit.')

    // Ephemeral "Adjusting…" ack fires.
    expect(ephemeralCalls).toEqual(['✏️ Adjusting…'])
  })

  test('Note button does NOT regenerate and acks with ✏️ Noted', async () => {
    const ctxId = scopedDm('w2-note-user')
    addUser({
      userId: 'w2-note-user',
      platformInstanceId: PLATFORM_ID,
      addedBy: ADMIN_ID,
    })

    const original: IncomingMessage = {
      ...createDmMessage('w2-note-user'),
      text: 'do thing',
      messageId: 'm1',
    }
    cacheObservedIncomingMessage(original, authFor(ctxId))
    await flushPendingWrites()
    appendHistory(ctxId, [makeUserTurn('m1', 'do thing')])

    lastTurnRegistry.record(ctxId, {
      originatingMessageIds: ['m1'],
      completedEffects: [{ toolName: 'create_task' }],
      replyTarget: { platform: 'telegram', ref: { messageId: 9 } },
      finishedAt: Date.now(),
    })

    const processCalls: ProcessCall[] = []
    const { reply, buttonCalls, editCalls, ephemeralCalls } = buildCapturingReply()

    const edited: IncomingMessage = {
      ...createDmMessage('w2-note-user'),
      text: 'do other thing',
      messageId: 'm1',
      editedAt: 2,
    }
    await onIncomingEdit(chat, edited, reply, {
      processMessage: buildProcessSpy(processCalls),
    })

    const noteButton = buttonCalls[0]!.options.buttons!.find((b) => b.callbackData.startsWith('edit:note:'))!
    const promptId = noteButton.callbackData.replace('edit:note:', '')
    const prompt = peekEditPrompt(promptId)
    expect(prompt).toBeDefined()
    await prompt!.onNote()

    expect(processCalls.length).toBe(0)
    expect(editCalls.length).toBe(0)
    expect(ephemeralCalls).toEqual(['✏️ Noted'])
  })

  test('platform without buttons leaves the edit as history-only (no throw)', async () => {
    const ctxId = scopedDm('w2-nobtn-user')
    addUser({
      userId: 'w2-nobtn-user',
      platformInstanceId: PLATFORM_ID,
      addedBy: ADMIN_ID,
    })

    const original: IncomingMessage = {
      ...createDmMessage('w2-nobtn-user'),
      text: 'do thing',
      messageId: 'm1',
    }
    cacheObservedIncomingMessage(original, authFor(ctxId))
    await flushPendingWrites()
    appendHistory(ctxId, [makeUserTurn('m1', 'do thing')])

    lastTurnRegistry.record(ctxId, {
      originatingMessageIds: ['m1'],
      completedEffects: [{ toolName: 'create_task' }],
      replyTarget: undefined,
      finishedAt: Date.now(),
    })

    const processCalls: ProcessCall[] = []
    // reply.buttons rejects — mirrors Kontur Talk.
    const reply: ReplyFn = {
      text: () => Promise.resolve(),
      formatted: () => Promise.resolve(),
      typing: () => {},
      buttons: (): Promise<undefined> => Promise.reject(new Error('platform has no buttons')),
    }

    const edited: IncomingMessage = {
      ...createDmMessage('w2-nobtn-user'),
      text: 'do thing v2',
      messageId: 'm1',
      editedAt: 2,
    }
    await onIncomingEdit(chat, edited, reply, {
      processMessage: buildProcessSpy(processCalls),
    })

    // No regen, no prompt posted. History baseline (Task 8) still applied.
    expect(processCalls.length).toBe(0)
  })
})

describe('W2 regen funnel facts (Task 3)', () => {
  let chat: ReturnType<typeof createMockChat>

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: PLATFORM_ID })
    addUser({
      userId: ADMIN_ID,
      platformInstanceId: PLATFORM_ID,
      addedBy: 'system',
    })
    runRegistry.clear()
    lastTurnRegistry.clear()
    resetEditPromptStoreForTesting()
    chat = createMockChat()
  })

  test('posts the ask-first prompt and emits prompt_shown', async () => {
    const ctxId = scopedDm('w2-shown-user')
    addUser({ userId: 'w2-shown-user', platformInstanceId: PLATFORM_ID, addedBy: ADMIN_ID })
    const original: IncomingMessage = { ...createDmMessage('w2-shown-user'), text: 'create my task', messageId: 'm1' }
    cacheObservedIncomingMessage(original, authFor(ctxId))
    await flushPendingWrites()
    appendHistory(ctxId, [makeUserTurn('m1', 'create my task')])
    const replyTarget: ReplyTarget = { platform: 'telegram', ref: { messageId: 50, chatId: 1 } }
    lastTurnRegistry.record(ctxId, {
      originatingMessageIds: ['m1'],
      completedEffects: [{ toolName: 'create_task' }],
      replyTarget,
      finishedAt: Date.now(),
    })
    const processCalls: ProcessCall[] = []
    const { reply } = buildCapturingReply()
    const { observer, facts } = recordFacts()
    const edited: IncomingMessage = {
      ...createDmMessage('w2-shown-user'),
      text: 'create my other task',
      messageId: 'm1',
      editedAt: 2,
    }
    await onIncomingEdit(chat, edited, reply, {
      processMessage: buildProcessSpy(processCalls),
      analyticsObserver: observer,
    })
    expect(processCalls.length).toBe(0)
    expect(regenPhases(facts)).toEqual(['prompt_shown'])
  })

  test('adjust emits prompt_adjust then the regen funnel with durationMs', async () => {
    const ctxId = scopedDm('w2-adj-facts-user')
    addUser({ userId: 'w2-adj-facts-user', platformInstanceId: PLATFORM_ID, addedBy: ADMIN_ID })
    const original: IncomingMessage = { ...createDmMessage('w2-adj-facts-user'), text: 'do thing', messageId: 'm1' }
    cacheObservedIncomingMessage(original, authFor(ctxId))
    await flushPendingWrites()
    appendHistory(ctxId, [makeUserTurn('m1', 'do thing')])
    const replyTarget: ReplyTarget = { platform: 'telegram', ref: { messageId: 7 } }
    lastTurnRegistry.record(ctxId, {
      originatingMessageIds: ['m1'],
      completedEffects: [{ toolName: 'create_task' }],
      replyTarget,
      finishedAt: Date.now(),
    })
    const processCalls: ProcessCall[] = []
    const { reply, buttonCalls } = buildCapturingReply()
    const { observer, facts } = recordFacts()
    const edited: IncomingMessage = {
      ...createDmMessage('w2-adj-facts-user'),
      text: 'do better thing',
      messageId: 'm1',
      editedAt: 2,
    }
    await onIncomingEdit(chat, edited, reply, {
      processMessage: buildProcessSpy(processCalls),
      analyticsObserver: observer,
    })
    const adjustButton = buttonCalls[0]!.options.buttons!.find((b) => b.callbackData.startsWith('edit:adjust:'))!
    const prompt = peekEditPrompt(adjustButton.callbackData.replace('edit:adjust:', ''))
    expect(prompt).toBeDefined()
    await prompt!.onAdjust()
    const regenFacts = facts.filter((fact): fact is EditRegenFact => fact.type === 'edit_regen')
    expect(regenPhases(facts)).toEqual(['prompt_shown', 'prompt_adjust', 'regen_started', 'regen_completed'])
    const completed = regenFacts[3]!
    expect(completed.durationMs).toBeDefined()
    expect(Number.isInteger(completed.durationMs)).toBe(true)
    expect(completed.durationMs).toBeGreaterThanOrEqual(0)
  })

  test('adjust without a wired processMessage emits history_only (no regen_started)', async () => {
    const ctxId = scopedDm('w2-adj-noproc-user')
    addUser({ userId: 'w2-adj-noproc-user', platformInstanceId: PLATFORM_ID, addedBy: ADMIN_ID })
    const original: IncomingMessage = { ...createDmMessage('w2-adj-noproc-user'), text: 'do thing', messageId: 'm1' }
    cacheObservedIncomingMessage(original, authFor(ctxId))
    await flushPendingWrites()
    appendHistory(ctxId, [makeUserTurn('m1', 'do thing')])
    const replyTarget: ReplyTarget = { platform: 'telegram', ref: { messageId: 7 } }
    lastTurnRegistry.record(ctxId, {
      originatingMessageIds: ['m1'],
      completedEffects: [{ toolName: 'create_task' }],
      replyTarget,
      finishedAt: Date.now(),
    })
    const { reply, buttonCalls } = buildCapturingReply()
    const { observer, facts } = recordFacts()
    const edited: IncomingMessage = {
      ...createDmMessage('w2-adj-noproc-user'),
      text: 'do better thing',
      messageId: 'm1',
      editedAt: 2,
    }
    await onIncomingEdit(chat, edited, reply, {
      analyticsObserver: observer,
    })
    const adjustButton = buttonCalls[0]!.options.buttons!.find((b) => b.callbackData.startsWith('edit:adjust:'))!
    const prompt = peekEditPrompt(adjustButton.callbackData.replace('edit:adjust:', ''))
    expect(prompt).toBeDefined()
    await prompt!.onAdjust()
    expect(regenPhases(facts)).toEqual(['prompt_shown', 'prompt_adjust', 'history_only'])
    expect(regenPhases(facts)).not.toContain('regen_started')
  })

  test('note emits prompt_note and never regens', async () => {
    const ctxId = scopedDm('w2-note-facts-user')
    addUser({ userId: 'w2-note-facts-user', platformInstanceId: PLATFORM_ID, addedBy: ADMIN_ID })
    const original: IncomingMessage = { ...createDmMessage('w2-note-facts-user'), text: 'do thing', messageId: 'm1' }
    cacheObservedIncomingMessage(original, authFor(ctxId))
    await flushPendingWrites()
    appendHistory(ctxId, [makeUserTurn('m1', 'do thing')])
    lastTurnRegistry.record(ctxId, {
      originatingMessageIds: ['m1'],
      completedEffects: [{ toolName: 'create_task' }],
      replyTarget: undefined,
      finishedAt: Date.now(),
    })
    const processCalls: ProcessCall[] = []
    const { reply, buttonCalls } = buildCapturingReply()
    const { observer, facts } = recordFacts()
    const edited: IncomingMessage = {
      ...createDmMessage('w2-note-facts-user'),
      text: 'do better thing',
      messageId: 'm1',
      editedAt: 2,
    }
    await onIncomingEdit(chat, edited, reply, {
      processMessage: buildProcessSpy(processCalls),
      analyticsObserver: observer,
    })
    const noteButton = buttonCalls[0]!.options.buttons!.find((b) => b.callbackData.startsWith('edit:note:'))!
    const prompt = peekEditPrompt(noteButton.callbackData.replace('edit:note:', ''))
    expect(prompt).toBeDefined()
    await prompt!.onNote()
    expect(processCalls.length).toBe(0)
    expect(regenPhases(facts)).toEqual(['prompt_shown', 'prompt_note'])
  })

  test('a processMessage failure emits regen_failed with durationMs and rethrows', async () => {
    const ctxId = scopedDm('w2-fail-user')
    addUser({ userId: 'w2-fail-user', platformInstanceId: PLATFORM_ID, addedBy: ADMIN_ID })
    const original: IncomingMessage = { ...createDmMessage('w2-fail-user'), text: 'hello', messageId: 'm1' }
    cacheObservedIncomingMessage(original, authFor(ctxId))
    await flushPendingWrites()
    appendHistory(ctxId, [makeUserTurn('m1', 'hello')])
    lastTurnRegistry.record(ctxId, {
      originatingMessageIds: ['m1'],
      completedEffects: [],
      replyTarget: undefined,
      finishedAt: Date.now(),
    })
    const { reply } = buildCapturingReply()
    const { observer, facts } = recordFacts()
    const failing: ProcessMessageFn = () => Promise.reject(new Error('llm boom'))
    const edited: IncomingMessage = { ...createDmMessage('w2-fail-user'), text: 'hi', messageId: 'm1', editedAt: 2 }
    await expect(
      onIncomingEdit(chat, edited, reply, { processMessage: failing, analyticsObserver: observer }),
    ).rejects.toThrow('llm boom')
    const regenFacts = facts.filter((fact): fact is EditRegenFact => fact.type === 'edit_regen')
    expect(regenPhases(facts)).toEqual(['regen_started', 'regen_failed'])
    const failed = regenFacts[1]!
    expect(failed.durationMs).toBeDefined()
    expect(Number.isInteger(failed.durationMs)).toBe(true)
  })

  test('no-buttons platform emits history_only and no prompt_shown', async () => {
    const ctxId = scopedDm('w2-nobtn-user')
    addUser({ userId: 'w2-nobtn-user', platformInstanceId: PLATFORM_ID, addedBy: ADMIN_ID })
    const original: IncomingMessage = { ...createDmMessage('w2-nobtn-user'), text: 'do thing', messageId: 'm1' }
    cacheObservedIncomingMessage(original, authFor(ctxId))
    await flushPendingWrites()
    appendHistory(ctxId, [makeUserTurn('m1', 'do thing')])
    lastTurnRegistry.record(ctxId, {
      originatingMessageIds: ['m1'],
      completedEffects: [{ toolName: 'create_task' }],
      replyTarget: undefined,
      finishedAt: Date.now(),
    })
    const { reply } = buildCapturingReply()
    const noButtons: ReplyFn = {
      ...reply,
      buttons: (): Promise<undefined> => Promise.reject(new Error('platform has no buttons')),
    }
    const { observer, facts } = recordFacts()
    const edited: IncomingMessage = {
      ...createDmMessage('w2-nobtn-user'),
      text: 'do better thing',
      messageId: 'm1',
      editedAt: 2,
    }
    await onIncomingEdit(chat, edited, noButtons, { processMessage: buildProcessSpy([]), analyticsObserver: observer })
    expect(regenPhases(facts)).toEqual(['history_only'])
  })
})
