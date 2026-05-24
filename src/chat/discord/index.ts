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
import { renderDiscordContext } from './context-renderer.js'
import { handleDiscordGroupSettingsSelection } from './group-settings.js'
import { resolveDiscordGroupLabel, resolveDiscordGuildFromContext, resolveDiscordUserLabel } from './label-helpers.js'
import { mapDiscordMessage } from './map-message.js'
import { discordCapabilities, discordConfigRequirements, discordTraits } from './metadata.js'
import { buildDiscordReplyContext } from './reply-context.js'
import { createDiscordReplyFn } from './reply-helpers.js'
import { sendDiscordMessage } from './send-message.js'
import { isDispatchableMessage, isReadyPayload } from './type-guards.js'
export type { DiscordClientFactory, DiscordClientLike, DispatchableMessage }
export { defaultClientFactory }
const log = logger.child({ scope: 'chat:discord' })
type OnMessageHandler = (msg: IncomingMessage, reply: ReplyFn) => Promise<void>
type DiscordConstructorArgs =
  | []
  | [clientFactory: DiscordClientFactory | undefined]
  | [clientFactory: DiscordClientFactory | undefined, tokenOverride: string | undefined]
  | [
      clientFactory: DiscordClientFactory | undefined,
      tokenOverride: string | undefined,
      platformInstanceId: string | undefined,
    ]

const resolveToken = (tokenOverride: string | undefined): string | undefined => {
  if (tokenOverride === undefined) return process.env['DISCORD_BOT_TOKEN']
  return tokenOverride
}

const resolvePlatformInstanceId = (platformInstanceId: string | undefined): string => {
  if (platformInstanceId === undefined) return 'legacy-single'
  return platformInstanceId
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
  constructor(...args: DiscordConstructorArgs) {
    const clientFactory = args[0]
    const tokenOverride = args.length >= 2 ? args[1] : undefined
    const token = resolveToken(tokenOverride)
    if (token === undefined || token.trim() === '') {
      throw new Error('DISCORD_BOT_TOKEN environment variable is required')
    }
    const platformInstanceId = resolvePlatformInstanceId(args.length >= 3 ? args[2] : undefined)
    this.token = token
    this.platformInstanceId = platformInstanceId
    this.clientFactory = typeof clientFactory === 'function' ? clientFactory : defaultClientFactory
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
    if (this.client === null) return Promise.resolve(null)
    return resolveDiscordGroupLabel(this.client, groupId)
  }

  resolveUserLabel(userId: string, context: ResolveUserContext | undefined): Promise<string | null> {
    if (this.client === null) return Promise.resolve(null)
    return resolveDiscordUserLabel(this.client, userId, context)
  }

  start(): Promise<void> {
    const adminUserId = typeof process.env['ADMIN_USER_ID'] === 'string' ? process.env['ADMIN_USER_ID'] : ''
    const client = this.clientFactory()
    this.client = client
    client.on('messageCreate', (rawMsg) => {
      if (!isDispatchableMessage(rawMsg)) return
      this.dispatchMessage(rawMsg, client.user === null ? '' : client.user.id, adminUserId).catch((error: unknown) => {
        log.error({ error: error instanceof Error ? error.message : String(error) }, 'messageCreate dispatch failed')
      })
    })

    client.on('interactionCreate', (rawInteraction) => {
      if (!isButtonInteraction(rawInteraction)) return
      this.dispatchButtonInteraction(rawInteraction, adminUserId).catch((error: unknown) => {
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
  testDispatchMessage(message: DispatchableMessage, botId: string, adminUserId: string): Promise<void> {
    return this.dispatchMessage(message, botId, adminUserId)
  }

  async testDispatchButtonInteraction(
    interaction: ButtonInteractionLike,
    _botId: string,
    adminUserId: string,
  ): Promise<void> {
    await this.dispatchButtonInteraction(interaction, adminUserId)
  }

  private async dispatchButtonInteraction(interaction: ButtonInteractionLike, adminUserId: string): Promise<void> {
    await tryDeferUpdate(interaction)

    const result = buildInteraction(interaction, adminUserId, this.platformInstanceId)
    if (result === null) {
      log.debug({ customId: interaction.customId }, 'Could not build incoming interaction, skipping')
      return
    }

    const { incoming, channel } = result

    // Handle group-settings selector callbacks before standard routing
    if (
      await handleDiscordGroupSettingsSelection(
        interaction,
        incoming.user.id,
        incoming.platformInstanceId,
        result.reply,
      )
    )
      return

    if (this.interactionHandler === null) {
      const auth = checkAuthorizationExtended(
        incoming.user.id,
        incoming.user.username,
        incoming.contextId,
        incoming.contextType,
        incoming.threadId,
        incoming.user.isAdmin,
      )
      const handled = await routeInteraction(incoming, result.reply, auth)
      if (handled) return
      await routeButtonFallbackExternal(
        interaction,
        channel,
        incoming.contextId,
        incoming.contextType,
        adminUserId,
        this.commands,
        this.messageHandler,
        this.platformInstanceId,
      )
      return
    }
    await this.interactionHandler(incoming, result.reply)
  }

  private async dispatchMessage(message: DispatchableMessage, botId: string, adminUserId: string): Promise<void> {
    const mapped = mapDiscordMessage(message, botId, adminUserId, this.platformInstanceId)
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
    )
    const command = this.matchCommand(mapped.text)
    if (command !== null) {
      mapped.commandMatch = command.match
      await command.handler(mapped, reply, auth)
      return
    }

    if (this.messageHandler !== null) {
      if (message.channel.messages !== undefined) {
        mapped.replyContext = await buildDiscordReplyContext(
          { reference: message.reference, channel: { id: message.channel.id, messages: message.channel.messages } },
          mapped.contextId,
        )
      }
      await this.messageHandler(mapped, reply)
    }
  }

  private matchCommand(text: string): { handler: CommandHandler; match: string } | null {
    const trimmed = text.trim()
    if (!trimmed.startsWith('/')) return null
    for (const [name, handler] of this.commands) {
      if (trimmed === `/${name}` || trimmed.startsWith(`/${name} `)) {
        const match = trimmed.slice(name.length + 2).trim()
        return { handler, match }
      }
    }
    return null
  }

  renderContext(snapshot: ContextSnapshot): ContextRendered {
    return renderDiscordContext(snapshot)
  }
}
