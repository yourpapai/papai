// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { DeferredDeliveryTarget } from '../../src/chat/types.js'
import type { VerifierPrompt } from '../../src/completion/verified-completion.js'
import type { DebugEvent } from '../../src/debug/event-bus.js'
import { subscribe, unsubscribe } from '../../src/debug/event-bus.js'
import {
  buildMetadataMessages,
  finalizeAndLog,
  finalizeDeliveryText,
  getStorageContextId,
  timezoneOrUtc,
} from '../../src/deferred-prompts/proactive-llm-helpers.js'
import type { ExecutionMetadata } from '../../src/deferred-prompts/types.js'
import { createTrackedLoggerMock } from '../utils/logger-mock.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const dmTarget: DeferredDeliveryTarget = {
  contextId: 'user-1',
  contextType: 'dm',
  threadId: null,
  audience: 'personal',
  mentionUserIds: [],
  createdByUserId: 'user-1',
  createdByUsername: null,
}

describe('proactive-llm-helpers', () => {
  test('uses thread-scoped storage context for group threads', () => {
    expect(
      getStorageContextId({
        ...dmTarget,
        contextId: '-1001',
        contextType: 'group',
        threadId: '42',
      }),
    ).toBe('-1001:42')
  })

  test('uses delivery context id when no group thread exists', () => {
    expect(getStorageContextId(dmTarget)).toBe('user-1')
  })

  test('resolves fallback values without fallback expressions at call sites', () => {
    expect(finalizeDeliveryText({ text: undefined, finishReason: 'stop' })).toBe('Done.')
    expect(finalizeDeliveryText({ text: 'Ready', finishReason: 'stop' })).toBe('Ready')
    expect(timezoneOrUtc(null)).toBe('UTC')
    expect(timezoneOrUtc('Europe/Berlin')).toBe('Europe/Berlin')
  })

  test('drops incomplete text when the turn ended on a pending tool call', () => {
    expect(
      finalizeDeliveryText({
        text: 'Let me first check the current date and time to give you an accurate reminder.',
        finishReason: 'tool-calls',
      }),
    ).toBe('Done.')
  })

  test('treats empty text as the Done fallback', () => {
    expect(finalizeDeliveryText({ text: '', finishReason: 'stop' })).toBe('Done.')
  })

  test('localizes the Done fallback to the turn locale', () => {
    expect(finalizeDeliveryText({ text: undefined, finishReason: 'stop' }, 'ru')).toBe('Готово.')
    expect(finalizeDeliveryText({ text: '', finishReason: 'stop' }, 'ru')).toBe('Готово.')
    expect(finalizeDeliveryText({ text: 'preamble', finishReason: 'tool-calls' }, 'ru')).toBe('Готово.')
  })

  test('builds metadata messages', () => {
    const metadata: ExecutionMetadata = {
      delivery_brief: 'Brief',
      context_snapshot: 'Snapshot',
    }

    expect(buildMetadataMessages(metadata)).toEqual([
      { role: 'system', content: '[DELIVERY BRIEF]\nBrief' },
      { role: 'system', content: '[CONTEXT FROM CREATION TIME]\nSnapshot' },
    ])
  })
})

