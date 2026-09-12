// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Context } from 'grammy'

import type { TelegramBotFactory, TelegramBotLike } from '../../../src/chat/telegram/index.js'

export type CallbackContext = Pick<Context, 'callbackQuery' | 'from' | 'chat' | 'me' | 'answerCallbackQuery'>

export type FakeTelegramBotOptions = {
  getChatMember: (chatId: number, userId: number) => Promise<{ status: string }>
}

export type FakeTelegramBot = {
  bot: TelegramBotLike
  factory: TelegramBotFactory
  membershipCalls(): readonly [number, number][]
  pollingTimer(): object | null
  emitCallback(ctx: CallbackContext): void
  flush(): Promise<void>
  callbackAnswers(): readonly unknown[]
  assertClean(): void
}

type CallbackHandler = (ctx: Context) => Promise<void>
type AnswerCallbackQuery = CallbackContext['answerCallbackQuery']

type HandlerSlot = {
  run(ctx: CallbackContext): Promise<void>
}

type QueuedCallback = { readonly slot: HandlerSlot; readonly ctx: CallbackContext }

const registerSlot = (handlers: Map<string, Set<HandlerSlot>>, filter: string, handler: CallbackHandler): void => {
  const slot: HandlerSlot = { run: handler }
  const bucket = handlers.get(filter) ?? new Set<HandlerSlot>()
  bucket.add(slot)
  handlers.set(filter, bucket)
}

export function createFakeTelegramBot(options: FakeTelegramBotOptions): FakeTelegramBot {
  const calls: Array<[number, number]> = []
  const handlers = new Map<string, Set<HandlerSlot>>()
  const queue: QueuedCallback[] = []
  const pending = new Set<Promise<unknown>>()
  const answers: unknown[] = []
  let pollingTimer: object | null = null

  const wrapAnswer = (ctx: CallbackContext): CallbackContext => {
    const recording: AnswerCallbackQuery = (...args: Parameters<AnswerCallbackQuery>): Promise<true> => {
      answers.push(args[0])
      return ctx.answerCallbackQuery(...args)
    }
    return { ...ctx, answerCallbackQuery: recording }
  }

  const bot: TelegramBotLike = {
    api: {
      sendMessage: () => Promise.resolve(),
      getChat: () => Promise.resolve({ id: 0 }),
      getChatMember(chatId, userId) {
        const numericChatId = Number(chatId)
        calls.push([numericChatId, userId])
        return options.getChatMember(numericChatId, userId)
      },
      getChatAdministrators: () => Promise.resolve([]),
      getFile: () => Promise.resolve({}),
      createForumTopic: () => Promise.resolve({ message_thread_id: 1 }),
      editMessageText: () => Promise.resolve(),
      deleteMessage: () => Promise.resolve(),
      setMyCommands: () => Promise.resolve(),
      deleteMyCommands: () => Promise.resolve(),
    },
    on(filter, handler) {
      const filters = Array.isArray(filter) ? filter : [filter]
      for (const single of filters) registerSlot(handlers, single, handler)
    },
    command: () => undefined,
    start(startOptions) {
      pollingTimer = { owner: 'fake-telegram-poller' }
      startOptions?.onStart?.({ username: 'papai' })
      return Promise.resolve()
    },
    stop() {
      pollingTimer = null
      return Promise.resolve()
    },
  }

  const emitCallback = (ctx: CallbackContext): void => {
    const bucket = handlers.get('callback_query:data')
    if (bucket === undefined) return
    const wrapped = wrapAnswer(ctx)
    for (const slot of bucket) queue.push({ slot, ctx: wrapped })
  }

  const flush = async (): Promise<void> => {
    while (queue.length > 0) {
      const item = queue.shift()
      if (item === undefined) continue
      const promise = Promise.resolve().then((): Promise<void> => item.slot.run(item.ctx))
      pending.add(promise)
      try {
        await promise
      } finally {
        pending.delete(promise)
      }
    }
    if (pending.size > 0) await Promise.allSettled([...pending])
  }

  const assertClean = (): void => {
    if (pollingTimer !== null) throw new Error('fake Telegram bot is still polling')
    if (queue.length > 0) throw new Error('fake Telegram bot has queued callback events')
    if (pending.size > 0) throw new Error('fake Telegram bot has pending callback handlers')
  }

  return {
    bot,
    factory: () => bot,
    membershipCalls: () => calls.slice(),
    pollingTimer: () => pollingTimer,
    emitCallback,
    flush,
    callbackAnswers: () => answers.slice(),
    assertClean,
  }
}
