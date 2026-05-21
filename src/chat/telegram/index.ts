// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Bot, type Context } from 'grammy'

import { getThreadScopedStorageContextId } from '../../auth.js'
import { logger } from '../../logger.js'
import type {
  AuthorizationResult,
  ChatProvider,
  CommandHandler,
  ContextRendered,
  ContextSnapshot,
  DeferredDeliveryTarget,
  IncomingFile,
  IncomingInteraction,
  IncomingMessage,
  ReplyFn,
  ReplyOptions,
  ResolveUserContext,
} from '../types.js'
import { registerTelegramCommands } from './commands.js'
import { renderTelegramContext } from './context-renderer.js'
import { createTelegramFileFetcher, getTelegramFileFetcher } from './file-fetcher.js'
import { extractFileCandidatesFromContext, extractFilesFromContext } from './file-helpers.js'
import { formatLlmOutput } from './format.js'
import { buildTelegramInteraction } from './interaction-helpers.js'
import { getTelegramDisplayLabel, resolveTelegramGroupLabel, resolveTelegramUserLabel } from './label-helpers.js'
import {
  cacheTelegramMessage,
  extractContextInfo,
  extractMessageIds,
  extractReplyContext,
  logMessageExtraction,
  resolveThreadId,
} from './message-extraction.js'
import { telegramCapabilities, telegramConfigRequirements, telegramTraits } from './metadata.js'
import {
  buildTelegramMentionPrefix,
  checkTelegramAdminStatus,
  createReplyParamsBuilder,
  getTelegramUsername,
  sendButtonReply,
  sendFileReply,
  sendFormattedReply,
  sendReplacementButtonReply,
  sendReplacementTextReply,
  sendTextReply,
  shiftTelegramEntity,
  telegramIsBotMentioned,
} from './reply-helpers.js'
export { extractReplyContext } from './message-extraction.js'
export { getTelegramFileFetcher } from './file-fetcher.js'
const log = logger.child({ scope: 'chat:telegram' })
const ignoreTelegramTypingError = (): null => null

