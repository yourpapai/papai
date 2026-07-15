// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { dmTarget } from '../../../src/chat/deferred-target.js'
import { setTelegramReaction } from '../../../src/chat/telegram/reactions.js'

interface ReactionCall {
  chatId: unknown
  messageId: unknown
  reaction: unknown
}

function fakeApi(): { setMessageReaction: (...args: unknown[]) => Promise<true>; calls: ReactionCall[] } {
  const calls: ReactionCall[] = []
  return {
    calls,
    setMessageReaction: (chatId: unknown, messageId: unknown, reaction: unknown): Promise<true> => {
      calls.push({ chatId, messageId, reaction })
      return Promise.resolve(true)
    },
  }
}

const target = dmTarget('99')

describe('setTelegramReaction', () => {
  test('translates a canonical status emoji to a valid Telegram reaction (✅ → 🎉)', async () => {
    const api = fakeApi()
    const ok = await setTelegramReaction(api, target, '7', '✅')
    expect(ok).toBe(true)
    expect(api.calls).toHaveLength(1)
    expect(api.calls[0]?.chatId).toBe(99)
    expect(api.calls[0]?.messageId).toBe(7)
    expect(api.calls[0]?.reaction).toEqual([{ type: 'emoji', emoji: '🎉' }])
  })

  test('translates ⏳ → 👨‍💻', async () => {
    const api = fakeApi()
    await setTelegramReaction(api, target, '7', '⏳')
    expect(api.calls[0]?.reaction).toEqual([{ type: 'emoji', emoji: '👨‍💻' }])
  })

  test('translates ❌ → 👎', async () => {
    const api = fakeApi()
    await setTelegramReaction(api, target, '7', '❌')
    expect(api.calls[0]?.reaction).toEqual([{ type: 'emoji', emoji: '👎' }])
  })

  test('translates 🚫 → 🤷', async () => {
    const api = fakeApi()
    await setTelegramReaction(api, target, '7', '🚫')
    expect(api.calls[0]?.reaction).toEqual([{ type: 'emoji', emoji: '🤷' }])
  })

  test('👀 is already a valid Telegram reaction and passes through unchanged', async () => {
    const api = fakeApi()
    await setTelegramReaction(api, target, '7', '👀')
    expect(api.calls[0]?.reaction).toEqual([{ type: 'emoji', emoji: '👀' }])
  })

  test('null still clears the reaction with an empty array', async () => {
    const api = fakeApi()
    const ok = await setTelegramReaction(api, target, '7', null)
    expect(ok).toBe(true)
    expect(api.calls[0]?.reaction).toEqual([])
  })

  test('an unmapped emoji falls through to the raw value', async () => {
    const api = fakeApi()
    await setTelegramReaction(api, target, '7', '🔥')
    expect(api.calls[0]?.reaction).toEqual([{ type: 'emoji', emoji: '🔥' }])
  })

  test('returns false for a non-numeric messageId without calling the API', async () => {
    const api = fakeApi()
    const ok = await setTelegramReaction(api, target, 'not-a-number', '✅')
    expect(ok).toBe(false)
    expect(api.calls).toHaveLength(0)
  })

  test('is best-effort: a throwing API call returns false instead of throwing', async () => {
    const api = {
      setMessageReaction: (): Promise<never> => Promise.reject(new Error('rejected by Telegram')),
    }
    const ok = await setTelegramReaction(api, target, '7', '✅')
    expect(ok).toBe(false)
  })
})
