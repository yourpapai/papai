// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Context } from 'grammy'

import { formatLlmOutput } from './format.js'

type TelegramUpdateFilter =
  | 'callback_query:data'
  | 'message:text'
  | 'message:document'
  | 'message:photo'
  | 'message:audio'
  | 'message:video'
  | 'message:voice'

type TelegramSendMessageOptions = {
  entities: ReturnType<typeof formatLlmOutput>['entities']
  message_thread_id?: number
}

type TelegramCommandOptions = {
  readonly scope:
    | { readonly type: 'all_private_chats' }
    | { readonly type: 'chat'; readonly chat_id: number }
    | { readonly type: 'all_group_chats' }
    | { readonly type: 'all_chat_administrators' }
}

type TelegramPublishedCommand = {
  readonly command: string
  readonly description: string
}

export type TelegramBotApiLike = {
  sendMessage(chatId: number, text: string, options: TelegramSendMessageOptions): Promise<unknown>
  getChat(chatId: number | string): Promise<{ id: number }>
  getChatMember(chatId: number | string, userId: number): Promise<{ status: string }>
  getChatAdministrators(chatId: number): Promise<Array<{ user: { id: number } }>>
  getFile(fileId: string): Promise<object>
  createForumTopic(chatId: number, name: string): Promise<{ message_thread_id: number }>
  editMessageText(chatId: number, messageId: number, text: string, options?: Record<string, unknown>): Promise<unknown>
  deleteMessage(chatId: number, messageId: number): Promise<unknown>
  setMyCommands(commands: readonly TelegramPublishedCommand[], options: TelegramCommandOptions): Promise<unknown>
  deleteMyCommands(options: TelegramCommandOptions): Promise<unknown>
}

export type TelegramBotLike = {
  readonly api: TelegramBotApiLike
  on(filter: TelegramUpdateFilter | TelegramUpdateFilter[], handler: (ctx: Context) => Promise<void>): unknown
  command(name: string, handler: (ctx: Context) => Promise<void>): unknown
  start(options?: { readonly onStart?: (botInfo: { readonly username: string }) => void }): Promise<void>
  stop(): Promise<void>
}

export type TelegramBotFactory = (token: string) => TelegramBotLike
