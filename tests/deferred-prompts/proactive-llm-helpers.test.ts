// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import type { DeferredDeliveryTarget } from '../../src/chat/types.js'
import type { VerifierPrompt } from '../../src/completion/verified-completion.js'
import {
  buildMetadataMessages,
  finalizeAndLog,
  finalizeDeliveryText,
  getStorageContextId,
  timezoneOrUtc,
} from '../../src/deferred-prompts/proactive-llm-helpers.js'
import type { ExecutionMetadata } from '../../src/deferred-prompts/types.js'
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
