// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Tests for buildTelegramReplyFn factory.
 *
 * The factory is exercised through TelegramChatProvider (which owns the grammy Context)
 * to avoid having to construct a full grammy Context in tests. Behaviour assertions about
 * ephemeralConfirm / callbackAnswerState live in the TelegramChatProvider suite
 * (tests/chat/telegram/index.test.ts).  Here we cover the structural contract of the
 * exported types and the factory's allowReplacement branching via the provider.
 */

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { TelegramChatProvider } from '../../../src/chat/telegram/index.js'
import type { CallbackAnswerState } from '../../../src/chat/telegram/reply-fn-builder.js'
import { buildTelegramReplyFn } from '../../../src/chat/telegram/reply-fn-builder.js'
import type { ReplyFn } from '../../../src/chat/types.js'
import { mockLogger } from '../../utils/test-helpers.js'

function isReplyFn(value: unknown): value is ReplyFn {
  return typeof value === 'object' && value !== null && 'text' in value && 'buttons' in value && 'formatted' in value
}

describe('buildTelegramReplyFn', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('is exported from reply-fn-builder', () => {
    expect(typeof buildTelegramReplyFn).toBe('function')
  })

  describe('via TelegramChatProvider (uses real grammy Context)', () => {
    test('does not attach replacement methods on the message path (allowReplacement=false)', () => {
      const provider = new TelegramChatProvider({
        token: 'test-token',
        platformInstanceId: 'telegram-default',
      })
      const buildReplyFn: unknown = Reflect.get(provider, 'buildReplyFn')
      assert(typeof buildReplyFn === 'function', 'buildReplyFn not available')

      const reply: unknown = buildReplyFn.call(provider, {
        chat: { id: 99, type: 'supergroup' },
        message: { message_id: 321, message_thread_id: 123 },
        replyWithChatAction: (): Promise<void> => Promise.resolve(),
        reply: (): Promise<void> => Promise.resolve(),
        replyWithDocument: (): Promise<void> => Promise.resolve(),
        answerCallbackQuery: (): Promise<void> => Promise.resolve(),
        editMessageText: (): Promise<void> => Promise.resolve(),
      })

      assert(isReplyFn(reply), 'Expected a ReplyFn')
      expect(reply.replaceText).toBeUndefined()
      expect(reply.replaceButtons).toBeUndefined()
      expect(reply.ephemeralConfirm).toBeUndefined()
    })

    test('attaches ephemeralConfirm on the callback path (allowReplacement=true)', () => {
      const provider = new TelegramChatProvider({
        token: 'test-token',
        platformInstanceId: 'telegram-default',
      })
      const buildReplyFn: unknown = Reflect.get(provider, 'buildReplyFn')
      assert(typeof buildReplyFn === 'function', 'buildReplyFn not available')

      const reply: unknown = buildReplyFn.call(provider, {
        chat: { id: 99, type: 'supergroup' },
        message: { message_id: 321, message_thread_id: 123 },
        replyWithChatAction: (): Promise<void> => Promise.resolve(),
        reply: (): Promise<void> => Promise.resolve(),
        replyWithDocument: (): Promise<void> => Promise.resolve(),
        answerCallbackQuery: (): Promise<void> => Promise.resolve(),
        editMessageText: (): Promise<void> => Promise.resolve(),
      })

      assert(isReplyFn(reply), 'Expected a ReplyFn')
      // Default call (allowReplacement=false) — no ephemeralConfirm
      const replyWithReplacement: unknown = buildReplyFn.call(
        provider,
        {
          chat: { id: 99, type: 'supergroup' },
          message: { message_id: 321, message_thread_id: 123 },
          replyWithChatAction: (): Promise<void> => Promise.resolve(),
          reply: (): Promise<void> => Promise.resolve(),
          replyWithDocument: (): Promise<void> => Promise.resolve(),
          answerCallbackQuery: (): Promise<void> => Promise.resolve(),
          editMessageText: (): Promise<void> => Promise.resolve(),
        },
        undefined,
        true,
      )

      assert(isReplyFn(replyWithReplacement), 'Expected a ReplyFn with replacement methods')
      expect(typeof replyWithReplacement.ephemeralConfirm).toBe('function')
    })

    test('ephemeralConfirm marks callbackAnswerState.answered on success', async () => {
      const provider = new TelegramChatProvider({
        token: 'test-token',
        platformInstanceId: 'telegram-default',
      })
      const buildReplyFn: unknown = Reflect.get(provider, 'buildReplyFn')
      assert(typeof buildReplyFn === 'function', 'buildReplyFn not available')

      const state: CallbackAnswerState = { answered: false }
      const reply: unknown = buildReplyFn.call(
        provider,
        {
          chat: { id: 99, type: 'supergroup' },
          message: { message_id: 321 },
          replyWithChatAction: (): Promise<void> => Promise.resolve(),
          reply: (): Promise<void> => Promise.resolve(),
          replyWithDocument: (): Promise<void> => Promise.resolve(),
          answerCallbackQuery: (): Promise<void> => Promise.resolve(),
          editMessageText: (): Promise<void> => Promise.resolve(),
        },
        undefined,
        true,
        state,
      )

      assert(isReplyFn(reply), 'Expected a ReplyFn with replacement methods')
      assert(reply.ephemeralConfirm !== undefined, 'Expected ephemeralConfirm to be attached')

      await reply.ephemeralConfirm('Done ✅')

      expect(state.answered).toBe(true)
    })
  })
})
