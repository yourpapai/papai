// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { checkAuthorizationExtended } from '../../auth.js'
import { logger } from '../../logger.js'
import { routeInteraction } from '../interaction-router.js'
import type {
  ChatProvider,
  CommandHandler,
  ContextRendered,
  ContextSnapshot,
  DeferredDeliveryTarget,
  IncomingInteraction,
  IncomingMessage,
  ReplyFn,
  ResolveUserContext,
  ThreadCapabilities,
} from '../types.js'
import { isDiscordGuildAdmin } from './admin-helpers.js'
import {
  buildInteraction,
  routeButtonFallback as routeButtonFallbackExternal,
  tryDeferUpdate,
} from './button-dispatch.js'
import { type ButtonInteractionLike, isButtonInteraction } from './buttons.js'
import {
  type DiscordClientFactory,
  type DiscordClientLike,
  type DispatchableMessage,
  defaultClientFactory,
} from './client-factory.js'
import { matchDiscordCommand } from './commands.js'
import { renderDiscordContext } from './context-renderer.js'
import { resolveDiscordGroupLabel, resolveDiscordGuildFromContext, resolveDiscordUserLabel } from './label-helpers.js'
import { CHANNEL_TYPE_DM, mapDiscordMessage } from './map-message.js'
import { isBotMentioned } from './mention-helpers.js'
import { discordCapabilities, discordConfigRequirements, discordTraits } from './metadata.js'
import { buildDiscordReplyContext } from './reply-context.js'
import { createDiscordReplyFn } from './reply-helpers.js'
import { sendDiscordMessage } from './send-message.js'
import { isDispatchableMessage, isReadyPayload } from './type-guards.js'
export type { DiscordClientFactory, DiscordClientLike, DispatchableMessage }
export { defaultClientFactory }
const log = logger.child({ scope: 'chat:discord' })
type OnMessageHandler = (msg: IncomingMessage, reply: ReplyFn) => Promise<void>
type DiscordConstructorConfig = {
  readonly clientFactory?: DiscordClientFactory
  readonly token?: string
  readonly platformInstanceId: string
}

/**
 * Determine if an unmentioned group message is a reply to the bot's own message.
 * Skips the fetch when the bot is already mentioned (passes the group filter regardless)
 * or when the message is in a DM channel.
 */
async function resolveIsReplyToBot(message: DispatchableMessage, botId: string, mentioned: boolean): Promise<boolean> {
  if (message.reference?.messageId === undefined) return false
  if (message.channel.type === CHANNEL_TYPE_DM) return false
  if (mentioned) return false
  const messages = message.channel.messages
  if (messages === undefined) return false
  try {
    const parent = await messages.fetch(message.reference.messageId)
    return parent.author.id === botId
  } catch (error: unknown) {
    log.warn(
      {
        messageId: message.reference.messageId,
        error: error instanceof Error ? error.message : String(error),
      },
      'failed to fetch parent message for reply-to-bot detection',
    )
    return false
  }
}

