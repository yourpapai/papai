// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { generateText, stepCountIs } from 'ai'
import type { ModelMessage } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'

import { getThreadScopedStorageContextId } from '../../src/auth.js'
import { cacheObservedIncomingMessage } from '../../src/bot-message-caching.js'
import type { AuthorizationResult, IncomingMessage } from '../../src/chat/types.js'
import { appendHistory, loadHistory } from '../../src/history.js'
import type { LlmOrchestratorDeps } from '../../src/llm-orchestrator-types.js'
import { defaultDeps, processMessage, resetBotMisconfiguredNotifiedForTesting } from '../../src/llm-orchestrator.js'
import { onIncomingEdit } from '../../src/message-edit/handle.js'
import { lastTurnRegistry } from '../../src/run-control/last-turn-registry.js'
import { runRegistry } from '../../src/run-control/registry.js'
import { addUser } from '../../src/users.js'
import {
  createDmMessage,
  createMockChat,
  flushPendingWrites,
  mockLogger,
  seedAdminLlmBinding,
  seedCommonTestPlatformInstances,
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

// A bare mock model: the stubbed generateText never actually drives it, but the
// precomputed okResult must come from a real generateText call so its shape is
// fully typed. The text content makes the regenerated assistant turn recognizable.
const mockModel = new MockLanguageModelV3({
  doGenerate: {
    content: [{ type: 'text', text: 'fresh regen answer' }],
    finishReason: { unified: 'stop', raw: undefined } as const,
    usage: {
      inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 0, text: 0, reasoning: 0 },
    },
    warnings: [],
  },
})

type GenerateResult = Awaited<ReturnType<LlmOrchestratorDeps['generateText']>>
const okResult: GenerateResult = await generateText({ model: mockModel, prompt: 'hi' })

// Stub orchestrator deps: providerless turn, canned assistant message, no network.
const stubDeps: LlmOrchestratorDeps = {
  generateText: () => Promise.resolve(okResult),
  stepCountIs: (...args) => stepCountIs(...args),
  buildModel: () => mockModel,
  resolve: () => null,
  maybeAutoProvision: () => Promise.resolve(false),
}

describe('W2 regeneration — real processMessage integration', () => {
  let chat: ReturnType<typeof createMockChat>
  let savedGenerateText: LlmOrchestratorDeps['generateText']
  let savedBuildModel: LlmOrchestratorDeps['buildModel']
  let savedResolve: LlmOrchestratorDeps['resolve']
  let savedMaybeAutoProvision: LlmOrchestratorDeps['maybeAutoProvision']

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
    seedAdminLlmBinding()
    addUser({ userId: ADMIN_ID, platformInstanceId: PLATFORM_ID, addedBy: 'system' })
    runRegistry.clear()
    lastTurnRegistry.clear()
    resetBotMisconfiguredNotifiedForTesting()
    chat = createMockChat()
    // regenerateFromEditedText builds orchestrator deps from the defaultDeps
    // singleton, so override its fields here (restored in afterEach).
    savedGenerateText = defaultDeps.generateText
    savedBuildModel = defaultDeps.buildModel
    savedResolve = defaultDeps.resolve
    savedMaybeAutoProvision = defaultDeps.maybeAutoProvision
    Object.assign(defaultDeps, stubDeps)
  })

  afterEach(() => {
    defaultDeps.generateText = savedGenerateText
    defaultDeps.buildModel = savedBuildModel
    defaultDeps.resolve = savedResolve
    defaultDeps.maybeAutoProvision = savedMaybeAutoProvision
    runRegistry.clear()
    lastTurnRegistry.clear()
  })

  test('regeneration replaces the prior turn instead of duplicating it', async () => {
    const ctxId = scopedDm('w2-integ-user')
    addUser({ userId: 'w2-integ-user', platformInstanceId: PLATFORM_ID, addedBy: ADMIN_ID })

    // Seed a completed turn: the originating user message + its assistant reply.
    const original: IncomingMessage = {
      ...createDmMessage('w2-integ-user'),
      text: 'hello',
      messageId: 'm1',
    }
    cacheObservedIncomingMessage(original, authFor(ctxId))
    await flushPendingWrites()
    appendHistory(ctxId, [makeUserTurn('m1', 'hello'), { role: 'assistant', content: 'old answer' } as ModelMessage])

    lastTurnRegistry.record(ctxId, {
      originatingMessageIds: ['m1'],
      completedEffects: [],
      replyTarget: { platform: 'telegram', ref: { messageId: 99, chatId: 1 } },
      finishedAt: Date.now(),
    })

    const { reply } = createMockReplyForEdit()

    const edited: IncomingMessage = {
      ...createDmMessage('w2-integ-user'),
      text: 'hello (edited)',
      messageId: 'm1',
      editedAt: 2,
    }
    // Inject the REAL production processMessage — not a spy. Its orchestrator
    // deps come from the (stub-overridden) defaultDeps singleton.
    await onIncomingEdit(chat, edited, reply, { processMessage })

    const history = loadHistory(ctxId)
    const users = history.filter((m) => m.role === 'user')
    const assistants = history.filter((m) => m.role === 'assistant')

    // The prior turn (rewritten user + stale assistant) must be trimmed, and the
    // fresh turn re-created: exactly one user + one assistant. The old buggy
    // shape was [user(edited), assistant(old), user(edited), assistant(new)].
    expect(history.length).toBe(2)
    expect(users.length).toBe(1)
    expect(assistants.length).toBe(1)
    expect(JSON.stringify(users[0]!.content)).toContain('hello (edited)')
    // Stale assistant reply must be gone, fresh answer present.
    expect(history.some((m) => JSON.stringify(m.content).includes('old answer'))).toBe(false)
    expect(JSON.stringify(assistants[0]!.content)).toContain('fresh regen answer')
  })
})

function createMockReplyForEdit(): { reply: Parameters<typeof onIncomingEdit>[2] } {
  const reply = {
    text: (): Promise<void> => Promise.resolve(),
    formatted: (): Promise<void> => Promise.resolve(),
    typing: (): void => {},
    buttons: (): Promise<undefined> => Promise.resolve(undefined),
    editReply: (): Promise<void> => Promise.resolve(),
  }
  return { reply }
}
