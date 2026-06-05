// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { checkAuthorizationExtended } from '../../src/auth.js'
import type { CommandHandler, IncomingInteraction, IncomingMessage, ReplyFn } from '../../src/chat/types.js'
import { logger } from '../../src/logger.js'
import type { ButtonInteractionLike } from './buttons.js'
import { buildDiscordInteraction } from './interaction-helpers.js'
import { createDiscordReplyFn } from './reply-helpers.js'

const log = logger.child({ scope: 'chat:discord' })

const requirePlatformInstanceId = (platformInstanceId: string | undefined): string => {
  if (platformInstanceId === undefined || platformInstanceId.trim() === '')
    throw new Error('platformInstanceId is required')
  return platformInstanceId
}

type RouteButtonFallbackArgs = [
  interaction: ButtonInteractionLike,
  channel: NonNullable<ButtonInteractionLike['channel']>,
  contextId: string,
  contextType: 'dm' | 'group',
  commands: Map<string, CommandHandler>,
  messageHandler: ((msg: IncomingMessage, reply: ReplyFn) => Promise<void>) | null,
  platformInstanceId: string,
]

export async function tryDeferUpdate(interaction: ButtonInteractionLike): Promise<void> {
  try {
    await interaction.deferUpdate()
  } catch (error) {
    log.warn(
      {
        error: error instanceof Error ? error.message : String(error),
        customId: interaction.customId,
      },
      'Failed to deferUpdate Discord button interaction',
    )
  }
}

export function buildInteraction(
  interaction: ButtonInteractionLike,
  platformInstanceId: string,
): {
  incoming: IncomingInteraction
  channel: NonNullable<ButtonInteractionLike['channel']>
  reply: ReplyFn
} | null {
  const resolvedPlatformInstanceId = requirePlatformInstanceId(platformInstanceId)
  const channel = interaction.channel
  if (channel === null) return null

  const isAdmin = interaction.user.isAdmin === true
  const incomingInteraction = buildDiscordInteraction(
    {
      user: interaction.user,
      customId: interaction.customId,
      channelId: interaction.channelId,
      channel,
      message: interaction.message,
    },
    isAdmin,
    resolvedPlatformInstanceId,
  )

  if (incomingInteraction === null) return null

  const reply = createDiscordReplyFn({
    channel,
    replyToMessageId: undefined,
    replaceMessage: supportsEditableMessage(interaction.message) ? interaction.message : undefined,
  })
  return { incoming: incomingInteraction, channel, reply }
}

function supportsEditableMessage(
  message: ButtonInteractionLike['message'],
): message is ButtonInteractionLike['message'] & {
  editable: true
  edit: (arg: Partial<{ content: string; components: unknown[] }>) => Promise<unknown>
} {
  return message.editable === true && typeof message.edit === 'function'
}

export function createFallbackMessage(
  interaction: ButtonInteractionLike,
  contextId: string,
  contextType: 'dm' | 'group',
  isPlatformAdmin: boolean,
  platformInstanceId: string,
): IncomingMessage {
  const resolvedPlatformInstanceId = requirePlatformInstanceId(platformInstanceId)
  return {
    user: {
      id: interaction.user.id,
      username: interaction.user.username.length > 0 ? interaction.user.username : null,
      isAdmin: isPlatformAdmin,
    },
    contextId,
    contextType,
    isMentioned: true,
    text: interaction.customId,
    platformInstanceId: resolvedPlatformInstanceId,
    messageId: interaction.message.id,
  }
}

function findCommand(
  text: string,
  commands: Map<string, CommandHandler>,
): { name: string; handler: CommandHandler; match: string } | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return null

  for (const [name, handler] of commands.entries()) {
    if (trimmed === `/${name}`) {
      const match = trimmed.slice(name.length + 2).trim()
      return { name, handler, match }
    }

    if (trimmed.startsWith(`/${name} `)) {
      const match = trimmed.slice(name.length + 2).trim()
      return { name, handler, match }
    }
  }
  return null
}

async function executeCommand(
  mapped: IncomingMessage,
  handler: CommandHandler,
  interaction: ButtonInteractionLike,
  reply: ReplyFn,
): Promise<void> {
  // Extract thread ID from the interaction message if present
  const threadId =
    'threadId' in interaction.message && interaction.message.threadId !== undefined
      ? interaction.message.threadId
      : undefined

  // Use proper authorization check instead of hardcoded values
  const auth = checkAuthorizationExtended(
    mapped.user.id,
    mapped.user.username,
    mapped.contextId,
    mapped.contextType,
    threadId,
    mapped.user.isAdmin,
    mapped.platformInstanceId,
  )

  if (!auth.allowed) {
    await reply.text('You are not authorized to use this bot.')
    return
  }

  await handler(mapped, reply, auth)
}

export async function routeButtonFallback(...args: RouteButtonFallbackArgs): Promise<void> {
  const [interaction, channel, contextId, contextType, commands, messageHandler, platformInstanceId] = args
  const resolvedPlatformInstanceId = requirePlatformInstanceId(platformInstanceId)
  const data = interaction.customId

  log.debug({ customId: data }, 'Unhandled button interaction in routeButtonFallback')

  const isPlatformAdmin = interaction.user.isAdmin === true
  const mapped = createFallbackMessage(interaction, contextId, contextType, isPlatformAdmin, resolvedPlatformInstanceId)
  const reply = createDiscordReplyFn({
    channel,
    replyToMessageId: undefined,
    replaceMessage: supportsEditableMessage(interaction.message) ? interaction.message : undefined,
  })

  const trimmed = mapped.text.trim()
  if (!trimmed.startsWith('/')) {
    if (messageHandler !== null) await messageHandler(mapped, reply)
    return
  }

  const command = findCommand(mapped.text, commands)
  if (command !== null) {
    mapped.commandMatch = command.match
    await executeCommand(mapped, command.handler, interaction, reply)
    return
  }

  if (messageHandler !== null) await messageHandler(mapped, reply)
}
