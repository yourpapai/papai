// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import pLimit from 'p-limit'

import { logger } from '../../logger.js'
import type { ButtonReplyOptions, EmbedOptions, ReplyFn, ReplyOptions } from '../types.js'
import { toActionRows } from './buttons.js'
import { chunkForDiscord } from './format-chunking.js'
import { formatLlmOutput } from './format.js'
import { discordTraits } from './metadata.js'

const log = logger.child({ scope: 'chat:discord:reply' })

type MessageRef = { messageReference: string; failIfNotExists: boolean } | undefined
type SendPayload = Partial<{
  content: string
  components: unknown[]
  embeds: unknown[]
  reply: Exclude<MessageRef, undefined>
}>
type EditPayload = Partial<{ content: string; components: unknown[] }>

export type SendableChannel = {
  id: string
  send: (arg: SendPayload) => Promise<{ id: string; edit: (arg: EditPayload) => Promise<unknown> }>
  sendTyping: () => Promise<void>
}

export type CreateDiscordReplyFnParams = {
  channel: SendableChannel
  replyToMessageId: string | undefined
} & Partial<{ replaceMessage: BotMessage }>

type BotMessage = {
  id: string
  edit: (arg: EditPayload) => Promise<unknown>
}

function buildReply(replyToMessageId: string | undefined, options: ReplyOptions | undefined): MessageRef {
  const target =
    options !== undefined && options.replyToMessageId !== undefined ? options.replyToMessageId : replyToMessageId
  return target === undefined ? undefined : { messageReference: target, failIfNotExists: false }
}

async function sendChunksSequentially(
  channel: SendableChannel,
  chunks: string[],
  replyToMessageId: string | undefined,
  options: ReplyOptions | undefined,
): Promise<BotMessage[]> {
  // Chunks must be sent sequentially to preserve message ordering.
  // Use p-limit with concurrency=1 to enforce sequential execution without await-in-loop.
  const limit = pLimit(1)
  const sent: BotMessage[] = []

  await Promise.all(
    chunks.map((chunk) =>
      limit(async () => {
        const msg = await channel.send({ content: chunk, reply: buildReply(replyToMessageId, options) })
        sent.push(msg)
      }),
    ),
  )

  return sent
}

function createEmbedPayload(options: EmbedOptions): Record<string, unknown> {
  const embed: Record<string, unknown> = {
    title: options.title,
    description: options.description,
  }
  if (options.fields !== undefined) {
    embed['fields'] = options.fields
  }
  if (options.footer !== undefined) {
    embed['footer'] = { text: options.footer }
  }
  if (options.color !== undefined) {
    embed['color'] = options.color
  }
  return embed
}

async function sendTextReply(
  channel: SendableChannel,
  sentMessages: BotMessage[],
  replyToMessageId: string | undefined,
  content: string,
  options: ReplyOptions | undefined,
): Promise<void> {
  const chunks = chunkForDiscord(content, discordTraits.maxMessageLength!)
  const messages = await sendChunksSequentially(channel, chunks, replyToMessageId, options)
  sentMessages.push(...messages)
}

async function sendFormattedReply(
  channel: SendableChannel,
  sentMessages: BotMessage[],
  replyToMessageId: string | undefined,
  markdown: string,
  options: ReplyOptions | undefined,
): Promise<void> {
  const chunks = formatLlmOutput(markdown)
  const messages = await sendChunksSequentially(channel, chunks, replyToMessageId, options)
  sentMessages.push(...messages)
}

async function sendButtonsReply(
  channel: SendableChannel,
  sentMessages: BotMessage[],
  replyToMessageId: string | undefined,
  content: string,
  options: ButtonReplyOptions,
): Promise<void> {
  const rows = options.buttons === undefined ? [] : toActionRows(options.buttons)
  const sent = await channel.send({ content, components: rows, reply: buildReply(replyToMessageId, options) })
  sentMessages.push(sent)
}

async function replaceOrSend(
  replaceMessage: BotMessage | undefined,
  payload: EditPayload,
  fallback: () => Promise<void>,
): Promise<void> {
  if (replaceMessage === undefined) {
    await fallback()
    return
  }

  await replaceMessage.edit(payload)
}

async function redactMessages(channelId: string, sentMessages: BotMessage[], replacementText: string): Promise<void> {
  if (sentMessages.length === 0) return

  const results = await Promise.allSettled(
    sentMessages.map((msg) => msg.edit({ content: replacementText, components: [] })),
  )
  const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (failures.length > 0) {
    log.warn({ channelId, failureCount: failures.length }, 'Failed to redact some Discord messages')
  }
}

export function createDiscordReplyFn(params: CreateDiscordReplyFnParams): ReplyFn {
  const { channel, replyToMessageId, replaceMessage } = params
  const sentMessages: BotMessage[] = []
  const text: ReplyFn['text'] = (content: string, ...rest: [] | [ReplyOptions]): Promise<void> => {
    const options = rest[0]
    return sendTextReply(channel, sentMessages, replyToMessageId, content, options)
  }
  const replaceText: NonNullable<ReplyFn['replaceText']> = (
    content: string,
    ...rest: [] | [ReplyOptions]
  ): Promise<void> => {
    const options = rest[0]
    return replaceOrSend(replaceMessage, { content, components: [] }, () =>
      sendTextReply(channel, sentMessages, replyToMessageId, content, options),
    )
  }
  const formatted: ReplyFn['formatted'] = (markdown: string, ...rest: [] | [ReplyOptions]): Promise<void> => {
    const options = rest[0]
    return sendFormattedReply(channel, sentMessages, replyToMessageId, markdown, options)
  }

  return {
    text,
    replaceText,
    formatted,

    typing: (): void => {
      void channel.sendTyping().catch(() => null)
    },
    redactMessage: (replacementText: string): Promise<void> =>
      redactMessages(channel.id, sentMessages, replacementText),
    buttons: (content: string, options: ButtonReplyOptions): Promise<void> =>
      sendButtonsReply(channel, sentMessages, replyToMessageId, content, options),
    replaceButtons: (content: string, options: ButtonReplyOptions): Promise<void> =>
      replaceOrSend(
        replaceMessage,
        { content, components: options.buttons === undefined ? [] : toActionRows(options.buttons) },
        () => sendButtonsReply(channel, sentMessages, replyToMessageId, content, options),
      ),
    embed: async (options: EmbedOptions): Promise<void> => {
      const embed = createEmbedPayload(options)
      const sent = await channel.send({ embeds: [embed] })
      sentMessages.push(sent)
    },
  }
}
