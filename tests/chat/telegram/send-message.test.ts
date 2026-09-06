// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { TelegramBotApiLike } from '../../../src/chat/telegram/bot-factory.js'
import type { DeferredDeliveryTarget } from '../../../src/chat/types.js'
import { createTrackedLoggerMock } from '../../utils/logger-mock.js'

// send-message.ts binds its child logger at module-eval time, so force a fresh
// evaluation under the tracked mock with a cache-busting query (mirrors
// tests/llm-orchestrator-send.test.ts).
const tracked = createTrackedLoggerMock()
void mock.module('../../../src/logger.js', () => ({ logger: tracked.logger, getLogLevel: tracked.getLogLevel }))

type SendMessageModule = typeof import('../../../src/chat/telegram/send-message.js')
const isSendMessageModule = (value: unknown): value is SendMessageModule =>
  typeof value === 'object' && value !== null && typeof Reflect.get(value, 'sendTelegramMessage') === 'function'
const loadedModule: unknown = await import(`../../../src/chat/telegram/send-message.js?t=${crypto.randomUUID()}`)
if (!isSendMessageModule(loadedModule)) {
  throw new Error('send-message module did not export expected shape')
}
const { sendTelegramMessage } = loadedModule

type SendMessageCall = [chatId: number, text: string, options: { entities: unknown[]; message_thread_id?: number }]

const makeTarget = (overrides: Partial<DeferredDeliveryTarget> = {}): DeferredDeliveryTarget => ({
  contextId: '99',
  contextType: 'group',
  threadId: '123',
  audience: 'personal',
  mentionUserIds: ['42'],
  createdByUserId: '42',
  createdByUsername: 'alice',
  ...overrides,
})

const makeApi = (
  outcomes: ReadonlyArray<'ok' | Error>,
): { api: Pick<TelegramBotApiLike, 'sendMessage'>; calls: SendMessageCall[] } => {
  const calls: SendMessageCall[] = []
  let callIndex = 0
  return {
    calls,
    api: {
      sendMessage: (chatId: number, text: string, options: SendMessageCall[2]): Promise<unknown> => {
        calls.push([chatId, text, options])
        const outcome = outcomes[callIndex]
        callIndex += 1
        if (outcome === undefined) throw new Error(`No scripted send outcome for call ${callIndex}`)
        return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(undefined)
      },
    },
  }
}

describe('sendTelegramMessage', () => {
  beforeEach(() => {
    tracked.clearCalls()
  })

  test('sends a single in-limit message with the mention prefix and shifted entities', async () => {
    const { api, calls } = makeApi(['ok'])

    await sendTelegramMessage(api, makeTarget(), '**hi**')

    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual([
      99,
      '@alice hi',
      {
        entities: [
          { offset: 0, length: 6, type: 'text_mention', user: { id: 42, is_bot: false, first_name: 'alice' } },
          { offset: 7, length: 2, type: 'bold' },
        ],
        message_thread_id: 123,
      },
    ])
  })

  test('chunks over-limit delivery with the mention prefix on the first chunk only', async () => {
    const { api, calls } = makeApi(['ok', 'ok'])

    await sendTelegramMessage(api, makeTarget(), 'x'.repeat(5000))

    expect(calls.length).toBe(2)
    expect(calls[0]![1].startsWith('@alice ')).toBe(true)
    expect(entitiesOf(calls[0]![2])).toContainEqual({
      offset: 0,
      length: 6,
      type: 'text_mention',
      user: { id: 42, is_bot: false, first_name: 'alice' },
    })
    for (const [, text, options] of calls.slice(1)) {
      expect(text.includes('@alice')).toBe(false)
      expect(entitiesOf(options)).toHaveLength(0)
    }
    for (const [, text, options] of calls) {
      expect(text.length).toBeLessThanOrEqual(4096)
      expect(options.message_thread_id).toBe(123)
    }
    const joined = calls.map(([, text]) => text).join('')
    expect(joined.startsWith('@alice ')).toBe(true)
    expect(joined.replace('@alice ', '')).toBe('x'.repeat(5000))
  })

  test('a failing chunk logs a warn and later chunks still send', async () => {
    const { api, calls } = makeApi(['ok', new Error('telegram down'), 'ok'])

    await sendTelegramMessage(api, makeTarget(), 'x'.repeat(9000))

    expect(calls.length).toBe(3)
    const warn = tracked.getCallsByLevel('warn').find((entry) => entry.args[1] === 'Telegram chunk send failed')
    expect(warn).toBeDefined()
  })

  test('rejects with the last chunk error when every chunk fails', async () => {
    const { api, calls } = makeApi([new Error('telegram down'), new Error('telegram down'), new Error('telegram down')])

    await expect(sendTelegramMessage(api, makeTarget(), 'x'.repeat(9000))).rejects.toThrow('telegram down')

    expect(calls.length).toBe(3)
    const warns = tracked.getCallsByLevel('warn').filter((entry) => entry.args[1] === 'Telegram chunk send failed')
    expect(warns).toHaveLength(3)
  })
})

function entitiesOf(options: SendMessageCall[2]): unknown[] {
  return options.entities ?? []
}