export class TelegramChatProvider implements ChatProvider {
  readonly name = 'telegram'
  readonly threadCapabilities = {
    supportsThreads: true,
    canCreateThreads: true,
    threadScope: 'message' as const,
  }
  readonly capabilities = telegramCapabilities
  readonly traits = telegramTraits
  readonly configRequirements = telegramConfigRequirements
  private readonly bot: Bot
  private readonly token: string
  private botUsername: string | null = null
  private interactionHandler: ((interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>) | undefined

  constructor(tokenOverride?: string) {
    const token = tokenOverride ?? process.env['TELEGRAM_BOT_TOKEN']
    if (token === undefined || token.trim() === '') {
      throw new Error('TELEGRAM_BOT_TOKEN environment variable is required')
    }
    this.token = token
    this.bot = new Bot(token)
    createTelegramFileFetcher(this.bot.api, this.token, log)
    this.bot.on('callback_query:data', (ctx) => this.dispatchCallbackQuery(ctx))
  }
  registerCommand(name: string, handler: CommandHandler): void {
    this.bot.command(name, async (ctx) => {
      const isAdmin = await this.checkAdminStatus(ctx)
      const msg = await this.extractMessage(ctx, isAdmin)
      if (msg === null) return
      msg.commandMatch = typeof ctx.match === 'string' ? ctx.match : ''
      const reply = this.buildReplyFn(ctx, msg.threadId, false)
      const auth: AuthorizationResult = {
        allowed: true,
        isBotAdmin: isAdmin,
        isGroupAdmin: isAdmin,
        storageContextId: getThreadScopedStorageContextId(msg.contextId, msg.contextType, msg.threadId),
      }
      await handler(msg, reply, auth)
    })
  }
  onMessage(handler: (msg: IncomingMessage, reply: ReplyFn) => Promise<void>): void {
    this.bot.on('message:text', async (ctx) => {
      const isAdmin = await this.checkAdminStatus(ctx)
      const msg = await this.extractMessage(ctx, isAdmin)
      if (msg === null) return
      const reply = this.buildReplyFn(ctx, msg.threadId, false)
      await handler(msg, reply)
    })

    this.bot.on(
      ['message:document', 'message:photo', 'message:audio', 'message:video', 'message:voice'],
      async (ctx) => {
        const isAdmin = await this.checkAdminStatus(ctx)
        const msg = await this.extractMessage(ctx, isAdmin)
        if (msg === null) return

        if (msg.contextType === 'group') {
          const candidates = extractFileCandidatesFromContext(ctx)
          if (candidates.length > 0) msg.fileCandidates = candidates
        } else {
          const files = await this.fetchFilesFromContext(ctx)
          if (files.length > 0) msg.files = files
        }

        const reply = this.buildReplyFn(ctx, msg.threadId, false)
        await handler(msg, reply)
      },
    )
  }
  onInteraction(handler: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>): void {
    this.interactionHandler = handler
  }
  async sendMessage(target: DeferredDeliveryTarget, markdown: string): Promise<void> {
    const chatId = parseInt(target.contextId, 10)
    const mentionPrefix = buildTelegramMentionPrefix(target)
    const formatted = formatLlmOutput(markdown)
    const options: Parameters<typeof this.bot.api.sendMessage>[2] = {
      entities: [
        ...mentionPrefix.entities,
        ...formatted.entities.map((entity) => shiftTelegramEntity(entity, mentionPrefix.text.length)),
      ],
    }
    if (target.contextType === 'group' && target.threadId !== null) {
      options.message_thread_id = parseInt(target.threadId, 10)
    }
    await this.bot.api.sendMessage(chatId, `${mentionPrefix.text}${formatted.text}`, options)
  }
  start(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.bot
        .start({
          onStart: (botInfo) => {
            this.botUsername = botInfo.username
            log.info({ botUsername: this.botUsername }, 'Telegram bot is running')
            resolve()
          },
        })
        .catch((error: unknown) => {
          const err = error instanceof Error ? error : new Error(String(error))
          log.error({ error: err.message }, 'Telegram polling loop exited')
          reject(err)
        })
    })
  }
  async stop(): Promise<void> {
    await this.bot.stop()
  }
  resolveUserId(username: string, _context: ResolveUserContext): Promise<string | null> {
    const clean = username.startsWith('@') ? username.slice(1) : username
    return Promise.resolve(/^\d+$/u.test(clean) ? clean : null)
  }
  resolveGroupLabel(groupId: string): Promise<string | null> {
    return resolveTelegramGroupLabel((chatId) => this.bot.api.getChat(chatId), groupId)
  }
  resolveUserLabel(userId: string, context: ResolveUserContext | undefined): Promise<string | null> {
    return resolveTelegramUserLabel((chatId, uid) => this.bot.api.getChatMember(chatId, uid), userId, context)
  }
  async setCommands(adminUserId: string): Promise<void> {
    await registerTelegramCommands(this.bot, adminUserId)
  }
  renderContext(snapshot: ContextSnapshot): ContextRendered {
    return renderTelegramContext(snapshot)
  }
  private async extractMessage(ctx: Context, isAdmin: boolean): Promise<IncomingMessage | null> {
    const contextInfo = extractContextInfo(ctx, (text, entities) =>
      telegramIsBotMentioned(text, entities, this.botUsername),
    )
    if (contextInfo === null) return null
    const { id, contextId, contextType, text, isMentioned } = contextInfo
    const { messageIdStr, replyToMessageIdStr, replyToMessageText, quoteText } = extractMessageIds(ctx)
    logMessageExtraction(id, contextId, messageIdStr, replyToMessageIdStr, replyToMessageText, quoteText)
    cacheTelegramMessage(ctx, id, contextId, messageIdStr, text, replyToMessageIdStr)
    const replyContext = extractReplyContext(ctx, contextId)
    const threadId = await resolveThreadId(ctx, isMentioned, contextType, this.bot.api)
    const from = ctx.from
    const chat = ctx.chat
    const username = from === undefined ? null : getTelegramUsername(from.username)
    const displayLabel =
      from === undefined ? undefined : getTelegramDisplayLabel(from.first_name, from.last_name, username)
    const contextName = contextType === 'group' && chat !== undefined && 'title' in chat ? chat.title : undefined
    return {
      user: { id: String(id), username, displayLabel, isAdmin },
      contextId,
      contextType,
      contextName,
      isMentioned,
      text,
      messageId: messageIdStr,
      replyToMessageId: replyToMessageIdStr,
      replyContext,
      threadId,
    }
  }

  private checkAdminStatus(ctx: Context): Promise<boolean> {
    return checkTelegramAdminStatus(ctx, (chatId) => this.bot.api.getChatAdministrators(chatId))
  }

  private buildReplyFn(ctx: Context, threadId: string | undefined, allowReplacement: boolean): ReplyFn {
    const chat = ctx.chat
    const message = ctx.message
    const chatId = chat === undefined ? undefined : chat.id
    const messageId = message === undefined ? undefined : message.message_id
    const buildReplyParams = createReplyParamsBuilder(ctx, threadId)
    const text: ReplyFn['text'] = (content: string, ...rest: [] | [ReplyOptions]) => {
      const options = rest[0]
      return sendTextReply(ctx, content, buildReplyParams, options)
    }
    const formatted: ReplyFn['formatted'] = (markdown: string, ...rest: [] | [ReplyOptions]) => {
      const options = rest[0]
      return sendFormattedReply(ctx, markdown, buildReplyParams, options)
    }
    const file: NonNullable<ReplyFn['file']> = (chatFile, ...rest: [] | [ReplyOptions]) => {
      const options = rest[0]
      return sendFileReply(ctx, chatFile, buildReplyParams, options)
    }
    const replyFn: ReplyFn = {
      text,
      formatted,
      file,
      typing: () => {
        void ctx.replyWithChatAction('typing').catch(ignoreTelegramTypingError)
      },
      redactMessage: async (replacementText: string) => {
        if (chatId !== undefined && messageId !== undefined) {
          await this.bot.api.editMessageText(chatId, messageId, replacementText).catch((err: unknown) => {
            log.warn(
              { chatId, messageId, error: err instanceof Error ? err.message : String(err) },
              'Failed to redact message',
            )
          })
        }
      },
      buttons: (content: string, options) => sendButtonReply(ctx, content, buildReplyParams, options),
    }
    if (allowReplacement) {
      replyFn.replaceText = (content: string, ..._rest: [] | [ReplyOptions]): Promise<void> =>
        sendReplacementTextReply(ctx, content)
      replyFn.replaceButtons = (content: string, options): Promise<void> =>
        sendReplacementButtonReply(ctx, content, options)
    }
    return replyFn
  }
  private async dispatchCallbackQuery(ctx: Context): Promise<void> {
    await ctx.answerCallbackQuery()
    const interaction = buildTelegramInteraction(
      ctx,
      await checkTelegramAdminStatus(ctx, (chatId) => this.bot.api.getChatAdministrators(chatId)),
    )
    if (interaction === null) return
    const reply = this.buildReplyFn(ctx, interaction.threadId, true)
    if (this.interactionHandler === undefined) {
      const callbackQuery = ctx.callbackQuery
      log.warn(
        { callbackData: callbackQuery === undefined ? undefined : callbackQuery.data },
        'No interaction handler registered',
      )
      return
    }
    await this.interactionHandler(interaction, reply)
  }
  private fetchFilesFromContext(ctx: Context): Promise<IncomingFile[]> {
    const fetcher = getTelegramFileFetcher() ?? createTelegramFileFetcher(this.bot.api, this.token, log)
    return extractFilesFromContext(ctx, fetcher)
  }
}
