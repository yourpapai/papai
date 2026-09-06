// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'
import assert from 'node:assert/strict'

import type { TelegramBotEditApi } from '../../../src/chat/telegram/prompt-handle-builder.js'
import { buildTelegramReplyFn } from '../../../src/chat/telegram/reply-fn-builder.js'
import type { ReplyFn, ReplyTarget } from '../../../src/chat/types.js'
import { scenario } from '../harness/scenario.js'

type EditCall = { chatId: number; messageId: number; text: string; other: unknown }

type ReplyCall = { text: string; options: Record<string, unknown> }

type FakeCtx = Record<string, unknown>

function isReplyFn(value: unknown): value is ReplyFn {
  return typeof value === 'object' && value !== null && 'formatted' in value && 'buttons' in value
}

function buildReply(ctx: FakeCtx, api: TelegramBotEditApi): ReplyFn {
  const reply: unknown = Reflect.apply(buildTelegramReplyFn, undefined, [ctx, undefined, false, api])
  assert(isReplyFn(reply), 'buildTelegramReplyFn did not return a ReplyFn')
  return reply
}

scenario('SCN-chat-telegram-reply-fn: formatted reply, link-preview disable, and edit-target capture', async () => {
  const replyCalls: ReplyCall[] = []
  const editCalls: EditCall[] = []

  const ctx: FakeCtx = {
    chat: { id: 42, type: 'private' },
    message: { message_id: 100 },
    reply: (text: string, options: Record<string, unknown>): Promise<{ message_id: number; chat: { id: number } }> => {
      replyCalls.push({ text, options })
      return Promise.resolve({ message_id: 200, chat: { id: 42 } })
    },
    replyWithChatAction: (): Promise<void> => Promise.resolve(),
  }

  const api: TelegramBotEditApi = {
    editMessageText: (chatId, messageId, text, other): Promise<unknown> => {
      editCalls.push({ chatId, messageId, text, other })
      return Promise.resolve()
    },
    deleteMessage: (): Promise<unknown> => Promise.resolve(),
  }

  const reply = buildReply(ctx, api)

  await reply.formatted('**Hello** world', { disableLinkPreview: true })

  expect(replyCalls).toHaveLength(1)
  expect(replyCalls[0]?.text).toBe('Hello world')
  expect(replyCalls[0]?.options).toHaveProperty('link_preview_options.is_disabled', true)
  expect(replyCalls[0]?.options['entities']).toEqual(
    expect.arrayContaining([expect.objectContaining({ type: 'bold', offset: 0, length: 5 })]),
  )

  if (reply.lastReplyTarget === undefined) throw new Error('lastReplyTarget is not attached')
  const target: ReplyTarget | undefined = reply.lastReplyTarget()
  expect(target).toEqual({ platform: 'telegram', ref: { messageId: 200, chatId: 42 } })

  if (reply.editReply === undefined) throw new Error('editReply is not attached')
  await reply.editReply(target!, '**Updated**')

  expect(editCalls).toHaveLength(1)
  expect(editCalls[0]?.chatId).toBe(42)
  expect(editCalls[0]?.messageId).toBe(200)
  expect(editCalls[0]?.text).toBe('Updated')
  expect(editCalls[0]?.other).toHaveProperty('entities')

  // Over-limit answers deliver as ordered in-bounds chunks, and the edit target
  // snapshots the last chunk's message.
  const chunkedCalls: ReplyCall[] = []
  const chunkedCtx: FakeCtx = {
    chat: { id: 42, type: 'private' },
    message: { message_id: 100 },
    reply: (text: string, options: Record<string, unknown>): Promise<{ message_id: number; chat: { id: number } }> => {
      chunkedCalls.push({ text, options })
      return Promise.resolve({ message_id: 400 + chunkedCalls.length, chat: { id: 42 } })
    },
    replyWithChatAction: (): Promise<void> => Promise.resolve(),
  }
  const chunkedReply = buildReply(chunkedCtx, api)

  const longAnswer = 'x'.repeat(5000)
  await chunkedReply.formatted(longAnswer)

  expect(chunkedCalls.length).toBe(2)
  for (const call of chunkedCalls) {
    expect(call.text.length).toBeLessThanOrEqual(4096)
  }
  expect(chunkedCalls.map((call) => call.text).join('')).toBe(longAnswer)
  if (chunkedReply.lastReplyTarget === undefined) throw new Error('lastReplyTarget is not attached')
  const chunkedTarget: ReplyTarget | undefined = chunkedReply.lastReplyTarget()
  expect(chunkedTarget).toEqual({ platform: 'telegram', ref: { messageId: 402, chatId: 42 } })

  const handle = await reply.buttons('Allow?', {
    buttons: [{ text: 'Yes', callbackData: 'perm:a:1' }],
  })
  expect(handle).toBeDefined()

  const deleteCalls: Array<[number, number]> = []
  const trackingApi: TelegramBotEditApi = {
    editMessageText: (c, m, t): Promise<unknown> => {
      editCalls.push({ chatId: c, messageId: m, text: t, other: undefined })
      return Promise.resolve()
    },
    deleteMessage: (c, m): Promise<unknown> => {
      deleteCalls.push([c, m])
      return Promise.resolve()
    },
  }

  const promptCtx: FakeCtx = {
    chat: { id: 77, type: 'private' },
    message: { message_id: 300 },
    reply: (): Promise<{ message_id: number; chat: { id: number } }> =>
      Promise.resolve({ message_id: 999, chat: { id: 77 } }),
    replyWithChatAction: (): Promise<void> => Promise.resolve(),
  }
  const promptReply = buildReply(promptCtx, trackingApi)
  const promptHandle = await promptReply.buttons('Confirm?', {
    buttons: [{ text: 'OK', callbackData: 'perm:a:2' }],
  })

  await promptHandle?.redact('Expired')
  expect(editCalls.at(-1)).toMatchObject({ chatId: 77, messageId: 999, text: 'Expired' })

  await promptHandle?.remove()
  expect(deleteCalls).toEqual([[77, 999]])
})
