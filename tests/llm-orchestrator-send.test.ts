// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { ModelMessage } from 'ai'

import type { ReplyTarget } from '../src/chat/types.js'
import type { VerifierPrompt } from '../src/completion/verified-completion.js'
import { setConfigValue } from '../src/config.js'
import { runRegistry } from '../src/run-control/registry.js'
import { createTrackedLoggerMock } from './utils/logger-mock.js'
import { createMockReply, mockLogger, setupTestDb } from './utils/test-helpers.js'

const tracked = createTrackedLoggerMock()
void mock.module('../src/logger.js', () => ({ logger: tracked.logger, getLogLevel: tracked.getLogLevel }))

// src/llm-orchestrator-send.ts binds `logger.child({ scope })` at module-eval time and the
// preload graph evaluates it with the real logger, so force a fresh evaluation under the
// tracked mock with a cache-busting query (mirrors tests/history.test.ts).
type SendModule = typeof import('../src/llm-orchestrator-send.js')
const isSendModule = (value: unknown): value is SendModule =>
  typeof value === 'object' && value !== null && typeof Reflect.get(value, 'sendLlmResponse') === 'function'
const loadedSend: unknown = await import(`../src/llm-orchestrator-send.js?t=${crypto.randomUUID()}`)
if (!isSendModule(loadedSend)) {
  throw new Error('send module did not export expected shape')
}
const { sendLlmResponse } = loadedSend

const baseResult = {
  text: undefined as string | undefined,
  finishReason: 'stop' as string | undefined,
  toolCalls: [] as unknown[],
  finalStep: { response: { messages: [] as ModelMessage[] } },
}

beforeEach(async () => {
  await setupTestDb()
})