describe('finalizeAndLog verification', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('empty text + verification → verified text', async () => {
    mockLogger()
    const text = await finalizeAndLog(
      { text: '', finishReason: 'stop', finalStep: { response: { messages: [] } } },
      'user-1',
      {
        history: [],
        verifier: {
          readOnlyToolset: undefined,
          invokeVerifier: (): Promise<{ text: string | undefined }> => Promise.resolve({ text: 'Reminder delivered.' }),
        },
      },
    )
    expect(text).toBe('Reminder delivered.')
  })

  test('ru locale → ru verifier prompt and no-op fallback', async () => {
    mockLogger()
    const prompts: VerifierPrompt[] = []
    const text = await finalizeAndLog(
      { text: '', finishReason: 'stop', finalStep: { response: { messages: [] } } },
      'user-1',
      {
        history: [],
        verifier: {
          readOnlyToolset: undefined,
          invokeVerifier: (prompt: VerifierPrompt): Promise<{ text: string | undefined }> => {
            prompts.push(prompt)
            return Promise.resolve({ text: undefined })
          },
        },
      },
      'ru',
    )
    expect(prompts[0]?.system).toContain('Отвечай на русском языке')
    expect(text).toBe('Похоже, в этот раз я ничего не выполнил — ход прервался. Пожалуйста, повтори запрос.')
  })

  test('executed tools → neutral fallback, not the no-op message', async () => {
    mockLogger()
    const text = await finalizeAndLog(
      {
        text: '',
        finishReason: 'stop',
        steps: [
          {
            response: {
              messages: [
                {
                  role: 'tool',
                  content: [
                    {
                      type: 'tool-result',
                      toolCallId: 'c1',
                      toolName: 'get_task',
                      output: { type: 'json', value: { id: 'TK-1' } },
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
      'user-1',
      {
        history: [],
        verifier: {
          readOnlyToolset: undefined,
          invokeVerifier: (): Promise<{ text: string | undefined }> => Promise.resolve({ text: undefined }),
        },
      },
    )
    expect(text).toBe('I ran the requested actions but could not confirm the result — please double-check.')
  })

  test('a failing verifier on a risky turn with model text delivers the model text', async () => {
    mockLogger()
    const modelText = 'Task TK-42 updated; TK-43 still pending.'
    const text = await finalizeAndLog(
      {
        text: modelText,
        finishReason: 'tool-calls',
        finalStep: { response: { messages: [] } },
      },
      'user-1',
      {
        history: [],
        verifier: {
          readOnlyToolset: undefined,
          invokeVerifier: (): Promise<{ text: string | undefined }> => {
            throw new Error('network')
          },
        },
      },
    )
    expect(text).toBe(modelText)
  })

  test('a verified proactive turn emits llm:verifier with the trace scope, turnId and outcome', async () => {
    mockLogger()
    const events: DebugEvent[] = []
    const listener = (event: DebugEvent): void => {
      events.push(event)
    }
    subscribe(listener)
    try {
      await finalizeAndLog({ text: '', finishReason: 'stop', finalStep: { response: { messages: [] } } }, 'user-1', {
        history: [],
        verifier: {
          readOnlyToolset: undefined,
          invokeVerifier: (): Promise<{ text: string | undefined }> => Promise.resolve({ text: '' }),
        },
        turnId: 'proactive:u:1:1',
        traceScope: 'u:1',
      })
    } finally {
      unsubscribe(listener)
    }
    const event = events.find((entry) => entry.type === 'llm:verifier')
    expect(event).toBeDefined()
    expect(event?.scope).toEqual({ kind: 'user', userId: 'u:1' })
    expect(event?.turnId).toBe('proactive:u:1:1')
    expect(event?.data['verifierOutcome']).toBe('empty')
  })

  test('no verification arg → legacy Done. fallback preserved', async () => {
    mockLogger()
    const text = await finalizeAndLog({ text: '', finishReason: 'stop' }, 'user-1')
    expect(text).toBe('Done.')
  })

  test('no verification arg + ru locale → localized done fallback', async () => {
    mockLogger()
    const text = await finalizeAndLog({ text: '', finishReason: 'stop' }, 'user-1', undefined, 'ru')
    expect(text).toBe('Готово.')
  })
})

// finalizeAndLog binds its child logger at module-eval time, so force a fresh
// evaluation under the tracked mock with a cache-busting query (mirrors
// tests/llm-orchestrator-send.test.ts).
const tracked = createTrackedLoggerMock()
void mock.module('../../src/logger.js', () => ({ logger: tracked.logger, getLogLevel: tracked.getLogLevel }))

type HelpersModule = typeof import('../../src/deferred-prompts/proactive-llm-helpers.js')
const isHelpersModule = (value: unknown): value is HelpersModule =>
  typeof value === 'object' && value !== null && typeof Reflect.get(value, 'finalizeAndLog') === 'function'
const loadedHelpers: unknown = await import(
  `../../src/deferred-prompts/proactive-llm-helpers.js?t=${crypto.randomUUID()}`
)
if (!isHelpersModule(loadedHelpers)) {
  throw new Error('proactive helpers module did not export expected shape')
}
const { finalizeAndLog: bustedFinalizeAndLog } = loadedHelpers

describe('finalizeAndLog verification logging', () => {
  type VerificationLogMeta = { userId: string; verifierOutcome: string; verdict: string }
  const isVerificationLogMeta = (value: unknown): value is VerificationLogMeta =>
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'verifierOutcome') === 'string' &&
    typeof Reflect.get(value, 'verdict') === 'string'

  const findVerificationLog = (): VerificationLogMeta | undefined => {
    const call = tracked.getCallsByLevel('info').find((entry) => entry.args[1] === 'Proactive verification finished')
    return call !== undefined && isVerificationLogMeta(call.args[0]) ? call.args[0] : undefined
  }

  beforeEach(async () => {
    await setupTestDb()
    tracked.clearCalls()
  })

  test('the verification log surfaces the outcome and verdict', async () => {
    mockLogger()
    await bustedFinalizeAndLog(
      { text: '', finishReason: 'stop', finalStep: { response: { messages: [] } } },
      'user-1',
      {
        history: [],
        verifier: {
          readOnlyToolset: undefined,
          invokeVerifier: (): Promise<{ text: string | undefined }> => Promise.resolve({ text: '' }),
        },
        turnId: 'proactive:u:1:2',
        traceScope: 'u:1',
      },
    )
    const meta = findVerificationLog()
    expect(meta).toBeDefined()
    expect(meta?.verifierOutcome).toBe('empty')
    expect(meta?.verdict).toBe('unconfirmed')
  })
})