export class DiscordChatProvider implements ChatProvider {
  readonly name = 'discord'
  readonly threadCapabilities: ThreadCapabilities = {
    supportsThreads: false,
    canCreateThreads: false,
    threadScope: 'message',
  }
  readonly capabilities = discordCapabilities
  readonly traits = discordTraits
  readonly configRequirements = discordConfigRequirements
  private readonly token: string
  private readonly platformInstanceId: string
  private readonly clientFactory: DiscordClientFactory
  private readonly commands = new Map<string, CommandHandler>()
  private messageHandler: OnMessageHandler | null = null
  private interactionHandler: ((interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>) | null = null
  private client: DiscordClientLike | null = null
  constructor(config: DiscordConstructorConfig) {
    const token = config.token
    if (token === undefined || token.trim() === '') {
      throw new Error('DISCORD_BOT_TOKEN environment variable is required')
    }
    const platformInstanceId = config.platformInstanceId
    if (platformInstanceId === undefined || platformInstanceId.trim() === '') {
      throw new Error('platformInstanceId is required')
    }
    this.token = token
    this.platformInstanceId = platformInstanceId
    this.clientFactory = typeof config.clientFactory === 'function' ? config.clientFactory : defaultClientFactory
    log.debug(
      { platformInstanceId: this.platformInstanceId, tokenLength: this.token.length },
      'DiscordChatProvider constructed',
    )
  }

  registerCommand(name: string, handler: CommandHandler): void {
    this.commands.set(name, handler)
    log.debug({ command: name }, 'Discord command registered')
  }
  onMessage(handler: OnMessageHandler): void {
    this.messageHandler = handler
  }
  onInteraction(handler: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>): void {
    this.interactionHandler = handler
  }

  async sendMessage(_platformInstanceId: string, target: DeferredDeliveryTarget, markdown: string): Promise<void> {
    await sendDiscordMessage(this.client, target, markdown)
  }

  async resolveUserId(username: string, context: ResolveUserContext): Promise<string | null> {
    const clean = username.startsWith('@') ? username.slice(1) : username
    if (/^\d+$/u.test(clean)) return clean
    if (context.contextType !== 'group') return null
    if (this.client === null) return null
    const resolvedGuild = await resolveDiscordGuildFromContext(this.client, context.contextId)
    if (resolvedGuild === null) return null
    try {
      const members = await resolvedGuild.guild.members.search({ query: clean, limit: 1 })
      for (const m of members.values()) {
        return m.id
      }
      return null
    } catch (error) {
      log.warn(
        {
          username: clean,
          guildId: resolvedGuild.guildId,
          error: error instanceof Error ? error.message : String(error),
        },
        'Discord member search failed',
      )
      return null
    }
  }

  resolveGroupLabel(groupId: string): Promise<string | null> {
    return this.client === null ? Promise.resolve(null) : resolveDiscordGroupLabel(this.client, groupId)
  }

  isGroupAdmin(_platformInstanceId: string, groupId: string, userId: string): Promise<boolean | null> {
    return this.client === null ? Promise.resolve(null) : isDiscordGuildAdmin(this.client, groupId, userId)
  }

  resolveUserLabel(userId: string, context: ResolveUserContext | undefined): Promise<string | null> {
    if (this.client === null) return Promise.resolve(null)
    return resolveDiscordUserLabel(this.client, userId, context)
  }

  start(): Promise<void> {
    const client = this.clientFactory()
    this.client = client
    client.on('messageCreate', (rawMsg) => {
      if (!isDispatchableMessage(rawMsg)) return
      this.dispatchMessage(rawMsg, client.user === null ? '' : client.user.id).catch((error: unknown) => {
        log.error({ error: error instanceof Error ? error.message : String(error) }, 'messageCreate dispatch failed')
      })
    })

    client.on('interactionCreate', (rawInteraction) => {
      if (!isButtonInteraction(rawInteraction)) return
      this.dispatchButtonInteraction(rawInteraction).catch((error: unknown) => {
        log.error(
          { error: error instanceof Error ? error.message : String(error) },
          'interactionCreate dispatch failed',
        )
      })
    })

    client.on('error', (rawError) => {
      const msg = rawError instanceof Error ? rawError.message : String(rawError)
      log.error({ error: msg }, 'Discord client error')
    })

    return new Promise<void>((resolve, reject) => {
      client.once('ready', (readyClient) => {
        if (!isReadyPayload(readyClient)) return
        log.info({ botId: readyClient.user.id, botUsername: readyClient.user.username }, 'Discord bot is ready')
        resolve()
      })
      client.login(this.token).catch(reject)
    })
  }

  async stop(): Promise<void> {
    if (this.client === null) return
    await this.client.destroy()
    this.client = null
  }
  testSetClient(c: DiscordClientLike): void {
    this.client = c
  }
  testDispatchMessage(message: DispatchableMessage, botId: string): Promise<void> {
    return this.dispatchMessage(message, botId)
  }

  async testDispatchButtonInteraction(interaction: ButtonInteractionLike, _botId: string): Promise<void> {
    await this.dispatchButtonInteraction(interaction)
  }

  private async dispatchButtonInteraction(interaction: ButtonInteractionLike): Promise<void> {
    await tryDeferUpdate(interaction)

    const result = buildInteraction(interaction, this.platformInstanceId)
    if (result === null) {
      log.debug({ customId: interaction.customId }, 'Could not build incoming interaction, skipping')
      return
    }

    const { incoming, channel } = result

    if (this.interactionHandler === null) {
      const auth = checkAuthorizationExtended(
        incoming.user.id,
        incoming.user.username,
        incoming.contextId,
        incoming.contextType,
        incoming.threadId,
        incoming.user.isAdmin,
        incoming.platformInstanceId,
      )
      const handled = await routeInteraction(incoming, result.reply, auth)
      if (handled) return
      await routeButtonFallbackExternal(
        interaction,
        channel,
        incoming.contextId,
        incoming.contextType,
        this.commands,
        this.messageHandler,
        this.platformInstanceId,
      )
      return
    }
    await this.interactionHandler(incoming, result.reply)
  }

  private async dispatchMessage(message: DispatchableMessage, botId: string): Promise<void> {
    const mentioned = isBotMentioned(message.mentions, botId, 'group')
    const isReplyToBot = await resolveIsReplyToBot(message, botId, mentioned)

    const mapped = mapDiscordMessage(message, botId, this.platformInstanceId, isReplyToBot)
    if (mapped === null) return
    const reply = createDiscordReplyFn({
      channel: message.channel,
      replyToMessageId: mapped.messageId,
    })
    const auth = checkAuthorizationExtended(
      mapped.user.id,
      mapped.user.username,
      mapped.contextId,
      mapped.contextType,
      mapped.threadId,
      mapped.user.isAdmin,
      mapped.platformInstanceId,
    )
    const command = matchDiscordCommand(mapped.text, this.commands)
    if (command !== null) {
      mapped.commandMatch = command.match
      await command.handler(mapped, reply, auth)
      return
    }

    if (this.messageHandler !== null) {
      if (message.channel.messages !== undefined) {
        mapped.replyContext = await buildDiscordReplyContext(
          {
            reference: message.reference,
            channel: { id: message.channel.id, messages: message.channel.messages },
          },
          mapped.contextId,
        )
      }
      await this.messageHandler(mapped, reply)
    }
  }

  renderContext(snapshot: ContextSnapshot): ContextRendered {
    return renderDiscordContext(snapshot)
  }
}