describe('sendLlmResponse verification wiring', () => {
  test('risky turn (empty text) invokes the verifier and delivers its text', async () => {
    mockLogger()
    const reply = createMockReply()
    let invoked = 0
    await sendLlmResponse(reply.reply, 'ctx-1', { ...baseResult }, undefined, {
      history: [],
      verifier: {
        readOnlyToolset: undefined,
        invokeVerifier: (): Promise<{ text: string | undefined }> => {
          invoked += 1
          return Promise.resolve({ text: 'Created task TK-42.' })
        },
      },
    })
    expect(invoked).toBe(1)
    expect(reply.textCalls).toContain('Created task TK-42.')
  })

  test('normal turn (confident text) does NOT invoke the verifier', async () => {
    mockLogger()
    const reply = createMockReply()
    let invoked = 0
    await sendLlmResponse(reply.reply, 'ctx-1', { ...baseResult, text: 'All set — moved to Done.' }, undefined, {
      history: [],
      verifier: {
        readOnlyToolset: undefined,
        invokeVerifier: (): Promise<{ text: string | undefined }> => {
          invoked += 1
          return Promise.resolve({ text: 'should not be used' })
        },
      },
    })
    expect(invoked).toBe(0)
    expect(reply.textCalls).toContain('All set — moved to Done.')
  })

  test('risky turn in a ru context gets the ru verifier prompt and no-op fallback', async () => {
    mockLogger()
    setConfigValue('ctx-ru', 'language', 'ru')
    const reply = createMockReply()
    const prompts: VerifierPrompt[] = []
    await sendLlmResponse(reply.reply, 'ctx-ru', { ...baseResult }, undefined, {
      history: [],
      verifier: {
        readOnlyToolset: undefined,
        invokeVerifier: (prompt: VerifierPrompt): Promise<{ text: string | undefined }> => {
          prompts.push(prompt)
          return Promise.resolve({ text: undefined })
        },
      },
    })
    expect(prompts[0]?.system).toContain('Отвечай на русском языке')
    expect(reply.textCalls).toContain(
      'Похоже, в этот раз я ничего не выполнил — ход прервался. Пожалуйста, повтори запрос.',
    )
  })

  test('turn with executed tools gets the neutral fallback, not the no-op message', async () => {
    mockLogger()
    const reply = createMockReply()
    await sendLlmResponse(
      reply.reply,
      'ctx-1',
      {
        ...baseResult,
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
      undefined,
      {
        history: [],
        verifier: {
          readOnlyToolset: undefined,
          invokeVerifier: (): Promise<{ text: string | undefined }> => Promise.resolve({ text: undefined }),
        },
      },
    )
    expect(reply.textCalls).toContain(
      'I ran the requested actions but could not confirm the result — please double-check.',
    )
  })

  test('a failing verifier on a risky turn with model text delivers the model text', async () => {
    mockLogger()
    const reply = createMockReply()
    const modelText = 'Task TK-42 updated; TK-43 still pending.'
    await sendLlmResponse(
      reply.reply,
      'ctx-1',
      { ...baseResult, text: modelText, finishReason: 'tool-calls' },
      undefined,
      {
        history: [],
        verifier: {
          readOnlyToolset: undefined,
          invokeVerifier: (): Promise<{ text: string | undefined }> => Promise.resolve({ text: '' }),
        },
      },
    )
    expect(reply.textCalls).toContain(modelText)
    expect(reply.textCalls).not.toContain(
      'I ran the requested actions but could not confirm the result — please double-check.',
    )
  })

  test('empty-text turn without a verifier in a ru context gets the localized done fallback', async () => {
    mockLogger()
    setConfigValue('ctx-ru-done', 'language', 'ru')
    const reply = createMockReply()
    await sendLlmResponse(reply.reply, 'ctx-ru-done', { ...baseResult }, undefined)
    expect(reply.textCalls).toContain('Готово.')
  })
})

describe('sendLlmResponse beforeFirstMessage (live-status placeholder dismissal)', () => {
  test('normal turn: placeholder is dismissed immediately before the first reply message', async () => {
    mockLogger()
    const order: string[] = []
    const reply = createMockReply()
    const formatted = reply.reply.formatted
    reply.reply.formatted = (content: string): Promise<void> => {
      order.push('reply')
      return formatted(content)
    }
    await sendLlmResponse(reply.reply, 'ctx-1', { ...baseResult, text: 'All set.' }, undefined, undefined, () => {
      order.push('dismiss')
      return Promise.resolve()
    })
    // Placeholder dismissed first, then the real answer posts — no visible gap, no lost placeholder.
    expect(order).toEqual(['dismiss', 'reply'])
    expect(reply.textCalls).toContain('All set.')
  })

  test('risky turn: placeholder survives the verification round-trip and is dismissed just before the reply', async () => {
    mockLogger()
    const order: string[] = []
    const reply = createMockReply()
    const formatted = reply.reply.formatted
    reply.reply.formatted = (content: string): Promise<void> => {
      order.push('reply')
      return formatted(content)
    }
    await sendLlmResponse(
      reply.reply,
      'ctx-1',
      { ...baseResult },
      undefined,
      {
        history: [],
        verifier: {
          readOnlyToolset: undefined,
          invokeVerifier: (): Promise<{ text: string | undefined }> => {
            order.push('verify')
            return Promise.resolve({ text: 'Created task TK-42.' })
          },
        },
      },
      () => {
        order.push('dismiss')
        return Promise.resolve()
      },
    )
    // The placeholder stays up through the verifier call, then is dismissed right before the reply posts.
    expect(order).toEqual(['verify', 'dismiss', 'reply'])
    expect(reply.textCalls).toContain('Created task TK-42.')
  })
})

describe('sendLlmResponse reply-target capture', () => {
  beforeEach(() => {
    mockLogger()
    runRegistry.clear()
  })

  test('records the adapter lastReplyTarget onto the active run after posting', async () => {
    const target: ReplyTarget = { platform: 'telegram', ref: { messageId: 42, chatId: 7 } }
    const reply = createMockReply()
    reply.reply.lastReplyTarget = (): ReplyTarget | undefined => target

    runRegistry.begin('ctx-target', {
      turnId: 'turn-1',
      reply: reply.reply,
      originatingMessageIds: [],
    })

    await sendLlmResponse(reply.reply, 'ctx-target', { ...baseResult, text: 'Done.' }, undefined)

    const run = runRegistry.get('ctx-target')
    expect(run).toBeDefined()
    expect(run!.replyTarget).toBe(target)
  })

  test('leaves replyTarget undefined when the adapter exposes no lastReplyTarget', async () => {
    const reply = createMockReply()
    runRegistry.begin('ctx-no-target', {
      turnId: 'turn-2',
      reply: reply.reply,
      originatingMessageIds: [],
    })

    await sendLlmResponse(reply.reply, 'ctx-no-target', { ...baseResult, text: 'Done.' }, undefined)

    expect(runRegistry.get('ctx-no-target')!.replyTarget).toBeUndefined()
  })
})

describe('sendLlmResponse send logging', () => {
  type SendLogMeta = { sentTextLength: number; modelTextLength: number }

  const isSendLogMeta = (value: unknown): value is SendLogMeta =>
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'sentTextLength') === 'number' &&
    typeof Reflect.get(value, 'modelTextLength') === 'number'

  const findLogMeta = (level: 'info' | 'warn', message: string): SendLogMeta | undefined => {
    const call = tracked.getCallsByLevel(level).find((entry) => entry.args[1] === message)
    return call !== undefined && isSendLogMeta(call.args[0]) ? call.args[0] : undefined
  }

  beforeEach(() => {
    tracked.clearCalls()
  })

  test('send log reports the delivered length and the model text length', async () => {
    mockLogger()
    const reply = createMockReply()
    const modelText = 'All set — moved to Done.'
    await sendLlmResponse(reply.reply, 'ctx-log-1', { ...baseResult, text: modelText }, undefined)
    expect(reply.textCalls).toContain(modelText)

    const meta = findLogMeta('info', 'Response sent successfully')
    expect(meta).toBeDefined()
    expect(meta?.sentTextLength).toBe(modelText.length)
    expect(meta?.modelTextLength).toBe(modelText.length)
  })

  test('a verifier-delivered long reply logs the delivered length and a zero model text length', async () => {
    mockLogger()
    const reply = createMockReply()
    const verifierText = `Completed. ${'Details follow. '.repeat(75)}`.trimEnd()
    await sendLlmResponse(reply.reply, 'ctx-log-2', { ...baseResult }, undefined, {
      history: [],
      verifier: {
        readOnlyToolset: undefined,
        invokeVerifier: (): Promise<{ text: string | undefined }> => Promise.resolve({ text: verifierText }),
      },
    })
    expect(reply.textCalls).toContain(verifierText)

    const meta = findLogMeta('info', 'Response sent successfully')
    expect(meta).toBeDefined()
    expect(meta?.sentTextLength).toBe(verifierText.length)
    expect(meta?.sentTextLength).toBeGreaterThan(1000)
    expect(meta?.modelTextLength).toBe(0)
  })

  test('the step-cap warn carries the same delivered and model text lengths', async () => {
    mockLogger()
    const reply = createMockReply()
    await sendLlmResponse(reply.reply, 'ctx-log-3', { ...baseResult, finishReason: 'tool-calls' }, undefined)

    const meta = findLogMeta(
      'warn',
      'LLM turn ended on a pending tool call (step cap reached); reply may be incomplete',
    )
    expect(meta).toBeDefined()
    expect(meta?.sentTextLength).toBe('Done.'.length)
    expect(meta?.modelTextLength).toBe(0)
  })
})
